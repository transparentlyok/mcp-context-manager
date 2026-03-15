import { Symbol, FileIndex } from './indexer.js';
import { RepositoryIndexer } from './indexer.js';

export interface DependencyNode {
  symbol: Symbol;
  dependencies: Symbol[];
  dependents: Symbol[];
  depth: number;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  edges: Map<string, Set<string>>;
}

export class DependencyTracker {
  private indexer: RepositoryIndexer;
  private graph: DependencyGraph;

  constructor(indexer: RepositoryIndexer) {
    this.indexer = indexer;
    this.graph = { nodes: new Map(), edges: new Map() };
  }

  /**
   * Build dependency graph from indexed symbols
   */
  buildGraph(): void {
    console.error('📊 Building dependency graph...');
    const startTime = Date.now();

    const allFiles = this.indexer.getAllFiles();
    let processedSymbols = 0;

    // First pass: Create nodes for all symbols
    for (const file of allFiles) {
      for (const symbol of file.symbols) {
        const key = this.getSymbolKey(symbol);
        this.graph.nodes.set(key, {
          symbol,
          dependencies: [],
          dependents: [],
          depth: 0,
        });
        processedSymbols++;
      }
    }

    // Second pass: Build edges based on imports and code references
    for (const file of allFiles) {
      this.analyzeFileDependencies(file);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`✅ Dependency graph built: ${processedSymbols} nodes, ${this.graph.edges.size} edges (${elapsed}s)`);
  }

  /**
   * Get dependencies for a symbol with configurable depth
   */
  getDependencies(symbol: Symbol, maxDepth: number = 2): Symbol[] {
    const key = this.getSymbolKey(symbol);
    const visited = new Set<string>();
    const result: Symbol[] = [];

    this.traverseDependencies(key, 0, maxDepth, visited, result);

    return result;
  }

  /**
   * Get smart context: symbol + its immediate dependencies (signatures only)
   */
  getSmartContext(symbol: Symbol): {
    primary: Symbol;
    dependencies: Array<{ symbol: Symbol; signatureOnly: boolean }>;
    tokenEstimate: number;
  } {
    const deps = this.getDependencies(symbol, 1); // Only immediate dependencies

    let tokenEstimate = this.estimateTokens(symbol.code);

    const dependencyInfo = deps.map(dep => {
      const signatureOnly = dep.type === 'function' || dep.type === 'class';
      if (signatureOnly && dep.signature) {
        tokenEstimate += this.estimateTokens(dep.signature);
      } else {
        tokenEstimate += this.estimateTokens(dep.code);
      }

      return { symbol: dep, signatureOnly };
    });

    return {
      primary: symbol,
      dependencies: dependencyInfo,
      tokenEstimate,
    };
  }

  /**
   * Visualize dependency tree
   */
  visualizeDependencyTree(symbol: Symbol, maxDepth: number = 2): string {
    const key = this.getSymbolKey(symbol);
    const visited = new Set<string>();
    const lines: string[] = [];

    lines.push(`🌳 Dependency Tree for ${symbol.name}`);
    lines.push('');
    this.buildTreeVisualization(key, 0, maxDepth, visited, lines, '');

    return lines.join('\n');
  }

  private traverseDependencies(
    key: string,
    currentDepth: number,
    maxDepth: number,
    visited: Set<string>,
    result: Symbol[]
  ): void {
    if (currentDepth >= maxDepth || visited.has(key)) return;

    visited.add(key);
    const node = this.graph.nodes.get(key);
    if (!node) return;

    result.push(node.symbol);

    const edges = this.graph.edges.get(key);
    if (edges) {
      for (const depKey of edges) {
        this.traverseDependencies(depKey, currentDepth + 1, maxDepth, visited, result);
      }
    }
  }

  private buildTreeVisualization(
    key: string,
    depth: number,
    maxDepth: number,
    visited: Set<string>,
    lines: string[],
    prefix: string
  ): void {
    if (depth >= maxDepth || visited.has(key)) return;

    visited.add(key);
    const node = this.graph.nodes.get(key);
    if (!node) return;

    const indent = '  '.repeat(depth);
    const connector = depth === 0 ? '' : '└─ ';
    const typeIcon = this.getTypeIcon(node.symbol.type);

    lines.push(`${indent}${connector}${typeIcon} ${node.symbol.name} (${node.symbol.filePath}:${node.symbol.line})`);

    const edges = this.graph.edges.get(key);
    if (edges && edges.size > 0) {
      for (const depKey of edges) {
        this.buildTreeVisualization(depKey, depth + 1, maxDepth, visited, lines, prefix + '  ');
      }
    }
  }

  private analyzeFileDependencies(file: FileIndex): void {
    // Analyze imports to build dependency edges
    for (const symbol of file.symbols) {
      const symbolKey = this.getSymbolKey(symbol);

      // Look for references to other symbols in the code
      for (const otherFile of this.indexer.getAllFiles()) {
        if (otherFile.path === file.path) continue;

        for (const otherSymbol of otherFile.symbols) {
          // Simple heuristic: if symbol name appears in code, it's a dependency
          if (symbol.code.includes(otherSymbol.name)) {
            this.addEdge(symbolKey, this.getSymbolKey(otherSymbol));
          }
        }
      }

      // Analyze imports
      for (const imp of file.imports) {
        // Try to find symbols that match import paths
        const importedSymbols = this.findSymbolsByImport(imp);
        for (const impSymbol of importedSymbols) {
          this.addEdge(symbolKey, this.getSymbolKey(impSymbol));
        }
      }
    }
  }

  private findSymbolsByImport(importPath: string): Symbol[] {
    const results: Symbol[] = [];
    const cleanPath = importPath.replace(/['"]/g, '').replace(/^\.\//, '');

    for (const file of this.indexer.getAllFiles()) {
      if (file.path.includes(cleanPath)) {
        results.push(...file.symbols);
      }
    }

    return results;
  }

  private addEdge(from: string, to: string): void {
    if (!this.graph.edges.has(from)) {
      this.graph.edges.set(from, new Set());
    }
    this.graph.edges.get(from)!.add(to);

    // Update dependency info on nodes
    const fromNode = this.graph.nodes.get(from);
    const toNode = this.graph.nodes.get(to);

    if (fromNode && toNode) {
      if (!fromNode.dependencies.some(d => this.getSymbolKey(d) === to)) {
        fromNode.dependencies.push(toNode.symbol);
      }
      if (!toNode.dependents.some(d => this.getSymbolKey(d) === from)) {
        toNode.dependents.push(fromNode.symbol);
      }
    }
  }

  private getSymbolKey(symbol: Symbol): string {
    return `${symbol.filePath}:${symbol.name}:${symbol.line}`;
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

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
