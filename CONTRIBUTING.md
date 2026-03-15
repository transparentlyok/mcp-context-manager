# Contributing to MCP Context Manager

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/transparentlyok/mcp-context-manager`
3. Install dependencies: `npm install`
4. Build the project: `npm run build`
5. Test your changes

## Development Workflow

### Building

```bash
npm run build        # Compile TypeScript
npm run watch        # Auto-rebuild on changes
npm run dev          # Development mode with tsx
```

### Testing

Before submitting a PR, test your changes:

```bash
# Build the project
npm run build

# Test with a real repository
# Update the path in test scripts or create your own
```

## Adding Language Support

To add support for a new programming language:

### 1. Update Supported Extensions

Edit `src/indexer.ts` and add the file extensions:

```typescript
const supportedExtensions = [
  // ... existing extensions
  '.your-ext',  // Your new language
];
```

### 2. Add Language Detection

Update the `detectLanguage()` method:

```typescript
private detectLanguage(ext: string): string {
  const map: Record<string, string> = {
    // ... existing mappings
    '.your-ext': 'yourlang',
  };
  return map[ext] || 'unknown';
}
```

### 3. Implement Parser

Add a parser method following the existing pattern:

```typescript
private parseYourLang(content: string, lines: string[], fileIndex: FileIndex): void {
  // Parse imports/requires
  const importRegex = /your-import-pattern/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    fileIndex.imports.push(match[1]);
  }

  // Parse functions
  const functionRegex = /your-function-pattern/g;
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

  // Parse classes, types, etc.
  // ...
}
```

### 4. Wire It Up

Add the parser to the dispatch logic in `indexFile()`:

```typescript
// Parse file based on language
if (language === 'typescript' || language === 'javascript') {
  this.parseJavaScriptTypeScript(content, lines, fileIndex);
} else if (language === 'yourlang') {
  this.parseYourLang(content, lines, fileIndex);
}
```

### 5. Test It

Create test files in the new language and verify:
- Functions are detected
- Classes/types are detected
- Imports are captured
- Line numbers are correct

### 6. Update Documentation

Update README.md with the new language in the "Supported Languages" table.

## Coding Guidelines

### TypeScript Style

- Use `async/await` over promises
- Prefer `const` over `let`
- Use descriptive variable names
- Add JSDoc comments for public methods
- Type everything (avoid `any` unless necessary)

### Regex Patterns

When writing parsers:
- Test regex thoroughly on real code
- Handle edge cases (comments, strings, nested structures)
- Use named capture groups where helpful
- Add comments explaining complex patterns

### Error Handling

- Catch and log errors gracefully
- Don't crash the server on malformed code
- Provide helpful error messages

## Pull Request Process

1. **Create a feature branch**: `git checkout -b feature/your-feature`
2. **Make your changes** with clear, atomic commits
3. **Test thoroughly** on real-world code
4. **Update documentation** (README, comments, etc.)
5. **Submit a PR** with a clear description of:
   - What problem it solves
   - How it was tested
   - Any breaking changes

### PR Title Format

- `feat: Add support for Ruby language`
- `fix: Correct C++ function parsing regex`
- `docs: Update installation instructions`
- `refactor: Simplify retriever logic`

## Code Review

All PRs require review before merging. Reviewers will check:
- Code quality and style
- Test coverage
- Documentation updates
- Performance implications

## Reporting Bugs

Use GitHub Issues and include:
- MCP Context Manager version
- Node.js version
- Operating system
- Minimal reproduction steps
- Expected vs actual behavior
- Sample code if applicable

## Feature Requests

Feature requests are welcome! Please:
- Search existing issues first
- Describe the use case clearly
- Explain why it would benefit others
- Consider contributing the implementation

## Questions?

Open a GitHub Discussion or Issue for:
- Usage questions
- Architecture discussions
- Design decisions
- General feedback

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
