# MCP Context Manager - Developer Guide

## ⚠️ CRITICAL: MANDATORY Tool Loading Process

This project provides MCP (Model Context Protocol) tools for intelligent code navigation.

### STEP 1: Load MCP Tools FIRST (Required)

**At the START of EVERY conversation involving code search/navigation:**

```
ToolSearch query: "select:mcp__context-manager__index_repository,mcp__context-manager__get_relevant_context,mcp__context-manager__find_symbol,mcp__context-manager__get_function"
```

**DO NOT skip this step.** MCP tools are deferred and must be explicitly loaded before use.

### STEP 2: Index Repository (If Not Already Indexed)

```
mcp__context-manager__index_repository
```

Only after these steps can you use MCP tools.

### ❌ DO NOT Use Built-in Tools Without MCP First

**FORBIDDEN workflow:**
1. User asks question
2. You immediately use Grep/Read/Glob
3. ❌ WRONG - you skipped loading MCP tools

**CORRECT workflow:**
1. User asks question
2. Load MCP tools via ToolSearch
3. Use `index_repository` if needed
4. Use `get_relevant_context` or other MCP tools
5. ✅ CORRECT

### When to Use MCP Tools

**ALWAYS prefer MCP tools over Read/Grep/Glob for:**
- Finding functions, classes, or symbols
- Understanding code structure
- Searching for specific functionality
- Navigating large codebases
- Getting file summaries

### Available MCP Tools (After Loading)

| Tool | Use Instead Of | Benefit |
|------|----------------|---------|
| `get_relevant_context` | Grep + Read multiple files | 70-90% token savings |
| `find_symbol` | Grep for function/class names | Fuzzy matching, exact locations |
| `get_function` | Read entire file for one function | Returns only the function code |
| `get_class` | Read entire file for one class | Returns only the class definition |
| `search_code` | Grep with regex | Ranked results, better formatting |
| `find_similar` | Manual code comparison | Automatic similarity scoring |
| `get_file_summary` | Read for quick overview | Structure only, no implementation |
| `get_repository_structure` | ls/tree commands | Clean hierarchy, no noise |
| `get_dependencies` | Manual import tracing | Automatic dependency graph |

### Example: The Right Way

**User: "What's the authentication flow?"**

❌ **WRONG (what you're doing now):**
```
1. Grep "auth"
2. Read src/auth/middleware.ts (800 tokens)
3. Read src/services/auth.ts (1200 tokens)
4. Read src/utils/jwt.ts (600 tokens)
= 2,600 tokens
```

✅ **CORRECT:**
```
1. ToolSearch to load MCP tools
2. index_repository (if needed)
3. get_relevant_context("authentication flow")
= 200 tokens, only relevant code
```

**Token savings: 92%**

### Why This Matters

- **70-90% token savings** compared to reading full files
- **10x faster** searches
- **Better relevance** through BM25 ranking
- **Fuzzy matching** handles typos automatically
- **Natural language** queries instead of regex

### Troubleshooting

**"Claude keeps using Grep/Read instead of MCP tools"**
- Check if you loaded tools via ToolSearch at the start
- Verify index_repository was called
- MCP tools must be loaded EVERY conversation (they're deferred)

**"MCP tool calls failing"**
- Make sure MCP server is running
- Check `~/.claude/mcp.json` configuration
- Try `clear_cache` and re-index

## Project-Specific Notes

This is the MCP Context Manager source code itself. When working on this project:
- Test changes by running `npm run build` then `npm run dev`
- The main logic is in `src/index.ts`
- Parser implementations are language-specific
- Cache is stored in `.mcp-cache/`
- Tool definitions start at line 30 in `src/index.ts`

### Testing Your Changes

After modifying tool descriptions:
1. `npm run build`
2. Restart Claude
3. Test in a conversation:
   - "Index this repository"
   - "Find the BM25 scoring algorithm"
   - Verify Claude uses MCP tools, not Grep/Read
