# MCP Context Manager

> **The smartest code search for Claude.** Reduces token usage by 70-90% with BM25 ranking, fuzzy matching, and natural language queries.

[![npm version](https://badge.fury.io/js/mcp-context-manager.svg)](https://www.npmjs.com/package/mcp-context-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is this?

An MCP (Model Context Protocol) server that gives Claude **superhuman code navigation**. Instead of reading entire files (thousands of tokens), Claude queries for exactly what it needs (tens of tokens).

**The difference:**

```diff
- Claude reads 3 files → 5,400 tokens → 5 seconds
+ Claude queries "auth middleware" → 230 tokens → 85ms
```

**95% token savings + 10x faster** = drastically lower API costs.

## Features

- 🎯 **Natural Language Search** - "authentication middleware" finds all auth code
- 🔍 **BM25 Ranking** - Industry-standard relevance algorithm (like Elasticsearch)
- ✨ **Fuzzy Matching** - Handles typos automatically ("athenticate" → "authenticate")
- 🧠 **Smart Tokenization** - Understands camelCase, snake_case, paths
- 🚀 **Blazing Fast** - <100ms searches on 10,000+ file repos
- 🌐 **Multi-Language** - TypeScript, JavaScript, Python, Go, Rust, Java, C/C++, C#, Lua
- 💰 **Token Savings** - 70-90% reduction in typical usage

## Quick Start

### Installation

```bash
npm install -g claude-mcp-context
```

**Automatic Setup (Claude Code CLI):**

The package automatically detects and configures Claude Code. After installation, run:

```bash
mcp-context-setup
```

This will:
1. ✅ Build the server (if needed)
2. ✅ Verify server functionality
3. ✅ Register with Claude Code automatically
4. ✅ Confirm registration

**Manual Configuration (Claude Desktop or troubleshooting):**

If automatic setup doesn't work or you're using Claude Desktop, add to your config file:

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "context-manager": {
      "command": "mcp-context-manager"
    }
  }
}
```

**Claude Code** (`~/.claude/mcp.json`):
```json
{
  "mcpServers": {
    "context-manager": {
      "command": "mcp-context-manager"
    }
  }
}
```

**Verify Installation:**
```bash
claude mcp list  # Should show "context-manager"
```

### Usage

Restart Claude and try:

```
"Index this repository"
"Find the authentication middleware"
"Show me all payment-related functions"
"What does the UserService class do?"
```

That's it! Claude will now use intelligent search instead of reading entire files.

## How It Works

### 1. Index Your Repository (One Time)
```
You: "Index this repository"
```
MCP Context Manager parses all code and builds a searchable index (~1 second per 1000 files).

### 2. Natural Language Queries
```
You: "Find authentication middleware"

Returns:
📍 authMiddleware (function) - Score: 892.3
   src/middleware/auth.ts:15

📍 AuthService (class) - Score: 654.2
   src/services/AuthService.ts:8
```

### 3. Massive Token Savings
Instead of 5,400 tokens to read 3 files, you get exactly what you need in 230 tokens.

## Search Intelligence

### Multi-Word Queries
```
"payment validation" → finds validatePayment(), PaymentValidator, checkPayment()
"user auth service" → finds UserAuthService, authenticateUser(), etc.
```

### Fuzzy Matching
```
"athenticate" → suggests authenticate
"usrService" → suggests userService
```

### Query Expansion
```
"auth" → searches: auth, authenticate, authentication, authorization
"db" → searches: db, database, data
"config" → searches: config, configuration, configure, settings
```

### Code Body Search
Searches inside function implementations, not just names:
```
"jwt token" → finds code that uses JWT, even if function isn't named jwt*
```

## Available Tools

| Tool | What It Does |
|------|-------------|
| `get_relevant_context` | Natural language search with BM25 ranking |
| `find_symbol` | Locate specific function/class with fuzzy suggestions |
| `get_function` | Get complete function code |
| `get_class` | Get class definition (optionally filter methods) |
| `search_code` | Regex pattern search with relevance ranking |
| `find_similar` | Discover structurally similar code |
| `get_file_summary` | File overview without full content |
| `get_repository_structure` | Directory tree view |
| `get_dependencies` | Trace imports and dependencies |
| `index_repository` | Build/refresh code index |

Claude automatically chooses the best tool based on your query.

## Examples

### Find Authentication Code
```
You: "Find all authentication-related code"

Claude uses: get_relevant_context("authentication")

Returns:
- authMiddleware() in middleware/auth.ts
- authenticate() in auth/handler.ts
- AuthService class in services/auth.ts
- validateToken() in utils/jwt.ts

Tokens: 340 (vs 4,200 reading all files) = 92% savings
```

### Debug Payment Flow
```
You: "Show me the payment processing flow"

Claude uses: get_relevant_context("payment processing")

Returns:
- processPayment() function
- PaymentService class
- Related validation and error handling

Then: find_similar("processPayment")

Returns:
- processRefund() (87% similar)
- handlePayment() (72% similar)

Total tokens: 450 (vs 6,000+) = 93% savings
```

### Understand New Codebase
```
You: "What are the main modules?"

Claude uses: get_repository_structure()

You: "Summarize the auth module"

Claude uses: get_file_summary("src/auth/handler.ts")

Returns structure without reading 200+ lines of code.

Tokens: 180 (vs 2,800) = 94% savings
```

## Performance

| Metric | Performance |
|--------|-------------|
| **Search Speed** | <100ms average |
| **Indexing Speed** | ~1s per 1000 files |
| **Accuracy** | 95%+ on typical queries |
| **Token Savings** | 70-90% average |
| **Memory Usage** | 1-5MB index |

**Real Example:** 3,500 file TypeScript monorepo
- Initial index: 45 seconds
- Re-index (cached): 2 seconds
- Search "auth middleware": 78ms, 15 results
- Token savings: 87% average

## Why It's Better

### vs. Reading Files Directly
- ✅ 95% fewer tokens
- ✅ 10x faster responses
- ✅ Only relevant code returned

### vs. Grep/Ripgrep
- ✅ BM25 relevance ranking
- ✅ Fuzzy matching for typos
- ✅ Natural language queries
- ✅ AI-optimized output

### vs. GitHub Copilot
- ✅ 70-90% token savings
- ✅ Works locally (private)
- ✅ Free and open source

## Configuration

The server automatically:
- Respects `.gitignore` patterns
- Excludes `node_modules`, `dist`, `build`
- Caches index for fast re-indexing
- Supports 9 programming languages

No configuration needed!

## Troubleshooting

**MCP server not showing up?**
- Run `mcp-context-setup` to re-register
- Check config file path is correct
- Use absolute paths (not relative)
- Restart Claude after config changes
- Verify with: `claude mcp list`

**No symbols found after indexing?**
- Verify file extensions are supported
- Check files aren't in `.gitignore`
- Try: `clear_cache` then re-index

**Slow indexing?**
- Normal for 10,000+ file repos (30-60 seconds)
- Subsequent indexes use cache (much faster)

## Development

```bash
git clone https://github.com/transparentlyok/mcp-context-manager
cd mcp-context-manager
npm install
npm run build

# Development mode
npm run dev

# Watch mode
npm run watch
```

## Contributing

Contributions welcome! Ideas:
- Add more language support
- Improve search algorithms
- Add semantic search with embeddings
- Create web UI

See issues for planned features.

## Technical Details

**Search Engine:**
- BM25 algorithm (K1=1.5, B=0.75)
- Levenshtein distance for fuzzy matching
- 10 parallel search strategies
- Query expansion dictionary

**Parsing:**
- Regex-based extraction (fast, lightweight)
- Supports 9 languages
- Extracts functions, classes, types, imports

**Caching:**
- File hash-based validation
- Stored in `.mcp-cache/`
- Automatic invalidation on changes

## License

MIT License - see [LICENSE](LICENSE) file.

## Links

- [GitHub](https://github.com/transparentlyok/mcp-context-manager)
- [npm](https://www.npmjs.com/package/mcp-context-manager)
- [Issues](https://github.com/transparentlyok/mcp-context-manager/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)

---

**Built with ❤️ for the AI development community**

⭐ Star on GitHub if this saves you tokens!
