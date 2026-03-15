import * as fs from 'fs/promises';
import * as path from 'path';
import { RepositoryIndexer, Symbol, FileIndex } from './indexer.js';
import { CodeSearchEngine, SearchMatch, SearchOptions } from './search-engine.js';

interface SearchResult {
  filePath: string;
  line: number;
  context: string;
  matchedText: string;
}

export class ContextRetriever {
  constructor(private indexer: RepositoryIndexer) {}

  async findSymbol(symbolName: string, type?: string): Promise<any> {
    const symbols = this.indexer.findSymbols(symbolName, type);

    if (symbols.length === 0) {
      // Try fuzzy search
      const allSymbols = this.getAllSymbols();
      const fuzzyMatches = allSymbols.filter(s => {
        const typeMatch = !type || type === 'any' || s.type === type;
        return typeMatch && CodeSearchEngine.isFuzzyMatch(symbolName, s.name, 0.65);
      });

      if (fuzzyMatches.length > 0) {
        return {
          found: false,
          message: `Symbol "${symbolName}" not found (exact match)`,
          didYouMean: fuzzyMatches.slice(0, 5).map(s => ({
            name: s.name,
            file: s.filePath,
            line: s.line,
            type: s.type,
            signature: s.signature,
          })),
          suggestion: 'Try one of the suggestions above, or use get_relevant_context for broader search',
        };
      }

      return {
        found: false,
        message: `Symbol "${symbolName}" not found`,
        suggestion: 'Try using get_relevant_context for intelligent search, or search_code for pattern matching',
      };
    }

    return {
      found: true,
      count: symbols.length,
      locations: symbols.map((s) => ({
        file: s.filePath,
        line: s.line,
        type: s.type,
        signature: s.signature,
      })),
    };
  }

  async getFunction(functionName: string, filePath?: string): Promise<string> {
    const symbols = this.indexer.findSymbols(functionName, 'function');

    if (symbols.length === 0) {
      return `Function "${functionName}" not found in index.\nTry indexing the repository first with index_repository tool.`;
    }

    let targetSymbol: Symbol;

    if (filePath) {
      // Normalize path to handle Windows vs Unix separators
      const normalizedInput = path.normalize(filePath);
      const matches = symbols.filter((s) => path.normalize(s.filePath) === normalizedInput);
      if (matches.length === 0) {
        return `Function "${functionName}" not found in file "${filePath}".\nFound in: ${symbols.map((s) => s.filePath).join(', ')}`;
      }
      targetSymbol = matches[0];
    } else {
      if (symbols.length > 1) {
        const locations = symbols.map((s) => `  - ${s.filePath}:${s.line}`).join('\n');
        return `Multiple functions named "${functionName}" found:\n${locations}\n\nPlease specify filePath to get the exact function.`;
      }
      targetSymbol = symbols[0];
    }

    return this.formatSymbolWithContext(targetSymbol);
  }

  async getClass(
    className: string,
    methods?: string[],
    filePath?: string
  ): Promise<string> {
    const symbols = this.indexer.findSymbols(className, 'class');

    if (symbols.length === 0) {
      return `Class "${className}" not found in index.`;
    }

    let targetSymbol: Symbol;

    if (filePath) {
      // Normalize path to handle Windows vs Unix separators
      const normalizedInput = path.normalize(filePath);
      const matches = symbols.filter((s) => path.normalize(s.filePath) === normalizedInput);
      if (matches.length === 0) {
        return `Class "${className}" not found in file "${filePath}".\nFound in: ${symbols.map((s) => s.filePath).join(', ')}`;
      }
      targetSymbol = matches[0];
    } else {
      if (symbols.length > 1) {
        const locations = symbols.map((s) => `  - ${s.filePath}:${s.line}`).join('\n');
        return `Multiple classes named "${className}" found:\n${locations}\n\nPlease specify filePath to get the exact class.`;
      }
      targetSymbol = symbols[0];
    }

    // If specific methods requested, extract only those
    if (methods && methods.length > 0) {
      return this.extractClassMethods(targetSymbol, methods);
    }

    return this.formatSymbolWithContext(targetSymbol);
  }

  async getRelevantContext(query: string, maxTokens: number): Promise<string> {
    // Use advanced search engine
    const allSymbols = this.getAllSymbols();
    const files = this.indexer.getAllFiles();

    const searchOptions: SearchOptions = {
      maxResults: 50, // Get more candidates, then filter by tokens
      fuzzyThreshold: 0.7,
      includeCodeBodies: true,
      includeComments: true,
      boostExactMatches: true,
    };

    const matches = CodeSearchEngine.search(query, allSymbols, files, searchOptions);

    if (matches.length === 0) {
      // Provide helpful suggestions
      const queryTokens = CodeSearchEngine.tokenize(query);
      const suggestions = this.getSuggestions(queryTokens);

      return `No relevant context found for query: "${query}"\n\n${
        suggestions.length > 0
          ? `Did you mean one of these?\n${suggestions.map(s => `  - ${s}`).join('\n')}\n\n`
          : ''
      }Try:\n- Using more specific terms\n- Checking for typos (fuzzy search is active but needs some similarity)\n- Using search_code for regex pattern matching\n- Using find_symbol for exact symbol lookup`;
    }

    // Build response within token limit
    let result = `🔍 Found ${matches.length} relevant results for: "${query}"\n\n`;
    let estimatedTokens = this.estimateTokens(result);
    let included = 0;

    for (const match of matches) {
      const formattedMatch = this.formatSearchMatch(match, true);
      const matchTokens = this.estimateTokens(formattedMatch);

      if (estimatedTokens + matchTokens > maxTokens) {
        result += `\n... (${matches.length - included} more results available, but truncated to stay within ${maxTokens} token limit)`;
        break;
      }

      result += formattedMatch + '\n\n---\n\n';
      estimatedTokens += matchTokens;
      included++;
    }

    return result;
  }

  async getFileSummary(filePath: string): Promise<string> {
    const fileIndex = this.indexer.getFileIndex(filePath);

    if (!fileIndex) {
      return `File "${filePath}" not found in index.\nMake sure the file exists and the repository is indexed.`;
    }

    let summary = `File: ${filePath}\n`;
    summary += `Language: ${fileIndex.language}\n`;
    summary += `Lines: ${fileIndex.lines}\n`;
    summary += `Size: ${this.formatBytes(fileIndex.size)}\n\n`;

    if (fileIndex.imports.length > 0) {
      summary += `Imports (${fileIndex.imports.length}):\n`;
      summary += fileIndex.imports.slice(0, 10).map((imp) => `  - ${imp}`).join('\n');
      if (fileIndex.imports.length > 10) {
        summary += `\n  ... and ${fileIndex.imports.length - 10} more`;
      }
      summary += '\n\n';
    }

    if (fileIndex.exports.length > 0) {
      summary += `Exports (${fileIndex.exports.length}):\n`;
      summary += fileIndex.exports.map((exp) => `  - ${exp}`).join('\n') + '\n\n';
    }

    if (fileIndex.symbols.length > 0) {
      const byType = this.groupByType(fileIndex.symbols);

      for (const [type, symbols] of Object.entries(byType)) {
        summary += `${type}s (${symbols.length}):\n`;
        summary += symbols
          .map((s) => `  - ${s.name} (line ${s.line})${s.signature ? `: ${s.signature}` : ''}`)
          .join('\n');
        summary += '\n\n';
      }
    }

    return summary;
  }

  async searchCode(
    pattern: string,
    filePattern?: string,
    maxResults: number = 10
  ): Promise<SearchResult[]> {
    let files = this.indexer.getAllFiles();

    // Filter by file pattern if provided
    if (filePattern) {
      files = files.filter(f => this.matchGlob(f.path, filePattern));
    }

    // Use advanced pattern search with ranking
    const results = CodeSearchEngine.searchCodePatterns(pattern, files, maxResults);

    // Convert to SearchResult format
    return results.map(r => ({
      filePath: r.filePath,
      line: r.line,
      matchedText: r.matchedText,
      context: r.context,
    }));
  }

  async getRepositoryStructure(subPath?: string, depth: number = 3): Promise<string> {
    const rootPath = this.indexer.getRootPath();
    const targetPath = subPath ? path.join(rootPath, subPath) : rootPath;

    const structure = await this.buildDirectoryTree(targetPath, rootPath, depth, 0);
    return `Repository Structure:\n${subPath ? `Path: ${subPath}\n` : ''}\n${structure}`;
  }

  async getDependencies(filePath: string, symbol?: string): Promise<any> {
    const fileIndex = this.indexer.getFileIndex(filePath);

    if (!fileIndex) {
      return {
        error: `File "${filePath}" not found in index.`,
      };
    }

    const result: any = {
      file: filePath,
      imports: fileIndex.imports,
      importCount: fileIndex.imports.length,
    };

    if (symbol) {
      // Find the symbol and analyze its dependencies
      const symbolObj = fileIndex.symbols.find((s) => s.name === symbol);
      if (symbolObj) {
        result.symbol = symbol;
        result.symbolType = symbolObj.type;
        result.usedSymbols = this.extractUsedSymbols(symbolObj.code, fileIndex.imports);
      } else {
        result.error = `Symbol "${symbol}" not found in ${filePath}`;
      }
    }

    return result;
  }

  async findSimilarSymbols(symbolName: string, limit: number = 5): Promise<string> {
    // Find the target symbol first
    const symbols = this.indexer.findSymbols(symbolName);

    if (symbols.length === 0) {
      return `Symbol "${symbolName}" not found.\nTry using find_symbol to locate it first.`;
    }

    const targetSymbol = symbols[0];
    const allSymbols = this.getAllSymbols();

    // Use search engine to find similar code
    const similar = CodeSearchEngine.findSimilarSymbols(targetSymbol, allSymbols, limit);

    if (similar.length === 0) {
      return `No similar symbols found for "${symbolName}".\nThis symbol may be unique in the codebase.`;
    }

    let result = `🔗 Found ${similar.length} symbols similar to "${symbolName}":\n\n`;

    for (const match of similar) {
      result += `📍 ${match.symbol.name} (${match.symbol.type})\n`;
      result += `   ${match.symbol.filePath}:${match.symbol.line}\n`;
      result += `   Similarity: ${match.score.toFixed(1)}% - ${match.matchReason[0]}\n`;

      if (match.symbol.signature) {
        result += `   ${match.symbol.signature}\n`;
      }

      result += '\n';
    }

    return result;
  }

  // Helper methods
  private formatSymbolWithContext(symbol: Symbol, compact: boolean = false): string {
    let result = `File: ${symbol.filePath}:${symbol.line}\n`;
    result += `Type: ${symbol.type}\n`;

    if (symbol.signature && !compact) {
      result += `Signature: ${symbol.signature}\n`;
    }

    result += `\n${symbol.code}`;

    return result;
  }

  private formatSearchMatch(match: SearchMatch, compact: boolean = false): string {
    let result = `📍 ${match.symbol.name} (${match.symbol.type}) - Score: ${match.score.toFixed(1)}\n`;
    result += `   ${match.symbol.filePath}:${match.symbol.line}\n`;

    if (match.matchReason.length > 0 && !compact) {
      result += `   Match reasons: ${match.matchReason.slice(0, 3).join(', ')}\n`;
    }

    if (match.highlights.length > 0) {
      result += `   ↳ ${match.highlights[0]}\n`;
    }

    if (!compact && match.symbol.signature) {
      result += `\n${match.symbol.signature}\n`;
    }

    if (!compact) {
      // Show first few lines of code
      const codeLines = match.symbol.code.split('\n').slice(0, 10);
      result += `\n${codeLines.join('\n')}`;
      if (match.symbol.code.split('\n').length > 10) {
        result += '\n...';
      }
    }

    return result;
  }

  private getAllSymbols(): Symbol[] {
    const allSymbols: Symbol[] = [];
    for (const file of this.indexer.getAllFiles()) {
      allSymbols.push(...file.symbols);
    }
    return allSymbols;
  }

  private getSuggestions(queryTokens: string[]): string[] {
    const allSymbols = this.getAllSymbols();
    const suggestions = new Set<string>();

    // Find symbols that partially match
    for (const symbol of allSymbols) {
      const symbolTokens = CodeSearchEngine.tokenize(symbol.name);

      for (const token of queryTokens) {
        if (symbolTokens.some(st => st.startsWith(token) || token.startsWith(st))) {
          suggestions.add(symbol.name);
          if (suggestions.size >= 5) break;
        }
      }

      if (suggestions.size >= 5) break;
    }

    return Array.from(suggestions);
  }

  private extractClassMethods(classSymbol: Symbol, methodNames: string[]): string {
    const lines = classSymbol.code.split('\n');
    let result = `Class: ${classSymbol.name} (${classSymbol.filePath}:${classSymbol.line})\n\n`;

    // Extract only requested methods
    for (const methodName of methodNames) {
      const methodRegex = new RegExp(
        `(?:async\\s+)?(?:public\\s+|private\\s+|protected\\s+)?${methodName}\\s*\\([^)]*\\)`,
        'g'
      );

      for (let i = 0; i < lines.length; i++) {
        if (methodRegex.test(lines[i])) {
          const methodStart = i;
          const methodEnd = this.findMethodEnd(lines, methodStart);
          result += lines.slice(methodStart, methodEnd).join('\n') + '\n\n';
          break;
        }
      }
    }

    return result;
  }

  private findMethodEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let foundStart = false;

    for (let i = startLine; i < lines.length; i++) {
      for (const char of lines[i]) {
        if (char === '{') {
          braceCount++;
          foundStart = true;
        } else if (char === '}') {
          braceCount--;
          if (foundStart && braceCount === 0) {
            return i + 1;
          }
        }
      }
    }

    return Math.min(startLine + 30, lines.length);
  }

  private calculateRelevanceScore(symbolName: string, query: string): number {
    const lowerSymbol = symbolName.toLowerCase();
    const lowerQuery = query.toLowerCase();

    if (lowerSymbol === lowerQuery) return 100;
    if (lowerSymbol.startsWith(lowerQuery)) return 80;
    if (lowerSymbol.includes(lowerQuery)) return 60;

    // Fuzzy matching
    let score = 0;
    for (const word of lowerQuery.split(/\s+/)) {
      if (lowerSymbol.includes(word)) {
        score += 20;
      }
    }

    return score;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private groupByType(symbols: Symbol[]): Record<string, Symbol[]> {
    const groups: Record<string, Symbol[]> = {};

    for (const symbol of symbols) {
      if (!groups[symbol.type]) {
        groups[symbol.type] = [];
      }
      groups[symbol.type].push(symbol);
    }

    return groups;
  }

  private getLineNumber(content: string, index: number): number {
    return content.substring(0, index).split('\n').length;
  }

  private matchGlob(filePath: string, pattern: string): boolean {
    // Simple glob matching (supports * and **)
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }

  private async buildDirectoryTree(
    dirPath: string,
    rootPath: string,
    maxDepth: number,
    currentDepth: number,
    prefix: string = ''
  ): Promise<string> {
    if (currentDepth >= maxDepth) {
      return '';
    }

    let result = '';

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const filtered = entries.filter((e) => {
        const name = e.name;
        return !name.startsWith('.') && name !== 'node_modules' && name !== 'dist';
      });

      for (let i = 0; i < filtered.length; i++) {
        const entry = filtered[i];
        const isLast = i === filtered.length - 1;
        const marker = isLast ? '└── ' : '├── ';
        const newPrefix = prefix + (isLast ? '    ' : '│   ');

        if (entry.isDirectory()) {
          result += `${prefix}${marker}${entry.name}/\n`;
          const subPath = path.join(dirPath, entry.name);
          result += await this.buildDirectoryTree(
            subPath,
            rootPath,
            maxDepth,
            currentDepth + 1,
            newPrefix
          );
        } else {
          const ext = path.extname(entry.name);
          result += `${prefix}${marker}${entry.name}`;

          // Add file type indicator
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            result += ' (TS/JS)';
          } else if (ext === '.py') {
            result += ' (Python)';
          } else if (ext === '.go') {
            result += ' (Go)';
          } else if (['.json', '.yaml', '.yml'].includes(ext)) {
            result += ' (Config)';
          }

          result += '\n';
        }
      }
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
    }

    return result;
  }

  private extractUsedSymbols(code: string, imports: string[]): string[] {
    // Simple extraction of identifiers that might be from imports
    const identifiers = code.match(/\b[A-Z][a-zA-Z0-9_]*\b/g) || [];
    return [...new Set(identifiers)].filter((id) => {
      return imports.some((imp) => imp.includes(id));
    });
  }
}
