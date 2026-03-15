import { Symbol, FileIndex } from './indexer.js';

/**
 * Advanced search engine with BM25 ranking, fuzzy matching, and intelligent tokenization.
 * Designed to find code even with partial, misspelled, or natural language queries.
 */

export interface SearchMatch {
  symbol: Symbol;
  score: number;
  matchReason: string[];
  highlights: string[];
}

export interface SearchOptions {
  maxResults?: number;
  fuzzyThreshold?: number; // 0-1, lower = more strict
  includeCodeBodies?: boolean;
  includeComments?: boolean;
  boostExactMatches?: boolean;
}

export class CodeSearchEngine {
  private static readonly BM25_K1 = 1.5; // Term frequency saturation
  private static readonly BM25_B = 0.75; // Length normalization

  /**
   * Tokenize text intelligently:
   * - Split by camelCase: "getUserData" → ["get", "user", "data"]
   * - Split by snake_case: "get_user_data" → ["get", "user", "data"]
   * - Split by dots: "user.service.ts" → ["user", "service", "ts"]
   * - Lowercase everything
   * - Remove common words
   */
  static tokenize(text: string): string[] {
    if (!text) return [];

    // Split by camelCase, snake_case, dots, slashes, and special chars
    const tokens = text
      .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPServer → HTTP Server
      .replace(/[_\-./\\]/g, ' ') // snake_case and paths
      .toLowerCase()
      .split(/\s+/)
      .filter(t => t.length > 1); // Remove single chars

    // Remove common programming words that don't add value
    const stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'be']);

    return tokens.filter(t => !stopwords.has(t));
  }

  /**
   * Calculate Levenshtein distance for fuzzy matching
   */
  static levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = Math.min(
            dp[i - 1][j] + 1,    // deletion
            dp[i][j - 1] + 1,    // insertion
            dp[i - 1][j - 1] + 1 // substitution
          );
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Check if two strings are similar (fuzzy match)
   */
  static isFuzzyMatch(query: string, target: string, threshold: number = 0.7): boolean {
    if (!query || !target) return false;

    const distance = this.levenshteinDistance(query.toLowerCase(), target.toLowerCase());
    const maxLength = Math.max(query.length, target.length);
    const similarity = 1 - (distance / maxLength);

    return similarity >= threshold;
  }

  /**
   * Expand query with common variations
   * "auth" → ["auth", "authenticate", "authentication", "authorized"]
   */
  static expandQuery(query: string): string[] {
    const expansions: Record<string, string[]> = {
      'auth': ['auth', 'authenticate', 'authentication', 'authorize', 'authorized', 'authorization'],
      'config': ['config', 'configuration', 'configure', 'settings'],
      'init': ['init', 'initialize', 'initialization', 'setup'],
      'db': ['db', 'database', 'data'],
      'repo': ['repo', 'repository'],
      'func': ['func', 'function'],
      'proc': ['proc', 'process', 'procedure'],
      'util': ['util', 'utility', 'utilities', 'helper'],
      'mgr': ['mgr', 'manager'],
      'ctrl': ['ctrl', 'controller', 'control'],
      'svc': ['svc', 'service'],
      'req': ['req', 'request'],
      'res': ['res', 'response', 'result'],
      'err': ['err', 'error'],
      'msg': ['msg', 'message'],
      'val': ['val', 'value', 'validate', 'validation'],
      'temp': ['temp', 'temporary', 'template'],
      'str': ['str', 'string'],
      'num': ['num', 'number', 'numeric'],
      'bool': ['bool', 'boolean'],
      'obj': ['obj', 'object'],
      'arr': ['arr', 'array'],
      'idx': ['idx', 'index'],
      'max': ['max', 'maximum'],
      'min': ['min', 'minimum'],
    };

    const lower = query.toLowerCase();
    return expansions[lower] || [query];
  }

  /**
   * BM25 scoring algorithm for ranking search results
   * Returns score where higher = more relevant
   */
  static calculateBM25Score(
    queryTokens: string[],
    documentTokens: string[],
    avgDocLength: number,
    totalDocs: number,
    docsWithTerm: Map<string, number>
  ): number {
    const docLength = documentTokens.length;
    let score = 0;

    for (const queryToken of queryTokens) {
      // Term frequency in document
      const tf = documentTokens.filter(t => t === queryToken).length;

      if (tf === 0) continue;

      // Inverse document frequency
      const docsContaining = docsWithTerm.get(queryToken) || 1;
      const idf = Math.log((totalDocs - docsContaining + 0.5) / (docsContaining + 0.5) + 1);

      // BM25 formula
      const numerator = tf * (this.BM25_K1 + 1);
      const denominator = tf + this.BM25_K1 * (1 - this.BM25_B + this.BM25_B * (docLength / avgDocLength));

      score += idf * (numerator / denominator);
    }

    return score;
  }

  /**
   * Advanced search that combines multiple strategies:
   * 1. Exact name matching (highest priority)
   * 2. Fuzzy name matching
   * 3. BM25 ranking on tokenized names
   * 4. Code body search (if enabled)
   * 5. Comment search (if enabled)
   */
  static search(
    query: string,
    allSymbols: Symbol[],
    files: FileIndex[],
    options: SearchOptions = {}
  ): SearchMatch[] {
    const {
      maxResults = 20,
      fuzzyThreshold = 0.7,
      includeCodeBodies = true,
      includeComments = true,
      boostExactMatches = true,
    } = options;

    const queryTokens = this.tokenize(query);
    const expandedTokens = new Set<string>();

    // Expand query tokens
    for (const token of queryTokens) {
      this.expandQuery(token).forEach(exp => expandedTokens.add(exp));
    }

    const matches: SearchMatch[] = [];

    // Build document frequency map for BM25
    const termDocFreq = new Map<string, number>();
    let totalTokenCount = 0;

    for (const symbol of allSymbols) {
      const symbolTokens = this.tokenize(symbol.name);
      const uniqueTokens = new Set(symbolTokens);

      for (const token of uniqueTokens) {
        termDocFreq.set(token, (termDocFreq.get(token) || 0) + 1);
      }

      totalTokenCount += symbolTokens.length;
    }

    const avgDocLength = allSymbols.length > 0 ? totalTokenCount / allSymbols.length : 1;

    // Search each symbol
    for (const symbol of allSymbols) {
      let score = 0;
      const matchReasons: string[] = [];
      const highlights: string[] = [];

      const symbolNameLower = symbol.name.toLowerCase();
      const queryLower = query.toLowerCase();

      // 1. Exact name match (highest score)
      if (symbolNameLower === queryLower) {
        score += 1000;
        matchReasons.push('exact name match');
        highlights.push(symbol.name);
      }

      // 2. Starts with query
      if (symbolNameLower.startsWith(queryLower)) {
        score += 500;
        matchReasons.push('name starts with query');
        highlights.push(symbol.name);
      }

      // 3. Contains query as substring
      if (symbolNameLower.includes(queryLower)) {
        score += 300;
        matchReasons.push('name contains query');
        highlights.push(symbol.name);
      }

      // 4. Fuzzy match on full name
      if (this.isFuzzyMatch(query, symbol.name, fuzzyThreshold)) {
        score += 200;
        matchReasons.push('fuzzy name match');
        highlights.push(symbol.name);
      }

      // 5. BM25 scoring on tokenized name
      const symbolTokens = this.tokenize(symbol.name);
      const bm25Score = this.calculateBM25Score(
        queryTokens,
        symbolTokens,
        avgDocLength,
        allSymbols.length,
        termDocFreq
      );

      if (bm25Score > 0) {
        score += bm25Score * 50; // Scale BM25 to our scoring range
        matchReasons.push(`tokenized match (BM25: ${bm25Score.toFixed(2)})`);
      }

      // 6. Check expanded query tokens
      for (const token of expandedTokens) {
        if (symbolTokens.some(st => st === token || this.isFuzzyMatch(token, st, 0.8))) {
          score += 30;
          matchReasons.push(`expanded query match: "${token}"`);
        }
      }

      // 7. Search in code body
      if (includeCodeBodies && symbol.code) {
        const codeTokens = this.tokenize(symbol.code);

        for (const queryToken of queryTokens) {
          const matchCount = codeTokens.filter(t =>
            t === queryToken || this.isFuzzyMatch(queryToken, t, 0.85)
          ).length;

          if (matchCount > 0) {
            score += matchCount * 10; // Points per occurrence
            matchReasons.push(`found "${queryToken}" ${matchCount}x in code`);

            // Extract context around match
            const lines = symbol.code.split('\n');
            for (const line of lines) {
              if (line.toLowerCase().includes(queryToken)) {
                highlights.push(line.trim().substring(0, 100));
                break; // One highlight per symbol is enough
              }
            }
          }
        }
      }

      // 8. Search in comments (if available)
      if (includeComments && symbol.docComment) {
        const commentTokens = this.tokenize(symbol.docComment);

        for (const queryToken of queryTokens) {
          if (commentTokens.includes(queryToken)) {
            score += 15;
            matchReasons.push(`found "${queryToken}" in comment`);
          }
        }
      }

      // 9. Type matching
      if (query.toLowerCase().includes(symbol.type)) {
        score += 20;
        matchReasons.push(`type matches: ${symbol.type}`);
      }

      // 10. Signature matching
      if (symbol.signature) {
        const sigTokens = this.tokenize(symbol.signature);
        for (const queryToken of queryTokens) {
          if (sigTokens.includes(queryToken)) {
            score += 25;
            matchReasons.push(`found "${queryToken}" in signature`);
          }
        }
      }

      // If we found any match, add it
      if (score > 0) {
        matches.push({
          symbol,
          score,
          matchReason: matchReasons,
          highlights: highlights.length > 0 ? highlights : [symbol.name],
        });
      }
    }

    // Sort by score (descending) and limit results
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, maxResults);
  }

  /**
   * Search for code patterns with context and ranking
   */
  static searchCodePatterns(
    pattern: string,
    files: FileIndex[],
    maxResults: number = 20
  ): Array<{
    filePath: string;
    line: number;
    matchedText: string;
    context: string;
    score: number;
  }> {
    const results: Array<{
      filePath: string;
      line: number;
      matchedText: string;
      context: string;
      score: number;
    }> = [];

    try {
      const regex = new RegExp(pattern, 'gi');
      const queryTokens = this.tokenize(pattern);

      for (const file of files) {
        // Build full code from all symbols
        const fullCode = file.symbols.map(s => s.code).join('\n\n');
        const lines = fullCode.split('\n');

        let match;
        const lineMatches = new Map<number, string[]>();

        // Find all matches
        while ((match = regex.exec(fullCode)) !== null) {
          const lineNumber = fullCode.substring(0, match.index).split('\n').length;

          if (!lineMatches.has(lineNumber)) {
            lineMatches.set(lineNumber, []);
          }
          lineMatches.get(lineNumber)!.push(match[0]);
        }

        // Score and add results
        for (const [lineNumber, matches] of lineMatches.entries()) {
          if (results.length >= maxResults) break;

          const contextStart = Math.max(0, lineNumber - 3);
          const contextEnd = Math.min(lines.length, lineNumber + 3);
          const context = lines
            .slice(contextStart, contextEnd)
            .map((line, idx) => {
              const actualLine = contextStart + idx + 1;
              const marker = actualLine === lineNumber ? '> ' : '  ';
              return `${marker}${actualLine}: ${line}`;
            })
            .join('\n');

          // Calculate score based on context
          let score = 100; // Base score

          // Boost if match is in function/class definition
          const lineText = lines[lineNumber - 1];
          if (lineText && (
            lineText.includes('function') ||
            lineText.includes('class') ||
            lineText.includes('def ') ||
            lineText.includes('func ')
          )) {
            score += 50;
          }

          // Boost if multiple query tokens appear nearby
          const contextTokens = this.tokenize(context);
          const matchingTokens = queryTokens.filter(qt => contextTokens.includes(qt));
          score += matchingTokens.length * 10;

          results.push({
            filePath: file.path,
            line: lineNumber,
            matchedText: matches.join(', '),
            context,
            score,
          });
        }
      }

      // Sort by score
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, maxResults);

    } catch (error) {
      console.error('Pattern search error:', error);
      return [];
    }
  }

  /**
   * Find symbols similar to a given symbol (for "related code" features)
   */
  static findSimilarSymbols(targetSymbol: Symbol, allSymbols: Symbol[], limit: number = 5): SearchMatch[] {
    const matches: SearchMatch[] = [];
    const targetTokens = this.tokenize(targetSymbol.name + ' ' + targetSymbol.code);

    for (const symbol of allSymbols) {
      if (symbol === targetSymbol) continue;

      const symbolTokens = this.tokenize(symbol.name + ' ' + symbol.code);

      // Calculate Jaccard similarity (intersection over union)
      const intersection = targetTokens.filter(t => symbolTokens.includes(t)).length;
      const union = new Set([...targetTokens, ...symbolTokens]).size;
      const similarity = union > 0 ? intersection / union : 0;

      if (similarity > 0.1) { // At least 10% similar
        matches.push({
          symbol,
          score: similarity * 100,
          matchReason: [`${(similarity * 100).toFixed(1)}% similar code`],
          highlights: [symbol.name],
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit);
  }
}
