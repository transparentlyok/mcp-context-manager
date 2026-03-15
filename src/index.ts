#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { RepositoryIndexer } from './indexer.js';
import { ContextRetriever } from './retriever.js';

const server = new Server(
  {
    name: 'mcp-context-manager',
    version: '3.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Initialize indexer and retriever
const indexer = new RepositoryIndexer();
const retriever = new ContextRetriever(indexer);

// Token usage tracking
interface ToolUsageEntry {
  calls: number;
  totalTokens: number;
  totalChars: number;
  avgTokensPerCall: number;
  estimatedFullReadTokens: number;
  filesReferenced: Set<string>; // Track unique files touched by this tool
}

const usageStats: Record<string, ToolUsageEntry> = {};
const allFilesReferenced = new Set<string>(); // Global dedup across all tools
let sessionStartTime = Date.now();

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function normalizePath(filePath: string): string {
  // Normalize to forward slashes, unescape double backslashes,
  // strip absolute path prefixes to get relative path
  let normalized = filePath
    .replace(/\\\\/g, '/')  // double backslash (JSON escaped) → forward slash
    .replace(/\\/g, '/')    // single backslash → forward slash
    .trim();

  // Strip absolute path prefix if present (e.g., C:\Users\...\express\lib\app.js → lib/app.js)
  // Find the repo-relative part by looking for common root indicators
  const rootPath = indexer.getRootPath().replace(/\\/g, '/');
  if (normalized.startsWith(rootPath)) {
    normalized = normalized.substring(rootPath.length);
    if (normalized.startsWith('/')) normalized = normalized.substring(1);
  }

  return normalized;
}

function extractFilePathsFromResponse(responseText: string): string[] {
  const patterns = [
    /File:\s*([^\n:]+?)(?::\d+)?$/gm,           // "File: lib\app.js:42"
    /^\s+([a-zA-Z][\w/\\.-]+\.\w+):\d+/gm,      // "   lib/app.js:42"
    /\"filePath\":\s*\"([^"]+)\"/g,               // JSON "filePath": "lib/app.js"
    /\"file\":\s*\"([^"]+)\"/g,                   // JSON "file": "lib/app.js"
  ];

  const files = new Set<string>();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(responseText)) !== null) {
      const filePath = match[1].trim();
      if (filePath && !filePath.includes(' ') && filePath.includes('.')) {
        files.add(normalizePath(filePath));
      }
    }
  }
  return Array.from(files);
}

function getFileTokenCount(filePath: string): number {
  const fileIndex = indexer.getFileIndex(filePath);
  if (fileIndex?.content) {
    return estimateTokens(fileIndex.content);
  }
  // Fallback: estimate from file size if no content
  if (fileIndex) {
    return Math.ceil(fileIndex.size / 4);
  }
  return 0;
}

function trackUsage(toolName: string, responseText: string, referencedFiles: string[] = []) {
  if (!usageStats[toolName]) {
    usageStats[toolName] = {
      calls: 0, totalTokens: 0, totalChars: 0,
      avgTokensPerCall: 0, estimatedFullReadTokens: 0,
      filesReferenced: new Set(),
    };
  }
  const entry = usageStats[toolName];
  const tokens = estimateTokens(responseText);
  entry.calls++;
  entry.totalTokens += tokens;
  entry.totalChars += responseText.length;
  entry.avgTokensPerCall = Math.round(entry.totalTokens / entry.calls);

  // Track unique files and their full-read cost (only count each file once globally)
  for (const file of referencedFiles) {
    if (!allFilesReferenced.has(file)) {
      allFilesReferenced.add(file);
      entry.filesReferenced.add(file);
      entry.estimatedFullReadTokens += getFileTokenCount(file);
    }
  }
}

// Define available tools
const tools: Tool[] = [
  {
    name: 'index_repository',
    description: '🔧 REQUIRED FIRST STEP: Index or re-index the repository to enable all context-manager tools. Uses cached index if files haven\'t changed. ALWAYS call this when starting work on a repository or if files have changed significantly. Automatically skips build artifacts (bin, obj, node_modules, dist, etc.) and large generated files. Large repos (100k+ LOC) may take 30-120s on first index; subsequent calls use the cache.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to repository root. Default: process.cwd()',
        },
        forceReindex: {
          type: 'boolean',
          description: 'Force re-indexing even if cache is available. Default: false',
        },
      },
    },
  },
  {
    name: 'get_relevant_context',
    description: '⭐ PREFERRED SEARCH: Use this INSTEAD OF Grep for finding code by description. Natural language search with BM25 ranking. Saves 70-90% tokens vs reading files directly. Examples: "authentication middleware", "payment processing", "gacha spin mechanics". Returns only relevant code snippets with relevance scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language description of what you need (e.g., "user authentication flow", "error handling logic")',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens to return (approximate). Default: 4000',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'find_symbol',
    description: '⭐ PREFERRED FOR SYMBOLS: Use this INSTEAD OF Grep when looking for specific functions, classes, or variables. Fuzzy matching automatically handles typos ("athenticate" → "authenticate"). Returns exact file path and line number. Much faster than Grep with better accuracy.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'The symbol name to find (e.g., function name, class name, variable name)',
        },
        type: {
          type: 'string',
          enum: ['function', 'class', 'variable', 'type', 'any'],
          description: 'The type of symbol to find. Use "any" to search all types.',
        },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'get_function',
    description: '⭐ PREFERRED OVER Read: Get complete function code without reading the entire file. Saves 85% tokens compared to Read. Use when you need a specific function implementation instead of reading full files. Returns only the function definition with signature.',
    inputSchema: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'The name of the function to retrieve',
        },
        filePath: {
          type: 'string',
          description: 'Optional: specific file path if known',
        },
      },
      required: ['functionName'],
    },
  },
  {
    name: 'get_class',
    description: '⭐ PREFERRED OVER Read: Get class definition without reading the entire file. Optionally filter specific methods. Saves 80%+ tokens vs reading full files. Use this when you need class structure or specific class methods.',
    inputSchema: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'The name of the class to retrieve',
        },
        methods: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: specific method names to include. If omitted, returns all methods.',
        },
        filePath: {
          type: 'string',
          description: 'Optional: specific file path if known',
        },
      },
      required: ['className'],
    },
  },
  {
    name: 'get_relevant_context',
    description: 'Get code context relevant to a natural language query. Returns minimal, targeted code snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language description of what you need context for',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens to return (approximate). Default: 4000',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_file_summary',
    description: '⭐ PREFERRED FOR FILE OVERVIEW: Get file structure (exports, functions, classes, imports) without reading full content. Use this INSTEAD OF Read when you need to understand what\'s in a file without seeing implementation details. Saves 90% tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file relative to repository root',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'search_code',
    description: '⭐ PREFERRED OVER Grep: Search for code patterns with regex support. Returns ranked results with minimal context. Better than Grep because it ranks by relevance and provides AI-optimized output. Use for pattern matching and text search.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Text or regex pattern to search for',
        },
        filePattern: {
          type: 'string',
          description: 'Optional: glob pattern to filter files (e.g., "**/*.ts")',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return. Default: 10',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'get_repository_structure',
    description: '⭐ PREFERRED OVER ls/tree: Get clean repository structure showing directories and file types. Use this INSTEAD OF running ls, tree, or Glob for understanding project layout. No file contents, just structure.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional: specific subdirectory to analyze. Default: root',
        },
        depth: {
          type: 'number',
          description: 'Maximum depth to traverse. Default: 3',
        },
      },
    },
  },
  {
    name: 'get_dependencies',
    description: 'Find all dependencies (imports/requires) for a file or symbol. Useful for understanding what code needs.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'File path to analyze dependencies for',
        },
        symbol: {
          type: 'string',
          description: 'Optional: specific symbol to trace dependencies for',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'clear_cache',
    description: 'Clear the cached index for a repository. Useful if cache becomes corrupted or you want to force a fresh index.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to repository root. Default: process.cwd()',
        },
      },
    },
  },
  {
    name: 'find_similar',
    description: 'Find code similar to a given symbol. Useful for discovering related implementations, similar patterns, or alternative approaches.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolName: {
          type: 'string',
          description: 'The name of the symbol to find similar code for',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of similar symbols to return. Default: 5',
        },
      },
      required: ['symbolName'],
    },
  },
  {
    name: 'get_usage_stats',
    description: 'View token usage statistics for this session. Shows how many tokens each MCP tool used vs what full file reads would have cost. Use this to verify token savings.',
    inputSchema: {
      type: 'object',
      properties: {
        reset: {
          type: 'boolean',
          description: 'Reset usage stats after displaying. Default: false',
        },
      },
    },
  },
  {
    name: 'index_git_changes',
    description: '🚀 NEW: Git-aware incremental indexing. Only indexes files changed since a git ref (branch/commit). MUCH FASTER than full re-index for large repos. Use this when working on feature branches or after pulling changes. Examples: "--since main", "--days 7", "--uncommitted".',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to repository root. Default: process.cwd()',
        },
        since: {
          type: 'string',
          description: 'Git ref to compare against (e.g., "main", "develop", "HEAD~5"). Default: main branch',
        },
        days: {
          type: 'number',
          description: 'Index files changed in last N days',
        },
        uncommitted: {
          type: 'boolean',
          description: 'Index only uncommitted changes. Default: false',
        },
      },
    },
  },
  {
    name: 'get_function_with_context',
    description: '🚀 NEW: Smart context expansion. Get a function WITH its type definitions and immediate dependencies (signatures only). Saves 80-90% tokens vs reading all dependency files. Perfect for understanding code flow without full file reads.',
    inputSchema: {
      type: 'object',
      properties: {
        functionName: {
          type: 'string',
          description: 'The name of the function to retrieve',
        },
        filePath: {
          type: 'string',
          description: 'Optional: specific file path if known',
        },
        includeTypes: {
          type: 'boolean',
          description: 'Include type definitions. Default: true',
        },
        includeDeps: {
          type: 'boolean',
          description: 'Include immediate dependencies. Default: true',
        },
      },
      required: ['functionName'],
    },
  },
  {
    name: 'get_dependency_tree',
    description: '🚀 NEW: Dependency-aware context. Visualize and retrieve dependency tree for a symbol. Shows what code depends on what. Use this to understand code architecture and flow. Returns visual tree + grouped dependencies.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolName: {
          type: 'string',
          description: 'Symbol name to analyze dependencies for',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum depth to traverse. Default: 2',
        },
        visualize: {
          type: 'boolean',
          description: 'Include visual tree diagram. Default: true',
        },
      },
      required: ['symbolName'],
    },
  },
  {
    name: 'build_dependency_graph',
    description: '🚀 NEW: Build dependency graph for the entire codebase. Call this once after indexing to enable smart context features. Required for get_function_with_context and get_dependency_tree to work.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'find_symbol_references',
    description: '🔍 NEW: Find all places where a symbol is used (Serena-inspired). Shows usages across all files with context. Uses regex-based search (no LSP required). Perfect for "who calls this function?" questions. FREE & FAST.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolName: {
          type: 'string',
          description: 'Symbol name to find references for',
        },
      },
      required: ['symbolName'],
    },
  },
  {
    name: 'insert_after_symbol',
    description: '✏️ NEW: Insert code after a symbol (Serena-inspired). Symbol-level editing without reading full files. Precise insertion at exact location. Auto-detects symbol end. FREE & NO LSP NEEDED.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolName: {
          type: 'string',
          description: 'Symbol to insert after',
        },
        code: {
          type: 'string',
          description: 'Code to insert',
        },
        filePath: {
          type: 'string',
          description: 'Optional: specific file if multiple symbols with same name',
        },
      },
      required: ['symbolName', 'code'],
    },
  },
  {
    name: 'replace_symbol',
    description: '✏️ NEW: Replace a symbol with new code (Serena-inspired). Surgical precision editing. Replaces entire symbol definition. Perfect for refactoring. FREE & SIMPLE.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolName: {
          type: 'string',
          description: 'Symbol to replace',
        },
        newCode: {
          type: 'string',
          description: 'New code to replace with',
        },
        filePath: {
          type: 'string',
          description: 'Optional: specific file if multiple symbols',
        },
      },
      required: ['symbolName', 'newCode'],
    },
  },
  {
    name: 'delete_symbol',
    description: '🗑️ NEW: Delete a symbol (Serena-inspired). Remove function/class/etc cleanly. Symbol-level deletion. Use for cleanup and refactoring. FREE & FAST.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolName: {
          type: 'string',
          description: 'Symbol to delete',
        },
        filePath: {
          type: 'string',
          description: 'Optional: specific file if multiple symbols',
        },
      },
      required: ['symbolName'],
    },
  },
  {
    name: 'get_related_symbols',
    description: '🔗 NEW: Find symbols related to a given symbol. Discovers related code by file proximity, name similarity, and usage. Helps navigate unfamiliar codebases. FREE & SMART.',
    inputSchema: {
      type: 'object',
      properties: {
        symbolName: {
          type: 'string',
          description: 'Symbol to find related symbols for',
        },
      },
      required: ['symbolName'],
    },
  },
];

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools,
}));

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Log tool usage for monitoring
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] MCP Tool Called: ${name}`);
  console.error(`[${timestamp}] Arguments:`, JSON.stringify(args, null, 2));

  try {
    const result = await (async () => {
    switch (name) {
      case 'index_repository': {
        const path = (args as any).path || process.cwd();
        const forceReindex = (args as any).forceReindex || false;
        await indexer.indexRepository(path, forceReindex);
        const stats = indexer.getStats();
        const skippedParts: string[] = [];
        if (stats.skippedLarge > 0) skippedParts.push(`${stats.skippedLarge} too large (>512KB)`);
        if (stats.skippedUnsupported > 0) skippedParts.push(`${stats.skippedUnsupported} unsupported type`);
        const skippedLine = skippedParts.length > 0 ? `\nSkipped: ${skippedParts.join(', ')}` : '';
        return {
          content: [
            {
              type: 'text',
              text: `Repository indexed successfully.\nFiles: ${stats.totalFiles}\nSymbols: ${stats.totalSymbols}${skippedLine}`,
            },
          ],
        };
      }

      case 'clear_cache': {
        const path = (args as any).path || process.cwd();
        await indexer.clearCache(path);
        return {
          content: [
            {
              type: 'text',
              text: `Cache cleared for ${path}`,
            },
          ],
        };
      }

      case 'find_symbol': {
        const a = args as any;
        const symbol: string = a.symbol || a.name || a.symbolName;
        const type: string | undefined = a.type;
        if (!symbol) {
          return {
            content: [{ type: 'text', text: 'Error: symbol is required. Provide the symbol name to find.' }],
            isError: true,
          };
        }
        const results = await retriever.findSymbol(symbol, type);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'get_function': {
        const a = args as any;
        const functionName: string = a.functionName || a.name;
        const filePath: string | undefined = a.filePath || a.path || a.file;
        if (!functionName) {
          return {
            content: [{ type: 'text', text: 'Error: functionName is required. Provide the name of the function to retrieve.' }],
            isError: true,
          };
        }
        const result = await retriever.getFunction(functionName, filePath);
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      case 'get_class': {
        const a = args as any;
        const className: string = a.className || a.name;
        const methods: string[] | undefined = a.methods;
        const filePath: string | undefined = a.filePath || a.path || a.file;
        if (!className) {
          return {
            content: [{ type: 'text', text: 'Error: className is required. Provide the name of the class to retrieve.' }],
            isError: true,
          };
        }
        const result = await retriever.getClass(className, methods, filePath);
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      case 'get_relevant_context': {
        const a = args as any;
        const query: string = a.query || a.search || a.text || a.pattern;
        const maxTokens: number = a.maxTokens || a.max_tokens || a.tokens || 4000;
        if (!query) {
          return {
            content: [{ type: 'text', text: 'Error: query is required. Provide a natural language description of what you need.' }],
            isError: true,
          };
        }
        const result = await retriever.getRelevantContext(query, maxTokens);
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      case 'get_file_summary': {
        const a = args as any;
        const filePath: string = a.filePath || a.path || a.file;
        if (!filePath) {
          return {
            content: [{ type: 'text', text: 'Error: filePath is required.' }],
            isError: true,
          };
        }
        const result = await retriever.getFileSummary(filePath);
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      case 'search_code': {
        const a = args as any;
        const pattern: string = a.pattern || a.query || a.search || a.text;
        const filePattern: string | undefined = a.filePattern || a.glob || a.fileGlob;
        const maxResults: number = a.maxResults || a.limit || a.max || 10;
        if (!pattern) {
          return {
            content: [{ type: 'text', text: 'Error: pattern is required. Provide a text or regex pattern to search for.' }],
            isError: true,
          };
        }
        const results = await retriever.searchCode(
          pattern,
          filePattern,
          maxResults
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'get_repository_structure': {
        const { path, depth } = args as { path?: string; depth?: number };
        const result = await retriever.getRepositoryStructure(path, depth || 3);
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      case 'get_dependencies': {
        const a = args as any;
        const filePath: string = a.filePath || a.path || a.file;
        const symbol: string | undefined = a.symbol || a.name;
        if (!filePath) {
          return {
            content: [{ type: 'text', text: 'Error: filePath is required.' }],
            isError: true,
          };
        }
        const result = await retriever.getDependencies(filePath, symbol);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'find_similar': {
        const a = args as any;
        const symbolName: string = a.symbolName || a.symbol || a.name;
        const limit: number = a.limit || a.max || a.maxResults || 5;
        if (!symbolName) {
          return {
            content: [{ type: 'text', text: 'Error: symbolName is required.' }],
            isError: true,
          };
        }
        const result = await retriever.findSimilarSymbols(symbolName, limit);
        return {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        };
      }

      case 'get_usage_stats': {
        const resetAfter = (args as any)?.reset || false;
        const elapsed = Math.round((Date.now() - sessionStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;

        let totalMcpTokens = 0;
        let totalFullReadTokens = 0;
        let totalCalls = 0;
        let totalFiles = 0;

        let report = `📊 MCP Token Usage Stats (session: ${minutes}m ${seconds}s)\n`;
        report += `${'─'.repeat(75)}\n`;
        report += `${'Tool'.padEnd(25)} ${'Calls'.padStart(6)} ${'Tokens'.padStart(8)} ${'Avg'.padStart(6)} ${'Files'.padStart(6)} ${'vs Read'.padStart(12)}\n`;
        report += `${'─'.repeat(75)}\n`;

        for (const [tool, stats] of Object.entries(usageStats)) {
          totalMcpTokens += stats.totalTokens;
          totalFullReadTokens += stats.estimatedFullReadTokens;
          totalCalls += stats.calls;
          const fileCount = stats.filesReferenced.size;
          totalFiles += fileCount;

          const savings = stats.estimatedFullReadTokens > 0
            ? `${Math.round((1 - stats.totalTokens / stats.estimatedFullReadTokens) * 100)}% saved`
            : 'n/a';

          report += `${tool.padEnd(25)} ${String(stats.calls).padStart(6)} ${String(stats.totalTokens).padStart(8)} ${String(stats.avgTokensPerCall).padStart(6)} ${String(fileCount).padStart(6)} ${savings.padStart(12)}\n`;
        }

        report += `${'─'.repeat(75)}\n`;
        report += `${'TOTAL'.padEnd(25)} ${String(totalCalls).padStart(6)} ${String(totalMcpTokens).padStart(8)} ${''.padStart(6)} ${String(allFilesReferenced.size).padStart(6)}\n`;

        report += `\n📁 Unique files touched: ${allFilesReferenced.size}\n`;

        if (totalFullReadTokens > 0) {
          const overallSavings = Math.round((1 - totalMcpTokens / totalFullReadTokens) * 100);
          report += `\n📖 If you Read those ${allFilesReferenced.size} files fully: ~${totalFullReadTokens.toLocaleString()} tokens\n`;
          report += `🔍 MCP returned only relevant parts: ~${totalMcpTokens.toLocaleString()} tokens\n`;
          report += `💡 Saved: ~${(totalFullReadTokens - totalMcpTokens).toLocaleString()} tokens (${overallSavings}%)\n`;
        }

        // List the actual files that were referenced
        if (allFilesReferenced.size > 0 && allFilesReferenced.size <= 30) {
          report += `\n📂 Files referenced:\n`;
          for (const file of allFilesReferenced) {
            const tokens = getFileTokenCount(file);
            report += `   ${file} (${tokens > 0 ? tokens.toLocaleString() + ' tokens' : 'unknown size'})\n`;
          }
        } else if (allFilesReferenced.size > 30) {
          report += `\n📂 Files referenced: ${allFilesReferenced.size} files (too many to list)\n`;
        }

        if (resetAfter) {
          for (const key of Object.keys(usageStats)) {
            delete usageStats[key];
          }
          allFilesReferenced.clear();
          sessionStartTime = Date.now();
          report += `\n🔄 Stats reset.`;
        }

        return {
          content: [{ type: 'text', text: report }],
        };
      }

      case 'index_git_changes': {
        const a = args as any;
        const path = a.path || process.cwd();
        const since = a.since;
        const days = a.days;
        const uncommitted = a.uncommitted || false;

        await indexer.indexGitChanges(path, { since, days, uncommitted });
        const stats = indexer.getStats();

        return {
          content: [
            {
              type: 'text',
              text: `Git-aware incremental index complete.\nFiles: ${stats.totalFiles}\nSymbols: ${stats.totalSymbols}`,
            },
          ],
        };
      }

      case 'get_function_with_context': {
        const a = args as any;
        const functionName = a.functionName || a.name;
        const filePath = a.filePath || a.path || a.file;
        const includeTypes = a.includeTypes !== false;
        const includeDeps = a.includeDeps !== false;

        if (!functionName) {
          return {
            content: [{ type: 'text', text: 'Error: functionName is required.' }],
            isError: true,
          };
        }

        const result = await retriever.getFunctionWithSmartContext(functionName, filePath, {
          includeTypes,
          includeDeps,
        });

        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_dependency_tree': {
        const a = args as any;
        const symbolName = a.symbolName || a.symbol || a.name;
        const maxDepth = a.maxDepth || a.depth || 2;
        const visualize = a.visualize !== false;

        if (!symbolName) {
          return {
            content: [{ type: 'text', text: 'Error: symbolName is required.' }],
            isError: true,
          };
        }

        const result = await retriever.getDependencyContext(symbolName, {
          maxDepth,
          visualize,
        });

        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'build_dependency_graph': {
        retriever.buildDependencyGraph();
        return {
          content: [
            {
              type: 'text',
              text: 'Dependency graph built successfully. Smart context features are now enabled.',
            },
          ],
        };
      }

      case 'find_symbol_references': {
        const a = args as any;
        const symbolName = a.symbolName || a.symbol || a.name;

        if (!symbolName) {
          return {
            content: [{ type: 'text', text: 'Error: symbolName is required.' }],
            isError: true,
          };
        }

        const result = await retriever.findSymbolReferences(symbolName);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'insert_after_symbol': {
        const a = args as any;
        const symbolName = a.symbolName || a.symbol || a.name;
        const code = a.code || a.codeToInsert;
        const filePath = a.filePath || a.file;

        if (!symbolName || !code) {
          return {
            content: [{ type: 'text', text: 'Error: symbolName and code are required.' }],
            isError: true,
          };
        }

        const result = await retriever.insertAfterSymbol(symbolName, code, filePath);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'replace_symbol': {
        const a = args as any;
        const symbolName = a.symbolName || a.symbol || a.name;
        const newCode = a.newCode || a.code;
        const filePath = a.filePath || a.file;

        if (!symbolName || !newCode) {
          return {
            content: [{ type: 'text', text: 'Error: symbolName and newCode are required.' }],
            isError: true,
          };
        }

        const result = await retriever.replaceSymbol(symbolName, newCode, filePath);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'delete_symbol': {
        const a = args as any;
        const symbolName = a.symbolName || a.symbol || a.name;
        const filePath = a.filePath || a.file;

        if (!symbolName) {
          return {
            content: [{ type: 'text', text: 'Error: symbolName is required.' }],
            isError: true,
          };
        }

        const result = await retriever.deleteSymbol(symbolName, filePath);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      case 'get_related_symbols': {
        const a = args as any;
        const symbolName = a.symbolName || a.symbol || a.name;

        if (!symbolName) {
          return {
            content: [{ type: 'text', text: 'Error: symbolName is required.' }],
            isError: true,
          };
        }

        const result = await retriever.getRelatedSymbols(symbolName);
        return {
          content: [{ type: 'text', text: result }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    })();

    // Track token usage for all tools except get_usage_stats and index_repository
    if (name !== 'get_usage_stats' && name !== 'index_repository' && name !== 'clear_cache' && result?.content?.[0]?.type === 'text') {
      const responseText = (result.content[0] as any).text || '';

      // Extract actual file paths referenced in the response
      const referencedFiles = extractFilePathsFromResponse(responseText);

      // Also include the explicitly requested file path if provided
      const a = args as any;
      const requestedFile = a?.filePath || a?.file;
      if (requestedFile) {
        const normalizedRequested = normalizePath(requestedFile);
        if (!referencedFiles.includes(normalizedRequested)) {
          referencedFiles.push(normalizedRequested);
        }
      }

      trackUsage(name, responseText, referencedFiles);
    }

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MCP Context Manager server started');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
