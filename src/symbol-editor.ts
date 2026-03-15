import * as fs from 'fs/promises';
import * as path from 'path';
import { RepositoryIndexer, Symbol } from './indexer.js';

export interface SymbolReference {
  filePath: string;
  line: number;
  column: number;
  context: string;
  type: 'usage' | 'definition';
}

/**
 * Symbol-level editing and navigation tools
 * NO LSP REQUIRED - uses our fast index + regex
 */
export class SymbolEditor {
  constructor(private indexer: RepositoryIndexer) {}

  /**
   * 🔍 FEATURE 1: Find References
   * Find all places where a symbol is used (basic regex-based)
   */
  async findReferences(symbolName: string): Promise<{
    symbol: Symbol | null;
    references: SymbolReference[];
    total: number;
  }> {
    console.error(`🔍 Finding references for: ${symbolName}`);

    // First, find the symbol definition
    const symbols = this.indexer.findSymbols(symbolName);
    const symbol = symbols.length > 0 ? symbols[0] : null;

    const references: SymbolReference[] = [];
    const allFiles = this.indexer.getAllFiles();

    // Search for usages in all files
    for (const file of allFiles) {
      if (!file.content) continue;

      const lines = file.content.split('\n');

      // Create regex for the symbol (word boundary)
      const regex = new RegExp(`\\b${this.escapeRegex(symbolName)}\\b`, 'g');

      lines.forEach((line, lineIndex) => {
        let match;
        while ((match = regex.exec(line)) !== null) {
          const isDefinition = symbol && file.path === symbol.filePath && lineIndex + 1 === symbol.line;

          references.push({
            filePath: file.path,
            line: lineIndex + 1,
            column: match.index,
            context: line.trim(),
            type: isDefinition ? 'definition' : 'usage',
          });
        }
      });
    }

    console.error(`✅ Found ${references.length} references`);
    return { symbol, references, total: references.length };
  }

  /**
   * 📝 FEATURE 2: Symbol-Level Editing - Insert After Symbol
   */
  async insertAfterSymbol(
    symbolName: string,
    codeToInsert: string,
    filePath?: string
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    console.error(`📝 Inserting code after symbol: ${symbolName}`);

    const symbols = this.indexer.findSymbols(symbolName);

    if (symbols.length === 0) {
      return { success: false, message: `Symbol "${symbolName}" not found` };
    }

    let targetSymbol: Symbol;
    if (filePath) {
      const matches = symbols.filter(s => s.filePath === filePath);
      if (matches.length === 0) {
        return { success: false, message: `Symbol not found in file "${filePath}"` };
      }
      targetSymbol = matches[0];
    } else {
      if (symbols.length > 1) {
        const locations = symbols.map(s => `  - ${s.filePath}:${s.line}`).join('\n');
        return {
          success: false,
          message: `Multiple symbols found. Specify filePath:\n${locations}`,
        };
      }
      targetSymbol = symbols[0];
    }

    // Read the file
    const fullPath = path.join(this.indexer.getRootPath(), targetSymbol.filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');

    // Insert after the symbol's end line
    const insertLine = targetSymbol.endLine;
    lines.splice(insertLine, 0, codeToInsert);

    // Write back
    await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');

    console.error(`✅ Inserted code after ${symbolName} at line ${insertLine}`);
    return {
      success: true,
      message: `Code inserted after "${symbolName}" at ${targetSymbol.filePath}:${insertLine}`,
      filePath: targetSymbol.filePath,
    };
  }

  /**
   * 📝 Symbol-Level Editing - Replace Symbol
   */
  async replaceSymbol(
    symbolName: string,
    newCode: string,
    filePath?: string
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    console.error(`📝 Replacing symbol: ${symbolName}`);

    const symbols = this.indexer.findSymbols(symbolName);

    if (symbols.length === 0) {
      return { success: false, message: `Symbol "${symbolName}" not found` };
    }

    let targetSymbol: Symbol;
    if (filePath) {
      const matches = symbols.filter(s => s.filePath === filePath);
      if (matches.length === 0) {
        return { success: false, message: `Symbol not found in file "${filePath}"` };
      }
      targetSymbol = matches[0];
    } else {
      if (symbols.length > 1) {
        const locations = symbols.map(s => `  - ${s.filePath}:${s.line}`).join('\n');
        return {
          success: false,
          message: `Multiple symbols found. Specify filePath:\n${locations}`,
        };
      }
      targetSymbol = symbols[0];
    }

    // Read the file
    const fullPath = path.join(this.indexer.getRootPath(), targetSymbol.filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');

    // Replace the symbol (from line to endLine)
    const startLine = targetSymbol.line - 1;
    const endLine = targetSymbol.endLine;

    lines.splice(startLine, endLine - startLine, newCode);

    // Write back
    await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');

    console.error(`✅ Replaced ${symbolName}`);
    return {
      success: true,
      message: `Symbol "${symbolName}" replaced at ${targetSymbol.filePath}:${targetSymbol.line}`,
      filePath: targetSymbol.filePath,
    };
  }

  /**
   * 📝 Symbol-Level Editing - Delete Symbol
   */
  async deleteSymbol(
    symbolName: string,
    filePath?: string
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    console.error(`📝 Deleting symbol: ${symbolName}`);

    const symbols = this.indexer.findSymbols(symbolName);

    if (symbols.length === 0) {
      return { success: false, message: `Symbol "${symbolName}" not found` };
    }

    let targetSymbol: Symbol;
    if (filePath) {
      const matches = symbols.filter(s => s.filePath === filePath);
      if (matches.length === 0) {
        return { success: false, message: `Symbol not found in file "${filePath}"` };
      }
      targetSymbol = matches[0];
    } else {
      if (symbols.length > 1) {
        const locations = symbols.map(s => `  - ${s.filePath}:${s.line}`).join('\n');
        return {
          success: false,
          message: `Multiple symbols found. Specify filePath:\n${locations}`,
        };
      }
      targetSymbol = symbols[0];
    }

    // Read the file
    const fullPath = path.join(this.indexer.getRootPath(), targetSymbol.filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');

    // Delete the symbol (from line to endLine)
    const startLine = targetSymbol.line - 1;
    const endLine = targetSymbol.endLine;

    lines.splice(startLine, endLine - startLine);

    // Write back
    await fs.writeFile(fullPath, lines.join('\n'), 'utf-8');

    console.error(`✅ Deleted ${symbolName}`);
    return {
      success: true,
      message: `Symbol "${symbolName}" deleted from ${targetSymbol.filePath}:${targetSymbol.line}`,
      filePath: targetSymbol.filePath,
    };
  }

  /**
   * 🔍 FEATURE 3: Enhanced Symbol Navigation - Get Symbol Usages
   */
  async getSymbolUsages(symbolName: string): Promise<string> {
    const result = await this.findReferences(symbolName);

    if (result.total === 0) {
      return `No usages found for "${symbolName}"`;
    }

    let output = `🔍 Symbol Usages: ${symbolName}\n`;
    output += '─'.repeat(70) + '\n\n';

    if (result.symbol) {
      output += `📍 Definition: ${result.symbol.filePath}:${result.symbol.line}\n`;
      output += `📦 Type: ${result.symbol.type}\n\n`;
    }

    output += `📊 Total references: ${result.total}\n\n`;

    // Group by file
    const byFile = new Map<string, SymbolReference[]>();
    for (const ref of result.references) {
      if (!byFile.has(ref.filePath)) {
        byFile.set(ref.filePath, []);
      }
      byFile.get(ref.filePath)!.push(ref);
    }

    output += `📁 References by file:\n\n`;
    for (const [file, refs] of byFile.entries()) {
      output += `  📄 ${file} (${refs.length} ${refs.length === 1 ? 'usage' : 'usages'})\n`;
      for (const ref of refs.slice(0, 10)) { // Max 10 per file for readability
        const icon = ref.type === 'definition' ? '🎯' : '📌';
        output += `    ${icon} Line ${ref.line}: ${ref.context.substring(0, 80)}\n`;
      }
      if (refs.length > 10) {
        output += `    ... and ${refs.length - 10} more\n`;
      }
      output += '\n';
    }

    output += '─'.repeat(70) + '\n';
    output += `💡 Found in ${byFile.size} files\n`;

    return output;
  }

  /**
   * 🔍 Enhanced Symbol Navigation - Get Related Symbols
   */
  async getRelatedSymbols(symbolName: string): Promise<string> {
    console.error(`🔍 Finding symbols related to: ${symbolName}`);

    const symbols = this.indexer.findSymbols(symbolName);
    if (symbols.length === 0) {
      return `Symbol "${symbolName}" not found`;
    }

    const targetSymbol = symbols[0];
    const allSymbols = this.getAllSymbols();

    // Find related symbols based on:
    // 1. Same file
    // 2. Similar names
    // 3. Mentioned in same context

    const related: Array<{ symbol: Symbol; reason: string; score: number }> = [];

    for (const sym of allSymbols) {
      if (sym === targetSymbol) continue;

      let score = 0;
      const reasons: string[] = [];

      // Same file = related
      if (sym.filePath === targetSymbol.filePath) {
        score += 50;
        reasons.push('same file');
      }

      // Similar name (edit distance)
      if (this.areSimilarNames(sym.name, targetSymbol.name)) {
        score += 30;
        reasons.push('similar name');
      }

      // One symbol mentions the other in code
      if (targetSymbol.code.includes(sym.name)) {
        score += 40;
        reasons.push('used in code');
      }
      if (sym.code.includes(targetSymbol.name)) {
        score += 40;
        reasons.push('uses this symbol');
      }

      // Same type
      if (sym.type === targetSymbol.type) {
        score += 10;
        reasons.push('same type');
      }

      if (score > 0) {
        related.push({ symbol: sym, reason: reasons.join(', '), score });
      }
    }

    // Sort by score
    related.sort((a, b) => b.score - a.score);

    let output = `🔗 Related Symbols for: ${symbolName}\n`;
    output += '─'.repeat(70) + '\n\n';
    output += `📍 Target: ${targetSymbol.name} (${targetSymbol.type})\n`;
    output += `📄 File: ${targetSymbol.filePath}:${targetSymbol.line}\n\n`;

    if (related.length === 0) {
      output += `No related symbols found.\n`;
      return output;
    }

    output += `📊 Found ${related.length} related symbols:\n\n`;

    for (const { symbol: sym, reason, score } of related.slice(0, 20)) {
      const icon = this.getTypeIcon(sym.type);
      output += `  ${icon} ${sym.name} (score: ${score})\n`;
      output += `     📄 ${sym.filePath}:${sym.line}\n`;
      output += `     💡 Reason: ${reason}\n\n`;
    }

    if (related.length > 20) {
      output += `  ... and ${related.length - 20} more\n\n`;
    }

    return output;
  }

  /**
   * Format symbol editing result for display
   */
  formatEditResult(result: { success: boolean; message: string; filePath?: string }): string {
    if (result.success) {
      return `✅ ${result.message}\n\n💡 File modified: ${result.filePath}\n🔄 Re-index to see changes in search.`;
    } else {
      return `❌ ${result.message}`;
    }
  }

  private getAllSymbols(): Symbol[] {
    const symbols: Symbol[] = [];
    for (const file of this.indexer.getAllFiles()) {
      symbols.push(...file.symbols);
    }
    return symbols;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private areSimilarNames(name1: string, name2: string): boolean {
    // Simple similarity check (edit distance < 3)
    const dist = this.levenshteinDistance(name1.toLowerCase(), name2.toLowerCase());
    return dist > 0 && dist <= 3;
  }

  private levenshteinDistance(str1: string, str2: string): number {
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
          dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + 1);
        }
      }
    }

    return dp[m][n];
  }

  private getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      function: '🔧',
      class: '📦',
      interface: '📋',
      type: '🏷️',
      variable: '📌',
      export: '📤',
    };
    return icons[type] || '📄';
  }
}
