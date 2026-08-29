# Groupy Autonomous Agent & CLI

An autonomous, scalable, modular AI agent system engine and interactive CLI REPL written in **TypeScript** powered by **Bun**.
Directly ported from the multi-layer actor architecture of **OpenAI Codex Core** (`codex-rs/core`).

---

## 1. System Overview & Architecture

Groupy's engine is structured into modular layers that separate protocol, transport, orchestration, execution, context management, MCP integration, multi-agent spawning, persistence, skills, memories, git worktree task isolation, and the interactive CLI REPL:

```
groupy/
├── bin/                       # Executable CLI
├── src/
│   ├── index.ts               # Main package exports
│   │
│   ├── worktree/              # Git Worktree Task Isolation
│   │   ├── git.ts             # Low-level git execution helpers & porcelain parser
│   │   ├── manager.ts         # WorktreeManager (lifecycle, thread binding & branch merging)
│   │   ├── tools.ts           # LLM tools: create_worktree, list_worktrees, merge_worktree, remove_worktree
│   │   └── types.ts           # WorktreeInfo, WorktreeOptions, WorktreeMergeResult
│   │
│   ├── skills/                # Skills Discovery & On-Demand Execution
│   │   ├── loader.ts          # SkillsLoader (scans .agents/skills/ & ~/.groupy/skills/)
│   │   ├── tool.ts            # load_skill Tool for LLM retrieval
│   │   └── types.ts           # SkillMetadata, LoadedSkill
│   │
│   ├── memories/              # Persistent Memory Bank (Global & Workspace)
│   │   ├── store.ts           # MemoryStore (reads/writes ~/.groupy/memories.md & .agents/memories.md)
│   │   ├── tool.ts            # remember Tool for persisting learned preferences
│   │   └── types.ts           # MemoryEntry, MemoryCategory
│   │
│   ├── storage/               # SQLite Thread Store & Session Persistence
│   │   ├── sqlite-store.ts    # Native bun:sqlite WAL database store
│   │   ├── manager.ts         # SessionPersistenceManager (auto-checkpointing & resume)
│   │   └── types.ts           # ThreadRecord, ItemRecord, RestoredSessionData
│   │
│   ├── cli/                   # Interactive Terminal CLI & REPL
│   │   ├── index.ts           # Binary entrypoint & CLI argument parser (--resume, --model, --role)
│   │   ├── repl.ts            # Read-Eval-Print-Loop engine with live spinner & approvals
│   │   ├── commands.ts        # Slash commands (/help, /skills, /memories, /worktrees, /sessions, /roles, /agents, /mcp, /compact, /clear)
│   │   └── ui/
│   │       ├── colors.ts      # Zero-dependency ANSI styling with terracotta brand palette
│   │       ├── spinner.ts     # Live async terminal spinner (⠋ ⠙ ⠹...)
│   │       └── formatter.ts   # Groupy key emblem banner, tool cards & clean typography
│   │
│   ├── protocol/              # Immutable data contracts & event schemas
│   │   ├── ops.ts             # Operations (TurnInput, Interrupt, ExecApproval, Shutdown)
│   │   ├── events.ts          # Real-time event streams (Reasoning, MessageDelta, ToolCall, etc.)
│   │   ├── items.ts           # Conversation history items (User, Agent, ToolCall, ToolOutput)
│   │   └── errors.ts          # Typed error hierarchy (TurnAborted, ContextExceeded, etc.)
│   │
│   ├── client/                # LLM Transport & Streaming Pipeline
│   │   └── model-client.ts    # ModelClient & turn-scoped ModelClientSession
│   │
│   ├── session/               # The Heart: Orchestration & The Agent Loop
│   │   ├── session.ts         # Session state, event bus, and active turn tracker
│   │   ├── submission-loop.ts # Background actor loop dispatching operations
│   │   ├── turn-input.ts      # Turn admission & steering logic (Started, Steered, Queued)
│   │   ├── turn.ts            # runTurn() ReAct sampling, auto-compaction, memories & tool loop
│   │   └── turn-context.ts    # Per-turn state, abort signal, and tool router snapshot
│   │
│   ├── mcp/                   # Model Context Protocol (MCP) Client Subsystem
│   │   ├── types.ts           # JSON-RPC 2.0 schemas & MCP protocol specs
│   │   ├── transport.ts       # StdioTransport (Bun.spawn) & SseTransport
│   │   ├── client.ts          # McpClient (handshake, tools/list, tools/call, resources/read)
│   │   └── manager.ts         # McpManager (multi-server registry & ToolRouter bridge)
│   │
│   ├── agents/                # Multi-Agent Sub-agent Spawner Subsystem
│   │   ├── identity.ts        # Ed25519 cryptographic keypair, runtime IDs, and task signing
│   │   ├── roles.ts           # AgentRoleRegistry (default, reviewer, researcher, tester, planner)
│   │   ├── types.ts           # SubAgentHandle, SubAgentStatus, SpawnAgentParams
│   │   ├── spawner.ts         # AgentSpawner (parallel sub-agent orchestration & lifecycle)
│   │   └── tools.ts           # spawn_agent, wait_agent, send_input, close_agent, list_agents
│   │
│   ├── tools/                 # Tool Subsystem & Handlers
│   │   ├── types.ts           # Tool definition interface & parameter schemas
│   │   ├── router.ts          # ToolRouter for tool discovery & execution dispatch
│   │   └── handlers/          # Built-in handlers (apply_patch, shell, file_ops, request_user_input)
│   │
│   ├── security/              # Guardrails & Isolation
│   │   ├── exec-policy.ts     # Command evaluation rules (auto-approve vs prompt user)
│   │   └── sandbox.ts         # Path isolation boundaries
│   │
│   └── context/               # Context Management & Compaction
│       ├── world-state.ts     # Git branch, working directory & OS snapshot
│       ├── instructions.ts    # Base instructions, memories injection & developer guidelines
│       └── compactor.ts       # History token estimator & auto-compactor
│
└── tests/                     # Automated Test Suite (bun test)
    ├── session-engine.test.ts     # End-to-end ReAct loop & tool execution tests
    ├── turn-interrupt.test.ts     # Turn interruption and steering tests
    ├── apply-patch.test.ts        # File patch surgical replacement tests
    ├── exec-policy.test.ts        # Command approval policy tests
    ├── compactor.test.ts          # History token compaction tests
    ├── mcp.test.ts                # MCP Stdio transport, discovery & execution tests
    ├── sub-agents.test.ts         # Parallel sub-agent spawning & coordination tests
    ├── storage.test.ts            # SQLite thread persistence & resume tests
    ├── skills-and-memories.test.ts# Skills loader & memory bank persistence tests
    └── worktree.test.ts           # Git Worktree isolation & merge tests
```

---

## 2. CLI Usage

```bash
# List active isolated Git Worktrees
bun run src/cli/index.ts worktrees

# List available skills across project and global config
bun run src/cli/index.ts skills

# View learned user preferences and memory bank
bun run src/cli/index.ts memories

# Or inside the interactive REPL:
/worktrees
/skills
/memories
/sessions
```

---

## 3. Quickstart & Testing

Run all 27 automated test suites with Bun:

```bash
cd groupy
bun test
```
