import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';

export interface Symbol {
  name: string;
  type: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'export';
  filePath: string;
  line: number;
  endLine: number;
  code: string;
  signature?: string;
  docComment?: string;
}

export interface FileIndex {
  path: string;
  symbols: Symbol[];
  imports: string[];
  exports: string[];
  size: number;
  lines: number;
  language: string;
}

interface CacheMetadata {
  version: string;
  rootPath: string;
  indexedAt: number;
  fileCount: number;
  symbolCount: number;
  filesHash: string; // Hash of file paths and modification times
}

export class RepositoryIndexer {
  private index: Map<string, FileIndex> = new Map();
  private symbolMap: Map<string, Symbol[]> = new Map();
  private rootPath: string = '';
  private ignorePatterns: string[] = [];
  private static readonly CACHE_VERSION = '1.0.0';
  private static readonly CACHE_DIR = '.mcp-cache';

  constructor() {
    this.ignorePatterns = [];
  }

  async indexRepository(rootPath: string, forceReindex: boolean = false): Promise<void> {
    this.rootPath = rootPath;

    // Try to load from cache if not forcing re-index
    if (!forceReindex) {
      const loaded = await this.loadFromCache(rootPath);
      if (loaded) {
        console.error(`Loaded from cache: ${this.index.size} files with ${this.getTotalSymbols()} symbols`);
        return;
      }
    }

    // Clear existing index
    this.index.clear();
    this.symbolMap.clear();

    // Load ignore patterns
    await this.loadIgnorePatterns();

    // Index all files
    await this.indexDirectory(rootPath);

    console.error(`Indexed ${this.index.size} files with ${this.getTotalSymbols()} symbols`);

    // Save to cache
    await this.saveToCache(rootPath);
  }

  private async loadIgnorePatterns(): Promise<void> {
    const gitignorePath = path.join(this.rootPath, '.gitignore');

    // Default patterns
    this.ignorePatterns = [
      'node_modules',
      '.git',
      'dist',
      'build',
      'coverage',
      '.next',
      '.nuxt',
      'out',
      '.cache',
      '*.min.js',
      '*.map',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
    ];

    try {
      const gitignore = await fs.readFile(gitignorePath, 'utf-8');
      const lines = gitignore
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      this.ignorePatterns.push(...lines);
    } catch {
      // No gitignore file
    }
  }

  private shouldIgnore(relativePath: string): boolean {
    const parts = relativePath.split(path.sep);

    for (const pattern of this.ignorePatterns) {
      // Exact match
      if (relativePath === pattern) return true;

      // Directory match
      if (parts.includes(pattern)) return true;

      // Wildcard match (simple implementation)
      if (pattern.includes('*')) {
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`);
        if (regex.test(relativePath) || regex.test(path.basename(relativePath))) {
          return true;
        }
      }

      // Starts with pattern (e.g., "dist/" matches "dist/file.js")
      if (pattern.endsWith('/') && relativePath.startsWith(pattern)) {
        return true;
      }
    }

    return false;
  }

  private async indexDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.rootPath, fullPath);

        if (this.shouldIgnore(relativePath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await this.indexDirectory(fullPath);
        } else if (entry.isFile()) {
          await this.indexFile(fullPath);
        }
      }
    } catch (error) {
      console.error(`Error indexing directory ${dirPath}:`, error);
    }
  }

  private async indexFile(filePath: string): Promise<void> {
    const ext = path.extname(filePath);
    const supportedExtensions = [
      '.js', '.ts', '.jsx', '.tsx',  // JavaScript/TypeScript
      '.py',                          // Python
      '.go',                          // Go
      '.rs',                          // Rust
      '.java',                        // Java
      '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',  // C/C++
      '.cs',                          // C#
      '.lua', '.luau'                 // Lua
    ];

    if (!supportedExtensions.includes(ext)) {
      return;
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stats = await fs.stat(filePath);
      const lines = content.split('\n');
      const language = this.detectLanguage(ext);

      const fileIndex: FileIndex = {
        path: path.relative(this.rootPath, filePath),
        symbols: [],
        imports: [],
        exports: [],
        size: stats.size,
        lines: lines.length,
        language,
      };

      // Parse file based on language
      if (language === 'typescript' || language === 'javascript') {
        this.parseJavaScriptTypeScript(content, lines, fileIndex);
      } else if (language === 'python') {
        this.parsePython(content, lines, fileIndex);
      } else if (language === 'go') {
        this.parseGo(content, lines, fileIndex);
      } else if (language === 'c' || language === 'cpp') {
        this.parseCpp(content, lines, fileIndex);
      } else if (language === 'csharp') {
        this.parseCSharp(content, lines, fileIndex);
      } else if (language === 'lua') {
        this.parseLua(content, lines, fileIndex);
      } else if (language === 'rust') {
        this.parseRust(content, lines, fileIndex);
      } else if (language === 'java') {
        this.parseJava(content, lines, fileIndex);
      }

      this.index.set(fileIndex.path, fileIndex);

      // Update symbol map
      for (const symbol of fileIndex.symbols) {
        if (!this.symbolMap.has(symbol.name)) {
          this.symbolMap.set(symbol.name, []);
        }
        this.symbolMap.get(symbol.name)!.push(symbol);
      }
    } catch (error) {
      console.error(`Error indexing file ${filePath}:`, error);
    }
  }

  private detectLanguage(ext: string): string {
    const map: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.cc': 'cpp',
      '.cxx': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.hxx': 'cpp',
      '.cs': 'csharp',
      '.lua': 'lua',
      '.luau': 'lua',
    };
    return map[ext] || 'unknown';
  }

  private parseJavaScriptTypeScript(content: string, lines: string[], fileIndex: FileIndex): void {
    // Parse imports
    const importRegex = /import\s+(?:{[^}]+}|[\w*]+)?\s*(?:,\s*{[^}]+})?\s*from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      fileIndex.imports.push(match[1]);
    }

    // Parse exports
    const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([\w]+)/g;
    while ((match = exportRegex.exec(content)) !== null) {
      fileIndex.exports.push(match[1]);
    }

    // Parse functions (including arrow functions and methods)
    this.parseFunctions(content, lines, fileIndex);

    // Parse classes
    this.parseClasses(content, lines, fileIndex);

    // Parse interfaces and types (TypeScript)
    this.parseTypesInterfaces(content, lines, fileIndex);

    // Parse const/let/var declarations
    this.parseVariables(content, lines, fileIndex);
  }

  private parseFunctions(content: string, lines: string[], fileIndex: FileIndex): void {
    // Regular function declarations
    const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)/g;
    let match;
    while ((match = functionRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'function',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Arrow functions assigned to const/let/var
    const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g;
    while ((match = arrowRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findStatementEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'function',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }
  }

  private parseClasses(content: string, lines: string[], fileIndex: FileIndex): void {
    const classRegex = /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+\w+)?(?:\s+implements\s+[\w,\s]+)?/g;
    let match;
    while ((match = classRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'class',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }
  }

  private parseTypesInterfaces(content: string, lines: string[], fileIndex: FileIndex): void {
    // Interfaces
    const interfaceRegex = /(?:export\s+)?interface\s+(\w+)/g;
    let match;
    while ((match = interfaceRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'interface',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Type aliases
    const typeRegex = /(?:export\s+)?type\s+(\w+)\s*=/g;
    while ((match = typeRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findStatementEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'type',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }
  }

  private parseVariables(content: string, lines: string[], fileIndex: FileIndex): void {
    // Only index exported variables to reduce noise
    const varRegex = /export\s+(?:const|let|var)\s+(\w+)/g;
    let match;
    while ((match = varRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findStatementEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'variable',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }
  }

  private parsePython(content: string, lines: string[], fileIndex: FileIndex): void {
    // Parse imports
    const importRegex = /^(?:from\s+[\w.]+\s+)?import\s+(.+)$/gm;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      fileIndex.imports.push(match[1].trim());
    }

    // Parse functions
    const functionRegex = /^(?:async\s+)?def\s+(\w+)\s*\([^)]*\):/gm;
    while ((match = functionRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findPythonBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'function',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Parse classes
    const classRegex = /^class\s+(\w+)(?:\([^)]*\))?:/gm;
    while ((match = classRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findPythonBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'class',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }
  }

  private parseGo(content: string, lines: string[], fileIndex: FileIndex): void {
    // Parse imports
    const importRegex = /import\s+(?:"([^"]+)"|[(]([^)]+)[)])/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const imports = match[1] || match[2];
      fileIndex.imports.push(imports);
    }

    // Parse functions
    const functionRegex = /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\([^)]*\)/g;
    while ((match = functionRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'function',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Parse types and structs
    const typeRegex = /type\s+(\w+)\s+(?:struct|interface)/g;
    while ((match = typeRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'type',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }
  }

  private parseCpp(content: string, lines: string[], fileIndex: FileIndex): void {
    // Parse includes
    const includeRegex = /#include\s+[<"]([^>"]+)[>"]/g;
    let match;
    while ((match = includeRegex.exec(content)) !== null) {
      fileIndex.imports.push(match[1]);
    }

    // Parse functions (both declarations and definitions)
    // Matches: return_type function_name(params) { or return_type function_name(params);
    const functionRegex = /(?:^|\n)\s*(?:static\s+|inline\s+|virtual\s+|extern\s+)*(?:[\w:]+(?:<[^>]+>)?)\s+(\w+)\s*\([^)]*\)\s*(?:const\s+)?(?:override\s+)?(?:noexcept\s+)?[{;]/gm;
    while ((match = functionRegex.exec(content)) !== null) {
      const name = match[1];
      // Skip common keywords that might match
      if (['if', 'while', 'for', 'switch', 'catch'].includes(name)) continue;

      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name,
        type: 'function',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0].trim(),
      });
    }

    // Parse classes and structs
    const classRegex = /(?:class|struct)\s+(?:__declspec\([^)]+\)\s+)?(\w+)(?:\s*:\s*(?:public|private|protected)\s+[\w:,\s]+)?/g;
    while ((match = classRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'class',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Parse namespaces
    const namespaceRegex = /namespace\s+(\w+)/g;
    while ((match = namespaceRegex.exec(content)) !== null) {
      fileIndex.exports.push(match[1]);
    }
  }

  private parseCSharp(content: string, lines: string[], fileIndex: FileIndex): void {
    // Parse using statements
    const usingRegex = /using\s+(?:static\s+)?([^;]+);/g;
    let match;
    while ((match = usingRegex.exec(content)) !== null) {
      fileIndex.imports.push(match[1].trim());
    }

    // Parse namespaces
    const namespaceRegex = /namespace\s+([\w.]+)/g;
    while ((match = namespaceRegex.exec(content)) !== null) {
      fileIndex.exports.push(match[1]);
    }

    // Parse methods
    const methodRegex = /(?:public|private|protected|internal)?\s*(?:static\s+)?(?:async\s+)?(?:virtual\s+)?(?:override\s+)?[\w<>[\]]+\s+(\w+)\s*\([^)]*\)\s*(?:where\s+[^{]+)?{/g;
    while ((match = methodRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'function',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0].replace(/\s*{$/, ''),
      });
    }

    // Parse classes and interfaces
    const classRegex = /(?:public|private|internal)?\s*(?:abstract\s+|sealed\s+|static\s+)?(class|interface|struct|record)\s+(\w+)(?:<[^>]+>)?(?:\s*:\s*[^{]+)?/g;
    while ((match = classRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[2],
        type: match[1] === 'interface' ? 'interface' : 'class',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Parse properties
    const propertyRegex = /(?:public|private|protected|internal)\s+(?:static\s+)?[\w<>[\]]+\s+(\w+)\s*{\s*get/g;
    while ((match = propertyRegex.exec(content)) !== null) {
      fileIndex.symbols.push({
        name: match[1],
        type: 'variable',
        filePath: fileIndex.path,
        line: this.getLineNumber(content, match.index),
        endLine: this.getLineNumber(content, match.index),
        code: match[0],
        signature: match[0],
      });
    }
  }

  private parseLua(content: string, lines: string[], fileIndex: FileIndex): void {
    // Parse require statements
    const requireRegex = /(?:local\s+\w+\s*=\s*)?require\s*\(?\s*["']([^"']+)["']\s*\)?/g;
    let match;
    while ((match = requireRegex.exec(content)) !== null) {
      fileIndex.imports.push(match[1]);
    }

    // Parse functions (both local and global)
    const functionRegex = /(?:local\s+)?function\s+([:\w.]+)\s*\([^)]*\)/g;
    while ((match = functionRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findLuaBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      const name = match[1].split(/[.:]/).pop() || match[1];

      fileIndex.symbols.push({
        name,
        type: 'function',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Parse Luau type definitions
    const typeRegex = /(?:export\s+)?type\s+(\w+)\s*=/g;
    while ((match = typeRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      fileIndex.symbols.push({
        name: match[1],
        type: 'type',
        filePath: fileIndex.path,
        line,
        endLine: line,
        code: lines[line - 1],
        signature: match[0],
      });
    }

    // Parse return tables (module exports)
    const returnRegex = /return\s*{/g;
    while ((match = returnRegex.exec(content)) !== null) {
      fileIndex.exports.push('module');
    }
  }

  private parseRust(content: string, lines: string[], fileIndex: FileIndex): void {
    // Parse use statements
    const useRegex = /use\s+([^;]+);/g;
    let match;
    while ((match = useRegex.exec(content)) !== null) {
      fileIndex.imports.push(match[1]);
    }

    // Parse functions
    const functionRegex = /(?:pub\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]+"\s+)?fn\s+(\w+)\s*(?:<[^>]+>)?\s*\([^)]*\)/g;
    while ((match = functionRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[1],
        type: 'function',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Parse structs and enums
    const structRegex = /(?:pub\s+)?(struct|enum|trait)\s+(\w+)(?:<[^>]+>)?/g;
    while ((match = structRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[2],
        type: match[1] === 'trait' ? 'interface' : 'class',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Parse impl blocks
    const implRegex = /impl(?:<[^>]+>)?\s+(?:[\w:]+\s+for\s+)?(\w+)/g;
    while ((match = implRegex.exec(content)) !== null) {
      fileIndex.exports.push(match[1]);
    }
  }

  private parseJava(content: string, lines: string[], fileIndex: FileIndex): void {
    // Parse imports
    const importRegex = /import\s+(?:static\s+)?([^;]+);/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      fileIndex.imports.push(match[1]);
    }

    // Parse package
    const packageRegex = /package\s+([^;]+);/g;
    while ((match = packageRegex.exec(content)) !== null) {
      fileIndex.exports.push(match[1]);
    }

    // Parse methods
    const methodRegex = /(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?(?:synchronized\s+)?(?:abstract\s+)?(?:<[^>]+>\s+)?[\w<>[\]]+\s+(\w+)\s*\([^)]*\)(?:\s+throws\s+[^{]+)?/g;
    while ((match = methodRegex.exec(content)) !== null) {
      const name = match[1];
      // Skip constructors and common keywords
      if (['if', 'while', 'for', 'switch', 'catch', 'synchronized'].includes(name)) continue;

      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name,
        type: 'function',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }

    // Parse classes and interfaces
    const classRegex = /(?:public|private|protected)?\s*(?:abstract\s+|final\s+)?(class|interface|enum)\s+(\w+)(?:<[^>]+>)?(?:\s+extends\s+[\w<>,\s]+)?(?:\s+implements\s+[\w<>,\s]+)?/g;
    while ((match = classRegex.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index);
      const endLine = this.findBlockEnd(lines, line);
      const code = lines.slice(line - 1, endLine).join('\n');

      fileIndex.symbols.push({
        name: match[2],
        type: match[1] === 'interface' ? 'interface' : 'class',
        filePath: fileIndex.path,
        line,
        endLine,
        code,
        signature: match[0],
      });
    }
  }

  private findLuaBlockEnd(lines: string[], startLine: number): number {
    let depth = 1;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();

      // Count function, if, for, while, do, repeat as block starts
      if (/\b(?:function|if|for|while|do|repeat)\b/.test(line)) {
        depth++;
      }

      // Count end and until as block ends
      if (/\bend\b/.test(line) || /\buntil\b/.test(line)) {
        depth--;
        if (depth === 0) {
          return i + 1;
        }
      }
    }

    return Math.min(startLine + 50, lines.length);
  }

  private getLineNumber(content: string, index: number): number {
    return content.substring(0, index).split('\n').length;
  }

  private findBlockEnd(lines: string[], startLine: number): number {
    let braceCount = 0;
    let foundStart = false;

    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
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

    return Math.min(startLine + 50, lines.length); // Fallback: 50 lines max
  }

  private findStatementEnd(lines: string[], startLine: number): number {
    for (let i = startLine - 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.endsWith(';') || line.endsWith(',')) {
        return i + 1;
      }
      // Multi-line check: if next line doesn't seem like continuation
      if (i < lines.length - 1) {
        const nextLine = lines[i + 1].trim();
        if (nextLine && !nextLine.startsWith('.') && !nextLine.startsWith('(')) {
          return i + 1;
        }
      }
    }
    return Math.min(startLine + 10, lines.length);
  }

  private findPythonBlockEnd(lines: string[], startLine: number): number {
    const baseIndent = lines[startLine - 1].search(/\S/);

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '') continue; // Skip empty lines

      const indent = line.search(/\S/);
      if (indent <= baseIndent && indent !== -1) {
        return i;
      }
    }

    return lines.length;
  }

  // Public query methods
  getFileIndex(filePath: string): FileIndex | undefined {
    // Normalize path to handle Windows vs Unix separators
    const normalizedPath = path.normalize(filePath);
    // Try normalized path first
    let fileIndex = this.index.get(normalizedPath);
    // If not found, search through all entries with normalized comparison
    if (!fileIndex) {
      for (const [key, value] of this.index.entries()) {
        if (path.normalize(key) === normalizedPath) {
          fileIndex = value;
          break;
        }
      }
    }
    return fileIndex;
  }

  findSymbols(name: string, type?: string): Symbol[] {
    const symbols = this.symbolMap.get(name) || [];
    if (type && type !== 'any') {
      return symbols.filter((s) => s.type === type);
    }
    return symbols;
  }

  searchSymbols(query: string): Symbol[] {
    const results: Symbol[] = [];
    const lowerQuery = query.toLowerCase();

    for (const [name, symbols] of this.symbolMap.entries()) {
      if (name.toLowerCase().includes(lowerQuery)) {
        results.push(...symbols);
      }
    }

    return results;
  }

  getAllFiles(): FileIndex[] {
    return Array.from(this.index.values());
  }

  getStats() {
    return {
      totalFiles: this.index.size,
      totalSymbols: this.getTotalSymbols(),
    };
  }

  private getTotalSymbols(): number {
    let count = 0;
    for (const symbols of this.symbolMap.values()) {
      count += symbols.length;
    }
    return count;
  }

  getRootPath(): string {
    return this.rootPath;
  }

  // Cache management methods
  private getCachePath(rootPath: string): string {
    // Create a safe cache filename from the root path
    const hash = crypto.createHash('md5').update(rootPath).digest('hex');
    const cacheDir = path.join(rootPath, RepositoryIndexer.CACHE_DIR);
    return path.join(cacheDir, `index-${hash}.json`);
  }

  private async getFilesHash(rootPath: string): Promise<string> {
    const allFiles: string[] = [];

    const collectFiles = async (dirPath: string) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(rootPath, fullPath);

          if (this.shouldIgnore(relativePath)) continue;

          if (entry.isDirectory()) {
            await collectFiles(fullPath);
          } else if (entry.isFile()) {
            // Only collect supported file extensions
            const ext = path.extname(fullPath);
            const supportedExts = [
              '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java',
              '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
              '.cs', '.lua', '.luau'
            ];
            if (supportedExts.includes(ext)) {
              allFiles.push(relativePath);
            }
          }
        }
      } catch (error) {
        // Ignore errors in subdirectories
      }
    };

    await collectFiles(rootPath);

    // Create hash from file count and sorted file paths
    // Note: Not using mtimes to avoid cache invalidation from minor file touches
    const hash = crypto.createHash('md5');
    hash.update(`count:${allFiles.length}|`);
    hash.update(allFiles.sort().join('|'));
    return hash.digest('hex');
  }

  private async loadFromCache(rootPath: string): Promise<boolean> {
    try {
      const cachePath = this.getCachePath(rootPath);
      const cacheData = await fs.readFile(cachePath, 'utf-8');
      const cache = JSON.parse(cacheData);

      // Verify cache version
      if (cache.version !== RepositoryIndexer.CACHE_VERSION) {
        console.error('Cache version mismatch, re-indexing...');
        return false;
      }

      // Verify cache is for the same repository
      if (cache.metadata.rootPath !== rootPath) {
        console.error('Cache path mismatch, re-indexing...');
        return false;
      }

      // Load ignore patterns BEFORE checking hash
      await this.loadIgnorePatterns();

      // Check if files have changed
      const currentHash = await this.getFilesHash(rootPath);
      if (cache.metadata.filesHash !== currentHash) {
        console.error('Files changed, re-indexing...');
        return false;
      }

      // Restore index from cache
      this.index.clear();
      this.symbolMap.clear();

      for (const [filePath, fileIndex] of Object.entries(cache.index)) {
        this.index.set(filePath, fileIndex as FileIndex);
      }

      for (const [symbolName, symbols] of Object.entries(cache.symbolMap)) {
        this.symbolMap.set(symbolName, symbols as Symbol[]);
      }

      this.rootPath = rootPath;
      return true;
    } catch (error) {
      // Cache doesn't exist or is invalid
      return false;
    }
  }

  private async saveToCache(rootPath: string): Promise<void> {
    try {
      const cachePath = this.getCachePath(rootPath);
      const cacheDir = path.dirname(cachePath);

      // Create cache directory if it doesn't exist
      await fs.mkdir(cacheDir, { recursive: true });

      // Get current files hash
      const filesHash = await this.getFilesHash(rootPath);

      const metadata: CacheMetadata = {
        version: RepositoryIndexer.CACHE_VERSION,
        rootPath,
        indexedAt: Date.now(),
        fileCount: this.index.size,
        symbolCount: this.getTotalSymbols(),
        filesHash,
      };

      const cache = {
        version: RepositoryIndexer.CACHE_VERSION,
        metadata,
        index: Object.fromEntries(this.index),
        symbolMap: Object.fromEntries(this.symbolMap),
      };

      await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
      console.error(`Cache saved to ${cachePath}`);
    } catch (error) {
      console.error('Failed to save cache:', error);
      // Don't fail if we can't save cache
    }
  }

  async clearCache(rootPath: string): Promise<void> {
    try {
      const cachePath = this.getCachePath(rootPath);
      await fs.unlink(cachePath);
      console.error('Cache cleared');
    } catch (error) {
      // Cache file doesn't exist or can't be deleted
    }
  }
}
