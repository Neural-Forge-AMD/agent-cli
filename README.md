# Groupy Autonomous Agent & CLI

An autonomous, scalable, modular AI agent system engine and interactive CLI REPL written in **TypeScript** powered by **Bun**.
Directly ported from the multi-layer actor architecture of **OpenAI Codex Core** (`codex-rs/core`).

## Features

- **Multi-agent orchestration**: Spawn and manage multiple specialized agents
- **Git worktree isolation**: Safe task isolation with automatic branch management
- **Skills system**: Load and execute specialized capabilities dynamically
- **Memory bank**: Persistent user preferences and context
- **MCP integration**: Connect to Model Context Protocol servers
- **Interactive REPL**: Full-featured terminal interface
- **Cross-platform**: Works on Windows, macOS, and Linux

## Installation

### Using Bun (recommended)

```bash
# Install Groupy globally
bun install -g @pikaa-ai/pikaa

# Or install locally
bun install @pikaa-ai/pikaa
```

### Using npm/yarn

```bash
# Install globally
npm install -g @pikaa-ai/pikaa

# Or install locally
npm install @pikaa-ai/pikaa
```

## Quick Start

Start the interactive REPL:

```bash
groupy
```

Or run a specific command:

```bash
groupy worktrees
groupy skills
groupy memories
```

## System Architecture

Groupy's engine is structured into modular layers that separate protocol, transport, orchestration, execution, context management, MCP integration, multi-agent spawning, persistence, skills, memories, git worktree task isolation, and the interactive CLI REPL:

```
groupy/
├── bin/                       # Executable CLI entry points
├── src/
│   ├── index.ts               # Main package exports and initialization
│   ├── cli/                   # Command-line interface and REPL
│   │   ├── index.ts          # Main CLI entry
│   │   ├── repl.ts           # Interactive REPL implementation
│   │   └── commands.ts       # CLI command handlers
│   ├── worktree/              # Git Worktree Task Isolation
│   │   ├── git.ts            # Low-level git execution helpers & porcelain parser
│   │   ├── manager.ts        # WorktreeManager (lifecycle, thread binding & branch merging)
│   │   ├── tools.ts          # LLM tools: create_worktree, list_worktrees, merge_worktree, remove_worktree
│   │   └── types.ts          # WorktreeInfo, WorktreeOpt
│   ├── client/                # AI model clients
│   │   ├── model-client.ts   # Base model client implementation
│   │   └── types.ts          # Client types and interfaces
│   ├── code-mode/             # Code execution runtime
│   │   ├── runtime.ts        # Code execution environment
│   │   └── types.ts          # Code execution types
│   ├── context/               # Context management
│   │   └── instructions.ts   # Instruction handling and context
│   ├── protocol/              # Communication protocols
│   │   └── events.ts         # Event definitions and messaging
│   ├── storage/               # Persistence layer
│   │   ├── sqlite.ts         # SQLite database implementation
│   │   └── types.ts          # Storage types and interfaces
│   ├── skills/                # Skills system
│   │   ├── loader.ts         # Skills loading and discovery
│   │   └── types.ts          # Skill types and interfaces
│   └── ui/                   # User interface components
│       ├── formatter.ts      # Output formatting utilities
│       └── spinner.ts        # Loading spinner components
├── templates/                # Template files for generated content
├── tests/                   # Test suites
│   ├── client.test.ts        # Model client tests
│   ├── code-mode.test.ts     # Code execution tests
│   ├── storage.test.ts       # SQLite thread persistence & resume tests
│   ├── skills-and-memories.test.ts# Skills loader & memory bank persistence tests
│   └── worktree.test.ts      # Git Worktree isolation & merge tests
└── dist/                    # Built output
```

## CLI Usage

### Worktree Management

```bash
# List all active isolated Git Worktrees
groupy worktrees

# Create a new worktree for a task
groupy create-worktree my-feature-branch

# Merge worktree changes back to main branch
groupy merge-worktree my-feature-branch

# Remove a worktree
groupy remove-worktree my-feature-branch
```

### Skills Management

```bash
# List all available skills
groupy skills

# Execute a specific skill
groupy execute skill-name
```

### Memory and Preferences

```bash
# View learned user preferences and memory bank
groupy memories

# Clear memory
groupy clear-memories
```

### Sessions

```bash
# List active sessions
groupy sessions

# Resume a previous session
groupy resume session-id
```

## Development

### Running Tests

```bash
# Run all test suites
bun test

# Run specific test file
bun test tests/worktree.test.ts

# Run tests with coverage
bun test --coverage
```

### Building

```bash
# Build JavaScript output
bun run build:js

# Build executable
bun run build:exe

# Build all artifacts
bun run build
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT