/**
 * Slash Commands Handler for Groupy CLI REPL.
 */

import { c, style } from "./ui/colors";
import { InteractiveLineEditor } from "./ui/line-editor";
import { formatDuration } from "./ui/spinner";
import { AsciiAnimation, ALL_ANIMATION_VARIANTS, type AnimationVariant } from "./ui/animation";
import { estimateTotalTokens } from "../context/compactor";
import { CredentialsStore } from "../auth/store";
import { AuthClient } from "../auth/oauth";
import type { Session } from "../session/session";
import type { AgentSpawner } from "../agents/spawner";
import type { McpManager } from "../mcp/manager";
import type { SessionPersistenceManager } from "../storage/manager";
import type { SkillsLoader } from "../skills/loader";
import type { MemoryStore } from "../memories/store";
import type { WorktreeManager } from "../worktree/manager";
import type { CliRepl } from "./repl";

export interface SlashCommandDef {
  name: string;
  description: string;
}

export const AVAILABLE_SLASH_COMMANDS: SlashCommandDef[] = [
  { name: "/help", description: "Show command list and help menu" },
  { name: "/stats", description: "Display session runtime, turn stats & sub-agent status" },
  { name: "/model", description: "Select or switch active AI model" },
  { name: "/models", description: "List available AI models from gateway" },
  { name: "/reasoning", description: "Toggle internal reasoning chain visibility" },
  { name: "/login", description: "Authenticate with backend provider" },
  { name: "/whoami", description: "Check backend authentication status" },
  { name: "/skills", description: "List domain skills in workspace & global" },
  { name: "/memories", description: "View learned preferences & memories" },
  { name: "/worktrees", description: "List active isolated Git Worktrees" },
  { name: "/sessions", description: "List saved past sessions from SQLite store" },
  { name: "/roles", description: "List available agent roles & nicknames" },
  { name: "/agents", description: "List active sub-agents & execution status" },
  { name: "/mcp", description: "List connected Model Context Protocol servers" },
  { name: "/animate", description: "Preview 36-frame ASCII art animation variants" },
  { name: "/compact", description: "Trigger manual token history compaction" },
  { name: "/clear", description: "Clear terminal screen" },
  { name: "/logout", description: "Clear stored authentication credentials" },
  { name: "/exit", description: "Exit CLI session" },
];

export interface CommandContext {
  session: Session;
  spawner?: AgentSpawner;
  mcpManager?: McpManager;
  storageManager?: SessionPersistenceManager;
  skillsLoader?: SkillsLoader;
  memoryStore?: MemoryStore;
  worktreeManager?: WorktreeManager;
  repl?: CliRepl;
}

export async function handleSlashCommand(
  input: string,
  ctx: CommandContext
): Promise<boolean> {
  const [cmd, ...args] = input.trim().split(/\s+/);
  const command = cmd?.toLowerCase();

  switch (command) {
    case "/":
    case "/?":
    case "/help":
      printHelp();
      return true;

    case "/stats":
    case "/time":
    case "/uptime":
      printSessionStats(ctx);
      return true;

    case "/model":
    case "/models":
      await handleModelSelection(ctx, args[0]);
      return true;

    case "/reasoning":
    case "/think":
    case "/thinking":
      if (ctx.repl) {
        ctx.repl.showReasoning = !ctx.repl.showReasoning;
        const stateStr = ctx.repl.showReasoning ? style.green("Visible") : style.yellow("Hidden (default)");
        console.log(`\n  Reasoning display: [${stateStr}]\n`);
      } else {
        console.log(style.dim("\n  Reasoning display is hidden by default.\n"));
      }
      return true;

    case "/login":
      await handleInteractiveLogin(args[0]);
      return true;

    case "/whoami":
      printWhoami();
      return true;

    case "/logout":
      new CredentialsStore().clear();
      console.log(style.green("Successfully logged out. Credentials cleared."));
      return true;

    case "/roles":
      printRoles(ctx);
      return true;

    case "/agents":
      printAgents(ctx);
      return true;

    case "/mcp":
      printMcp(ctx);
      return true;

    case "/skills":
    case "/skill":
      handleSkillsCommand(ctx, args);
      return true;

    case "/memories":
    case "/memory":
      printMemories(ctx);
      return true;

    case "/worktrees":
    case "/worktree":
      await printWorktrees(ctx);
      return true;

    case "/sessions":
      printSessions(ctx);
      return true;

    case "/animate":
    case "/animation":
      await handleAnimate(args[0]);
      return true;

    case "/compact":
      console.log(style.brand("◆ Compacting conversation history..."));
      await ctx.session.submit({ type: "TurnInput", request: { text: "/compact" } });
      return true;

    case "/clear":
      console.clear();
      return true;

    case "/exit":
    case "/quit":
      console.log(style.dim("Goodbye!"));
      process.exit(0);

    default:
      console.log(style.yellow(`Unknown command: ${command}.`));
      printHelp();
      return true;
  }
}

export function printHelp(): void {
  console.log();
  console.log(style.bold("  Available Slash Commands:"));
  for (const cmd of AVAILABLE_SLASH_COMMANDS) {
    const pad = cmd.name.padEnd(12, " ");
    console.log(`    ${style.cyan(pad)} ${style.dim(cmd.description)}`);
  }
  console.log();
}

export async function handleModelSelection(ctx: CommandContext, modelArg?: string): Promise<void> {
  if (modelArg && modelArg.trim().length > 0) {
    const chosen = modelArg.trim();
    ctx.session.model = chosen;
    console.log(style.green(`\n✓ Active model switched to: ${style.bold(chosen)}\n`));
    return;
  }

  const creds = new CredentialsStore().load();
  const baseUrl = creds?.baseUrl || process.env.GROUPY_BASE_URL || "https://api.groupy-hub.store/v1";
  const apiKey = creds?.accessToken || process.env.GROUPY_API_KEY;

  console.log(style.dim(`\n  Fetching models from ${baseUrl}/models ...`));
  let models: Array<{ id: string; owned_by?: string }> = [];

  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(`${baseUrl}/models`, { headers });
    if (res.ok) {
      const data = await res.json();
      models = data.data || [];
    }
  } catch {}

  console.log();
  console.log(style.bold("  Available Models:"));

  if (models.length === 0) {
    console.log(style.dim("    (No remote models returned by provider)"));
    console.log(`    Current Model: ${style.brandBold(ctx.session.model)}`);
  } else {
    for (let i = 0; i < models.length; i++) {
      const m = models[i]!;
      const isActive = m.id.toLowerCase() === ctx.session.model.toLowerCase();
      const tag = isActive ? style.green(" (active)") : "";
      const owner = m.owned_by ? style.dim(` (${m.owned_by})`) : "";
      console.log(`    [${style.cyan(String(i + 1))}] ${style.bold(m.id)}${owner}${tag}`);
    }
  }

  console.log();

  const promptText = models.length > 0
    ? `  Select model [1-${models.length}] or type model name: `
    : `  Enter new model name: `;

  const promptEditor = new InteractiveLineEditor({ promptSymbol: promptText });
  const rawAnswer = await promptEditor.readLine();
  const answer = rawAnswer.trim();

  if (!answer) {
    console.log(style.dim("  Model unchanged.\n"));
    return;
  }

  const num = parseInt(answer, 10);
  if (!isNaN(num) && num >= 1 && num <= models.length) {
    const chosen = models[num - 1]!.id;
    ctx.session.model = chosen;
    console.log(style.green(`\n  ✓ Active model switched to: ${style.bold(chosen)}\n`));
  } else {
    ctx.session.model = answer;
    console.log(style.green(`\n  ✓ Active model switched to: ${style.bold(answer)}\n`));
  }
}

export async function handleInteractiveLogin(backendUrl?: string): Promise<void> {
  const credStore = new CredentialsStore();
  const authClient = new AuthClient(credStore);
  const targetBackend = backendUrl || process.env.GROUPY_BACKEND_URL || "https://api.groupy-hub.store";

  console.log(style.brand(`\n🔐 Logging into Backend: ${targetBackend}`));

  try {
    const { authUrl, waitForToken } = await authClient.startOAuthFlow({
      backendUrl: targetBackend,
    });

    console.log(`\nBrowser authorization opened automatically. If not, open:`);
    console.log(style.cyan(style.bold(authUrl)));
    console.log(style.dim(`Waiting for authorization callback on port 1455 ...`));

    const creds = await waitForToken();
    console.log(style.green(`\n✓ Authentication Successful! Token saved to ~/.groupy/credentials.json`));
    console.log(style.dim(`  Gateway Base URL: ${creds.baseUrl}`));
  } catch (err) {
    console.log(style.yellow(`\nOAuth browser login failed: ${err instanceof Error ? err.message : String(err)}`));
    console.log(style.bold(`\nFalling back to Direct Terminal Login:`));

    try {
      const emailEditor = new InteractiveLineEditor({ promptSymbol: "Username or Email (e.g. superadmin): " });
      const emailOrUsername = (await emailEditor.readLine()).trim();

      const passEditor = new InteractiveLineEditor({ promptSymbol: "Password: " });
      const password = (await passEditor.readLine()).trim();

      const creds = await authClient.directLogin({
        backendUrl: targetBackend,
        emailOrUsername,
        password,
      });

      console.log(style.green(`\n✓ Successfully logged in! Token saved to ~/.groupy/credentials.json`));
      console.log(style.dim(`  Gateway Base URL: ${creds.baseUrl}`));
    } catch (directErr) {
      console.error(style.red(`\nDirect login failed: ${directErr instanceof Error ? directErr.message : String(directErr)}`));
    }
  }
}

function printWhoami(): void {
  const store = new CredentialsStore();
  const creds = store.load();
  console.log();
  if (!creds || !creds.accessToken) {
    console.log(style.yellow("  Not logged in."));
    console.log(style.dim("  Run '/login' or 'pikaa login' to authenticate with backend."));
  } else {
    console.log(style.bold("  Active Authentication:"));
    console.log(`    • Status: ${style.green("Authenticated")}`);
    console.log(`    • Base URL: ${style.cyan(creds.baseUrl || "https://api.groupy-hub.store/v1")}`);
    console.log(`    • Token: ${style.dim(creds.accessToken.slice(0, 16) + "...")}`);
    if (creds.expiresAt) {
      console.log(`    • Expires: ${style.dim(new Date(creds.expiresAt).toLocaleString())}`);
    }
  }
  console.log();
}

async function printWorktrees(ctx: CommandContext): Promise<void> {
  const manager = ctx.worktreeManager;
  if (!manager) {
    console.log(style.yellow("Worktree manager not active."));
    return;
  }

  const worktrees = await manager.listWorktrees(ctx.session.cwd);
  console.log();
  if (worktrees.length === 0) {
    console.log(style.dim("  No Git Worktrees active or directory is not a Git repo."));
  } else {
    console.log(style.bold("  Active Git Worktrees:"));
    for (const w of worktrees) {
      const typeTag = w.isMain ? style.cyan("[MAIN]") : style.yellow("[ISOLATED WORKTREE]");
      console.log(`    • ${typeTag} ${style.bold(w.branch)}: ${style.dim(w.path)}`);
    }
  }
  console.log();
}

function printRoles(ctx: CommandContext): void {
  const spawner = ctx.spawner;
  if (!spawner) {
    console.log(style.yellow("Multi-agent spawner not active."));
    return;
  }

  const roles = spawner.roleRegistry.listRoles();
  console.log();
  console.log(style.bold("  Configured Agent Roles:"));
  for (const r of roles) {
    const tools = r.allowedToolNames ? r.allowedToolNames.join(", ") : "all tools";
    console.log(`    • ${style.cyan(r.name)}: ${r.description}`);
    console.log(`      ${style.dim(`Tools: [${tools}]`)}`);
    if (r.nicknameCandidates) {
      console.log(`      ${style.dim(`Nicknames: [${r.nicknameCandidates.join(", ")}]`)}`);
    }
  }
  console.log();
}

function printAgents(ctx: CommandContext): void {
  const spawner = ctx.spawner;
  if (!spawner) {
    console.log(style.yellow("Multi-agent spawner not active."));
    return;
  }

  const agents = spawner.listAgents();
  console.log();
  if (agents.length === 0) {
    console.log(style.dim("  No active or past sub-agents in this session."));
  } else {
    console.log(style.bold("  Spawned Sub-Agents:"));
    for (const a of agents) {
      const statusColor = a.status === "completed" ? style.green : a.status === "error" ? style.red : style.yellow;
      console.log(`    • ${style.bold(a.nickname)} (${style.dim(a.id)}) [${statusColor(a.status.toUpperCase())}]`);
      console.log(`      ${style.dim(`Task: ${a.taskName} | Role: ${a.role}`)}`);
      if (a.lastOutput) {
        const preview = a.lastOutput.slice(0, 100).replace(/\n/g, " ");
        console.log(`      ${style.dim(`Output: "${preview}..."`)}`);
      }
    }
  }
  console.log();
}

function printMcp(ctx: CommandContext): void {
  const mcp = ctx.mcpManager;
  if (!mcp) {
    console.log(style.yellow("MCP Manager not initialized."));
    return;
  }

  const servers = mcp.listServers();
  console.log();
  if (servers.length === 0) {
    console.log(style.dim("  No MCP servers connected."));
    console.log(style.dim("  Create a .mcp.json or mcp_config.json file to connect external tools."));
  } else {
    console.log(style.bold("  Connected Model Context Protocol (MCP) Servers:"));
    for (const s of servers) {
      const status = s.connected ? style.green("Connected") : style.red("Disconnected");
      console.log(`    • ${style.cyan(s.name)} [${status}]`);
      console.log(`      Tools: ${s.toolsCount} registered | Resources: ${s.resourcesCount} available`);
    }
  }
  console.log();
}

function handleSkillsCommand(ctx: CommandContext, args: string[]): void {
  const loader = ctx.skillsLoader;
  if (!loader) {
    console.log(style.yellow("Skills loader not active."));
    return;
  }

  const sub = (args[0] || "").toLowerCase();
  const target = (args[1] || "").toLowerCase();

  if (sub === "disable" || sub === "off") {
    if (!target) {
      console.log(style.yellow("Usage: /skills disable <skill-name>"));
      return;
    }
    loader.disableSkill(target);
    console.log(style.yellow(`\n  ✕ Skill '${target}' disabled.\n`));
    return;
  }

  if (sub === "enable" || sub === "on") {
    if (!target) {
      console.log(style.yellow("Usage: /skills enable <skill-name>"));
      return;
    }
    loader.enableSkill(target);
    console.log(style.green(`\n  ✓ Skill '${target}' enabled.\n`));
    return;
  }

  if (sub === "toggle") {
    if (!target) {
      console.log(style.yellow("Usage: /skills toggle <skill-name>"));
      return;
    }
    const state = loader.toggleSkill(target);
    if (state) {
      console.log(style.green(`\n  ✓ Skill '${target}' is now ENABLED.\n`));
    } else {
      console.log(style.yellow(`\n  ✕ Skill '${target}' is now DISABLED.\n`));
    }
    return;
  }

  const skills = loader.listSkills(ctx.session.cwd, { includeDisabled: true });
  console.log();
  if (skills.length === 0) {
    console.log(style.dim("  No domain skills discovered in .agents/skills/ or ~/.groupy/skills/"));
  } else {
    console.log(style.bold("  Available Domain Skills (Built-in, Workspace, & Global):"));
    for (const s of skills) {
      const isEnabled = !loader.isSkillDisabled(s.name);
      const statusTag = isEnabled ? style.green("[ENABLED]") : style.dim("[DISABLED]");
      const scopeTag = style.cyan(`[${s.scope}]`);
      console.log(`    • ${style.bold(s.name)} ${scopeTag} ${statusTag}`);
      console.log(`      ${style.dim(s.description)}`);
    }
    console.log();
    console.log(style.dim("  Commands: /skills disable <name> | /skills enable <name> | /skills toggle <name>"));
  }
  console.log();
}

function printMemories(ctx: CommandContext): void {
  const store = ctx.memoryStore;
  if (!store) {
    console.log(style.yellow("Memory store not active."));
    return;
  }

  const memories = store.getAllMemories(ctx.session.cwd);
  console.log();
  if (memories.length === 0) {
    console.log(style.dim("  No persistent memories recorded yet."));
  } else {
    console.log(style.bold("  Learned Preferences & Memories:"));
    for (const m of memories) {
      console.log(`    • [${style.cyan(m.category)}] (${style.dim(m.scope)}): ${m.content}`);
    }
  }
  console.log();
}

function printSessions(ctx: CommandContext): void {
  const storage = ctx.storageManager;
  if (!storage) {
    console.log(style.yellow("Session persistence manager not active."));
    return;
  }

  const threads = storage.listSessions();
  console.log();
  if (threads.length === 0) {
    console.log(style.dim("  No saved sessions in SQLite database."));
  } else {
    console.log(style.bold("  Saved Sessions in SQLite Store:"));
    for (const t of threads) {
      const dateStr = new Date(t.updatedAt).toLocaleString();
      console.log(`    • ${style.cyan(t.id)} [${style.dim(t.model)}] - ${style.dim(dateStr)} (${t.itemsCount} items)`);
    }
  }
  console.log();
}

function printSessionStats(ctx: CommandContext): void {
  const uptimeMs = ctx.repl ? Date.now() - ctx.repl.sessionStartTime : 0;
  const turns = ctx.repl?.turnCount ?? 0;
  const history = ctx.session.getHistory();
  const historyTokens = estimateTotalTokens(history);
  const maxTokens = 128000;
  const contextPct = Math.round((historyTokens / maxTokens) * 100);
  const colorFn = contextPct < 50 ? style.green : contextPct < 80 ? style.yellow : style.red;

  const agents = ctx.spawner?.listAgents() || [];
  const activeAgents = agents.filter((a) => a.status === "running");

  console.log();
  console.log(style.bold("  ┌── Session Runtime & Statistics ─────────────────────────"));
  console.log(`  │  ${style.dim("Uptime:")}         ${style.bold(formatDuration(uptimeMs))}`);
  console.log(`  │  ${style.dim("Turns:")}          ${turns} completed`);
  console.log(`  │  ${style.dim("History Items:")}  ${history.length} items`);
  console.log(`  │  ${style.dim("Context Usage:")}  ${colorFn(`${contextPct}%`)} ${style.dim(`(~${historyTokens} tokens / ${maxTokens} max)`)}`);
  console.log(`  │  ${style.dim("Model:")}          ${style.brand(ctx.session.model)}`);
  console.log(`  │  ${style.dim("Working Dir:")}    ${style.dim(ctx.session.cwd)}`);
  console.log("  │");

  if (agents.length === 0) {
    console.log(`  │  ${style.dim("Sub-agents:")}     None spawned yet`);
  } else {
    console.log(`  │  ${style.bold("Sub-agents:")} (${activeAgents.length} active, ${agents.length - activeAgents.length} completed)`);
    for (const a of agents) {
      const runtime = formatDuration(Date.now() - a.createdAt);
      const icon = a.status === "running" ? style.brand("●") : a.status === "completed" ? style.green("✔") : style.red("✗");
      console.log(`  │    ${icon} ${style.cyan(a.nickname)} [${style.dim(a.role)}] - ${a.status} (${runtime})`);
      console.log(`  │      ${style.dim(`Task: ${a.taskName}`)}`);
    }
  }
  console.log(style.bold("  └─────────────────────────────────────────────────────────"));
  console.log();
}

async function handleAnimate(variantName?: string): Promise<void> {
  const chosen = variantName?.toLowerCase() as AnimationVariant | undefined;

  if (chosen && ALL_ANIMATION_VARIANTS.includes(chosen)) {
    console.log(`\n  ${style.brand("◆")} Playing 36-frame animation variant: ${style.bold(chosen)}...\n`);
    const anim = new AsciiAnimation({
      variant: chosen,
      frameTickMs: 60,
      colorFn: (frame) => style.brand(frame),
    });
    await anim.play(2500, { clearScreen: false });
    console.log();
    return;
  }

  console.log();
  console.log(style.bold("  36-Frame ASCII Art Animation Catalog:"));
  for (const v of ALL_ANIMATION_VARIANTS) {
    console.log(`    • ${style.cyan(v)} - ${style.dim(`/animate ${v}`)}`);
  }
  console.log(`\n  ${style.dim("Playing random variant for 2 seconds...")}\n`);
  const anim = new AsciiAnimation({
    variant: "default",
    frameTickMs: 60,
    colorFn: (frame) => style.brand(frame),
  });
  anim.pickRandomVariant();
  await anim.play(2000);
  console.log();
}

