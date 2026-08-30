#!/usr/bin/env bun
/**
 * Groupy CLI Entrypoint.
 * Interactive terminal REPL with markdown formatting, live spinner,
 * multi-agent orchestration, MCP server connectivity, SQLite session persistence,
 * skills discovery, persistent user memories, isolated Git Worktrees, and pikaa-cli-backend OAuth PKCE.
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { Session } from "../session/session";
import { createDefaultTools } from "../tools";
import { AgentSpawner } from "../agents/spawner";
import { registerMultiAgentTools } from "../agents/tools";
import { McpManager } from "../mcp/manager";
import { SessionPersistenceManager } from "../storage/manager";
import { SkillsLoader } from "../skills/loader";
import { MemoryStore } from "../memories/store";
import { WorktreeManager } from "../worktree/manager";
import { ModelClient } from "../client/model-client";
import { AuthClient, CredentialsStore } from "../auth";
import { CliRepl } from "./repl";
import { style } from "./ui/colors";
import { MarkdownHighlighter } from "./ui/markdown";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const credStore = new CredentialsStore();
  const savedCreds = credStore.load();

  let model = process.env.GROUPY_MODEL || process.env.OPENAI_MODEL || "groupy";
  let baseUrl = process.env.GROUPY_BASE_URL || process.env.OPENAI_BASE_URL || savedCreds?.baseUrl;
  let apiKey = process.env.GROUPY_API_KEY || process.env.OPENAI_API_KEY || savedCreds?.accessToken;
  let cwd = process.cwd();
  let role = "default";
  let mcpConfigFile: string | undefined;
  let resumeThreadId: string | undefined;
  let singlePrompt: string | undefined;

  const storageManager = new SessionPersistenceManager();
  const skillsLoader = new SkillsLoader();
  const memoryStore = new MemoryStore();
  const worktreeManager = new WorktreeManager();
  const authClient = new AuthClient(credStore);

  // Simple CLI args parser
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "login" || arg === "auth") {
      const backendArg = args[i + 1]?.startsWith("http") ? args[++i] : undefined;
      await handleLogin(authClient, backendArg);
      process.exit(0);
    } else if (arg === "logout") {
      credStore.clear();
      console.log(style.green("Successfully logged out. Credentials cleared."));
      process.exit(0);
    } else if (arg === "whoami") {
      printWhoami(credStore);
      process.exit(0);
    } else if (arg === "models" || arg === "--models") {
      await printAvailableModels(baseUrl || "http://localhost:8090/v1", apiKey);
      process.exit(0);
    } else if (arg === "list" || arg === "sessions" || arg === "--list") {
      printSessionsList(storageManager);
      process.exit(0);
    } else if (arg === "skills") {
      printSkillsList(skillsLoader, cwd);
      process.exit(0);
    } else if (arg === "memories" || arg === "memory") {
      printMemoriesList(memoryStore, cwd);
      process.exit(0);
    } else if (arg === "worktrees" || arg === "worktree") {
      await printWorktreesList(worktreeManager, cwd);
      process.exit(0);
    } else if (arg === "--resume" || arg === "-R" || arg === "resume") {
      resumeThreadId = args[++i];
    } else if (arg === "--model" || arg === "-m") {
      model = args[++i] || model;
    } else if (arg === "--base-url" || arg === "-u") {
      baseUrl = args[++i] || baseUrl;
    } else if (arg === "--api-key" || arg === "-k") {
      apiKey = args[++i] || apiKey;
    } else if (arg === "--cwd" || arg === "-C") {
      cwd = resolve(args[++i] || cwd);
    } else if (arg === "--role" || arg === "-r") {
      role = args[++i] || role;
    } else if (arg === "--mcp") {
      mcpConfigFile = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      printCliHelp();
      process.exit(0);
    } else if (!arg?.startsWith("-") && !singlePrompt) {
      singlePrompt = arg;
    }
  }

  const modelClient = new ModelClient({
    baseUrl,
    apiKey,
    defaultModel: model,
  });

  // 1. Initialize Tools with Skills, Memories, Worktree Handlers & MCP
  const tools = createDefaultTools({ skillsLoader, memoryStore, worktreeManager });
  const mcpManager = new McpManager();

  // Auto-detect .mcp.json or mcp_config.json if not explicitly provided
  const candidateConfigs = [
    mcpConfigFile,
    resolve(cwd, ".mcp.json"),
    resolve(cwd, "mcp_config.json"),
  ].filter(Boolean) as string[];

  for (const cfg of candidateConfigs) {
    if (existsSync(cfg)) {
      try {
        await mcpManager.loadConfigFile(cfg);
        mcpManager.registerToolsIntoRouter(tools);
        break;
      } catch {}
    }
  }

  // 2. Initialize Session (Fresh or Resumed from SQLite)
  let session: Session;

  if (resumeThreadId) {
    try {
      session = storageManager.resumeSession(resumeThreadId, {
        model,
        cwd,
        tools,
        skillsLoader,
        memoryStore,
        modelClient,
      });
      console.log(style.brand(`[Resumed session: ${resumeThreadId}]`));
    } catch (err) {
      console.error(style.red(`Failed to resume session '${resumeThreadId}': ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  } else {
    session = new Session({
      model,
      cwd,
      tools,
      skillsLoader,
      memoryStore,
      modelClient,
    });
    storageManager.bindSession(session, role);
  }

  // 3. Multi-Agent Spawner
  const spawner = new AgentSpawner(session);
  registerMultiAgentTools(tools, spawner);

  // 4. Single-shot prompt mode vs Interactive REPL
  if (singlePrompt) {
    console.log(style.dim(`[Groupy single-shot execution for: "${singlePrompt}"]\n`));
    const highlighter = new MarkdownHighlighter();
    session.onEvent((event) => {
      if (event.msg.type === "AgentMessageDelta") {
        const formatted = highlighter.feed(event.msg.delta);
        if (formatted) process.stdout.write(formatted);
      } else if (event.msg.type === "TurnCompleted") {
        const remaining = highlighter.flush();
        if (remaining) process.stdout.write(remaining);
      } else if (event.msg.type === "Error") {
        console.error(style.red(`\nError: ${event.msg.message}`));
      }
    });

    try {
      await session.prompt(singlePrompt);
    } catch (err) {
      console.error(style.red(`\nExecution failed: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
    console.log();
    process.exit(0);
  }

  // Interactive REPL
  const repl = new CliRepl({
    session,
    spawner,
    mcpManager,
    storageManager,
    skillsLoader,
    memoryStore,
    worktreeManager,
    role,
  });
  await repl.start();
}

async function handleLogin(authClient: AuthClient, backendUrl?: string): Promise<void> {
  const targetBackend = backendUrl || process.env.GROUPY_BACKEND_URL || "https://api.groupy-hub.store";
  console.log(style.brand(`\n Logging into Backend: ${targetBackend}`));

  try {
    const { authUrl, waitForToken } = await authClient.startOAuthFlow({
      backendUrl: targetBackend,
    });

    console.log(`\nOpen the following link in your browser to complete authorization:`);
    console.log(style.cyan(style.bold(authUrl)));
    console.log(style.dim(`\nWaiting for browser callback on http://localhost:1455/auth/callback ...`));

    const creds = await waitForToken();
    console.log(style.green(`\n✓ Authentication Successful! Token saved to ~/.groupy/credentials.json`));
    console.log(style.dim(`  Gateway Base URL: ${creds.baseUrl}`));
  } catch (err) {
    console.log(style.yellow(`\nOAuth browser login failed: ${err instanceof Error ? err.message : String(err)}`));
    console.log(style.bold(`\nFalling back to Direct Terminal Login:`));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const question = (q: string) => new Promise<string>((res) => rl.question(q, res));

    try {
      const emailOrUsername = await question("Username or Email: ");
      const password = await question("Password: ");
      rl.close();

      const creds = await authClient.directLogin({
        backendUrl: targetBackend,
        emailOrUsername: emailOrUsername.trim(),
        password: password.trim(),
      });

      console.log(style.green(`\n✓ Successfully logged in! Token saved to ~/.groupy/credentials.json`));
      console.log(style.dim(`  Gateway Base URL: ${creds.baseUrl}`));
    } catch (directErr) {
      rl.close();
      console.error(style.red(`\nDirect login failed: ${directErr instanceof Error ? directErr.message : String(directErr)}`));
      process.exit(1);
    }
  }
}

function printWhoami(store: CredentialsStore): void {
  const creds = store.load();
  console.log();
  if (!creds || !creds.accessToken) {
    console.log(style.yellow("Not logged in."));
    console.log(style.dim("Run 'groupy login' to authenticate with pikaa-cli-backend."));
  } else {
    console.log(style.bold("Active Authentication:"));
    console.log(`  • Status: ${style.green("Authenticated")}`);
    console.log(`  • Base URL: ${style.cyan(creds.baseUrl || "https://api.groupy-hub.store/v1")}`);
    console.log(`  • Token: ${style.dim(creds.accessToken.slice(0, 16) + "...")}`);
    if (creds.expiresAt) {
      console.log(`  • Expires: ${style.dim(new Date(creds.expiresAt).toLocaleString())}`);
    }
  }
  console.log();
}

async function printAvailableModels(baseUrl: string, apiKey?: string): Promise<void> {
  console.log(style.dim(`\nFetching models from ${baseUrl}/models ...`));
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/models`, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const models = data.data || [];

    console.log(style.bold("\nAvailable Models:"));
    if (models.length === 0) {
      console.log(style.dim("No models returned by provider."));
    } else {
      for (const m of models) {
        console.log(`  • ${style.cyan(m.id)} ${m.owned_by ? style.dim(`(by ${m.owned_by})`) : ""}`);
      }
    }
    console.log();
  } catch (err) {
    console.error(style.red(`Failed to fetch models: ${err instanceof Error ? err.message : String(err)}`));
  }
}

function printSessionsList(storage: SessionPersistenceManager): void {
  const threads = storage.listSessions();
  console.log();
  if (threads.length === 0) {
    console.log(style.dim("No saved sessions found."));
  } else {
    console.log(style.bold("Saved Sessions:"));
    for (const t of threads) {
      const dateStr = new Date(t.updatedAt).toLocaleString();
      console.log(`  • ${style.cyan(t.id)} [${style.dim(t.model)}] - ${style.dim(dateStr)} (${t.itemsCount} turns/items)`);
    }
    console.log(`\nResume a session with: ${style.bold("groupy --resume <thread_id>")}`);
  }
  console.log();
}

function printSkillsList(loader: SkillsLoader, cwd: string): void {
  const skills = loader.discoverSkills(cwd);
  console.log();
  if (skills.length === 0) {
    console.log(style.dim("No skills found in .agents/skills/ or ~/.groupy/skills/"));
  } else {
    console.log(style.bold("Discovered Domain Skills:"));
    for (const s of skills) {
      console.log(`  • ${style.cyan(s.name)} [${style.dim(s.scope)}]: ${s.description}`);
    }
  }
  console.log();
}

function printMemoriesList(store: MemoryStore, cwd: string): void {
  const memories = store.getAllMemories(cwd);
  console.log();
  if (memories.length === 0) {
    console.log(style.dim("No memories recorded yet."));
  } else {
    console.log(style.bold("Learned Memories:"));
    for (const m of memories) {
      console.log(`  • [${style.cyan(m.category)}] (${style.dim(m.scope)}): ${m.content}`);
    }
  }
  console.log();
}

async function printWorktreesList(manager: WorktreeManager, cwd: string): Promise<void> {
  const worktrees = await manager.listWorktrees(cwd);
  console.log();
  if (worktrees.length === 0) {
    console.log(style.dim("No active Git Worktrees found or directory is not a Git repo."));
  } else {
    console.log(style.bold("Active Git Worktrees:"));
    for (const w of worktrees) {
      const typeTag = w.isMain ? style.cyan("[MAIN]") : style.yellow("[WORKTREE]");
      console.log(`  • ${typeTag} ${style.bold(w.branch)}: ${style.dim(w.path)}`);
    }
  }
  console.log();
}

function printCliHelp(): void {
  console.log(`
${style.bold("Groupy CLI")} - Autonomous Coding Agent & Sub-Agent Orchestrator

${style.bold("USAGE:")}
  groupy [options] [prompt]
  groupy login [backend_url]      # Authenticate via OAuth 2.0 PKCE with pikaa-cli-backend
  groupy logout                   # Clear local credentials
  groupy whoami                   # Check authentication status
  groupy models                   # List available models from backend
  groupy list                     # List all saved sessions
  groupy resume <thread_id>       # Resume a previous session
  groupy skills                   # List available domain skills
  groupy memories                 # View learned user preferences
  groupy worktrees                # List active isolated Git Worktrees

${style.bold("OPTIONS:")}
  -R, --resume <id>        Resume an existing session from SQLite storage
  -m, --model <name>       Model name (default: gpt-4o or $GROUPY_MODEL)
  -u, --base-url <url>     Custom OpenAI-compatible provider endpoint URL ($GROUPY_BASE_URL)
  -k, --api-key <key>      API key for provider authentication ($GROUPY_API_KEY)
  -C, --cwd <path>         Working directory for agent operations (default: current dir)
  -r, --role <role>        Initial agent role (default, reviewer, researcher, tester, planner)
      --mcp <path>         Path to MCP server configuration JSON file
  -h, --help               Show this help message

${style.bold("EXAMPLES:")}
  groupy login http://localhost:8090  # Authenticate with local backend
  groupy models                       # View models from backend
  groupy                              # Start fresh interactive terminal REPL
  groupy "Audit src/main.ts"          # Single-shot prompt execution
`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(style.red(`Fatal CLI error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  });
}
