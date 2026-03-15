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
    version: '1.0.0',
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

// Define available tools
const tools: Tool[] = [
  {
    name: 'index_repository',
    description: '🔧 REQUIRED FIRST STEP: Index or re-index the repository to enable all context-manager tools. Uses cached index if files haven\'t changed. ALWAYS call this when starting work on a repository or if files have changed significantly. Fast (<2s for most repos).',
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
    switch (name) {
      case 'index_repository': {
        const path = (args as any).path || process.cwd();
        const forceReindex = (args as any).forceReindex || false;
        await indexer.indexRepository(path, forceReindex);
        return {
          content: [
            {
              type: 'text',
              text: `Repository indexed successfully.\nFiles: ${indexer.getStats().totalFiles}\nSymbols: ${indexer.getStats().totalSymbols}`,
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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
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
