/**
 * Slash Commands Handler for Groupy CLI REPL.
 */

import { c, style } from "./ui/colors";
import { InteractiveLineEditor } from "./ui/line-editor";
import { formatDuration } from "./ui/spinner";
import { CliFormatter } from "./ui/formatter";
import { promptInteractiveList, promptChoice } from "./ui/prompt";
import { estimateTotalTokens, DEFAULT_MAX_CONTEXT_TOKENS } from "../context/compactor";
import { CredentialsStore } from "../auth/store";
import { AuthClient } from "../auth/oauth";
import { runSecurityScan } from "../security/scanner";
import type { Session } from "../session/session";
import type { AgentSpawner } from "../agents/spawner";
import type { McpManager } from "../mcp/manager";
import type { SessionPersistenceManager } from "../storage/manager";
import type { SkillsLoader } from "../skills/loader";
import { installSkill, removeSkill } from "../skills/installer";
import type { MemoryStore } from "../memories/store";
import type { WorktreeManager } from "../worktree/manager";
import type { CliRepl } from "./repl";
import { AgentRoleRegistry, type AgentRole } from "../agents/roles";
import { CHROME_DEVTOOLS_MCP_SERVER_PATH } from "../mcp/servers/chrome-devtools";
import { WEB_SEARCH_MCP_SERVER_PATH } from "../mcp/servers/web-search";
import { SQLITE_MCP_SERVER_PATH } from "../mcp/servers/sqlite";
import { getCliVersion } from "./version";
import { runProjectInit, printInitSummary } from "../init";

export interface SlashCommandDef {
  name: string;
  description: string;
}

export const AVAILABLE_SLASH_COMMANDS: SlashCommandDef[] = [
  { name: "/help", description: "Show command list and help menu" },
  { name: "/init", description: "Initialize or update AGENTS.md project instructions" },
  { name: "/stats", description: "Display session runtime, turn stats & sub-agent status" },
  { name: "/model", description: "Select or switch active AI model" },
  { name: "/reasoning", description: "Toggle internal reasoning chain visibility" },
  { name: "/login", description: "Authenticate with backend provider" },
  { name: "/whoami", description: "Check backend authentication status" },
  { name: "/mode", description: "Cycle or set execution permission mode (auto, manual, accept-edits, plan)" },
  { name: "/auto", description: "Switch to Auto Mode (tools execute automatically)" },
  { name: "/manual", description: "Switch to Manual Mode (all tools require user confirmation)" },
  { name: "/accept-edits", description: "Switch to Accept Edits Mode (file edits auto-approved, shell prompts)" },
  { name: "/plan", description: "Switch to Plan Mode (read-only planning, mutations blocked)" },
  { name: "/skills", description: "Manage domain skills (/skills, /skill add <name>, /skill remove <name>)" },
  { name: "/memories", description: "View learned preferences & memories" },
  { name: "/worktrees", description: "List active isolated Git Worktrees" },
  { name: "/resume", description: "Resume a previous conversation session (/resume [id])" },
  { name: "/sessions", description: "List and manage saved past sessions" },
  { name: "/role", description: "Select and inspect specialized agent roles & personas" },
  { name: "/security", description: "Scan codebase for vulnerabilities & secrets (Strix)" },
  { name: "/agents", description: "List active sub-agents & execution status" },
  { name: "/mcp", description: "List connected Model Context Protocol servers" },
  { name: "/release-notes", description: "View changelog and what's new in this version" },
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
      await printHelp(ctx);
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
      await handleReasoningCommand(ctx, args[0]);
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

    case "/role":
    case "/roles":
      await handleRolesCommand(ctx, args[0]);
      return true;

    case "/mode":
    case "/modes":
    case "/permission":
    case "/permissions":
      await handleModeCommand(ctx, args[0]);
      return true;

    case "/auto":
      ctx.session.setPermissionMode("auto");
      console.log(`\n  \x1b[38;2;255;215;0m⏵⏵ Switched to Auto Mode (tools execute automatically)\x1b[0m\n`);
      return true;

    case "/manual":
      ctx.session.setPermissionMode("manual");
      console.log(`\n  \x1b[38;2;148;148;148m⏸ Switched to Manual Mode (all tools require user confirmation)\x1b[0m\n`);
      return true;

    case "/accept-edits":
    case "/acceptedits":
      ctx.session.setPermissionMode("accept-edits");
      console.log(`\n  \x1b[38;2;175;175;215m⏵⏵ Switched to Accept Edits Mode (file edits auto-approved, shell prompts)\x1b[0m\n`);
      return true;

    case "/plan":
      ctx.session.setPermissionMode("plan");
      console.log(`\n  \x1b[38;2;95;175;175m⏸ Switched to Plan Mode (read-only planning, mutations blocked)\x1b[0m\n`);
      return true;

    case "/init":
      console.log(`\n  \x1b[38;2;217;119;87m✳ Initializing project instructions via AI agent...\x1b[0m\n`);
      if (ctx.repl) {
        await ctx.repl.submitTurn(
          "Analyze this codebase and create or update the AGENTS.md project instruction file in the workspace root following Claude Code best practices. Inspect key config files (package.json, tsconfig, etc.), test/build scripts, and main source directories to discover exact development commands, architectural conventions, and workflow requirements. Write the finalized AGENTS.md using the write_file tool."
        );
      } else {
        const initResult = runProjectInit({ cwd: ctx.session.cwd });
        printInitSummary(initResult);
      }
      return true;

    case "/agents":
      printAgents(ctx);
      return true;

    case "/mcp":
      await handleMcpCommand(ctx, args);
      return true;

    case "/skills":
    case "/skill":
      await handleSkillsCommand(ctx, args);
      return true;

    case "/memories":
    case "/memory":
      printMemories(ctx);
      return true;

    case "/worktrees":
    case "/worktree":
      await printWorktrees(ctx);
      return true;

    case "/resume":
    case "/sessions":
    case "/session":
      await handleResumeCommand(ctx, args);
      return true;

    case "/security":
    case "/audit":
    case "/vuln":
    case "/pentest":
      await handleSecurityCommand(ctx, args);
      return true;

    case "/release-notes":
    case "/release-note":
    case "/releasenotes":
    case "/releasenote":
    case "/changelog":
    case "/whatsnew":
      printReleaseNotes();
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
      if (ctx.mcpManager) {
        try {
          await ctx.mcpManager.closeAll();
        } catch {}
      }
      if (ctx.repl) {
        try {
          await ctx.repl.close();
        } catch {}
      }
      process.exit(0);

    default:
      console.log(style.yellow(`Unknown command: ${command}.`));
      printHelp();
      return true;
  }
}

export async function printHelp(ctx?: CommandContext): Promise<void> {
  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    console.log();
    console.log(style.bold("  Available Slash Commands:"));
    for (const cmd of AVAILABLE_SLASH_COMMANDS) {
      const pad = cmd.name.padEnd(12, " ");
      console.log(`    ${style.cyan(pad)} ${style.dim(cmd.description)}`);
    }
    console.log();
    return;
  }

  const items = AVAILABLE_SLASH_COMMANDS.map((c) => ({
    id: c.name,
    label: c.name,
    description: c.description,
  }));

  const res = await promptInteractiveList({
    title: "⚡ Slash Commands Palette",
    items,
    mode: "select",
    maxVisible: 10,
    customKeyHints: "↑/↓: navigate · Enter: run command · Esc: close",
  });

  if (res.action === "select" && res.selectedItem && ctx) {
    console.log(style.dim(`\n  Executing ${res.selectedItem.id} ...\n`));
    await handleSlashCommand(res.selectedItem.id, ctx);
  }
}

export async function handleReasoningCommand(ctx: CommandContext, arg?: string): Promise<void> {
  if (!ctx.repl) {
    console.log(style.dim("\n  Reasoning display is hidden by default.\n"));
    return;
  }

  if (arg) {
    const lower = arg.toLowerCase();
    if (lower === "on" || lower === "show" || lower === "true") {
      ctx.repl.showReasoning = true;
    } else if (lower === "off" || lower === "hide" || lower === "false") {
      ctx.repl.showReasoning = false;
    } else {
      ctx.repl.showReasoning = !ctx.repl.showReasoning;
    }
    const stateStr = ctx.repl.showReasoning ? style.green("Visible") : style.yellow("Hidden (default)");
    console.log(`\n  Reasoning display: [${stateStr}]\n`);
    return;
  }

  const current = ctx.repl.showReasoning;
  const choice = await promptChoice({
    message: `AI Reasoning Stream (Currently: ${current ? "Visible" : "Hidden"}):`,
    choices: [
      { key: "h", label: "Hidden (in spinner)", value: false, isDefault: !current },
      { key: "v", label: "Visible (live stream)", value: true, isDefault: current },
      { key: "t", label: "Toggle state", value: !current },
    ],
    defaultIndex: current ? 1 : 0,
  });

  ctx.repl.showReasoning = choice;
  const stateStr = ctx.repl.showReasoning ? style.green("Visible") : style.yellow("Hidden (default)");
  console.log(`\n  Reasoning display updated to: [${stateStr}]\n`);
}

export async function handleModelSelection(ctx: CommandContext, modelArg?: string): Promise<void> {
  const credStore = new CredentialsStore();

  if (modelArg && modelArg.trim().length > 0) {
    const chosen = modelArg.trim();
    ctx.session.model = chosen;
    credStore.setDefaultModel(chosen);
    console.log(style.green(`\n  ✓ Default model switched and saved to: ${style.bold(chosen)}\n`));
    return;
  }

  const creds = credStore.load();
  const baseUrl = creds?.baseUrl || process.env.GROUPY_BASE_URL || "https://api.groupy-hub.store/v1";
  const apiKey = creds?.accessToken || process.env.GROUPY_API_KEY;

  let models: Array<{ id: string; owned_by?: string }> = [];

  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(`${baseUrl}/models`, {
      headers,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.data) && data.data.length > 0) {
        models = data.data;
      }
    }
  } catch {}

  if (models.length === 0) {
    models = [
      { id: "gemini-2.5-flash", owned_by: "google" },
      { id: "gemini-2.5-pro", owned_by: "google" },
      { id: "claude-3-5-sonnet", owned_by: "anthropic" },
      { id: "claude-3-7-sonnet", owned_by: "anthropic" },
      { id: "gpt-4o", owned_by: "openai" },
      { id: "gpt-4o-mini", owned_by: "openai" },
      { id: "deepseek-r1", owned_by: "deepseek" },
      { id: "deepseek-v3", owned_by: "deepseek" },
      { id: "qwen-2.5-coder", owned_by: "alibaba" },
    ];
  }

  const items = models.map((m) => ({
    id: m.id,
    label: m.id,
    badge: m.owned_by ? `provider: ${m.owned_by}` : undefined,
    checked: m.id.toLowerCase() === ctx.session.model.toLowerCase(),
  }));

  const activeIdx = Math.max(0, models.findIndex((m) => m.id.toLowerCase() === ctx.session.model.toLowerCase()));

  const res = await promptInteractiveList({
    title: `🤖 Select Default AI Model (Current: ${ctx.session.model})`,
    items,
    mode: "select",
    defaultIndex: activeIdx,
    customKeyHints: "↑/↓: navigate · Enter: set as default model · Esc: keep current",
  });

  if (res.action === "select" && res.selectedItem) {
    const chosen = res.selectedItem.id;
    ctx.session.model = chosen;
    credStore.setDefaultModel(chosen);
    console.log(style.green(`\n  ✓ Default model switched and saved to: ${style.bold(chosen)}\n`));
  } else {
    console.log(style.dim("\n  Model unchanged.\n"));
  }
}

export async function handleInteractiveLogin(backendUrl?: string): Promise<void> {
  const credStore = new CredentialsStore();
  const authClient = new AuthClient(credStore);
  const targetBackend = backendUrl || process.env.GROUPY_BACKEND_URL || "https://api.groupy-hub.store";

  console.log(style.brand(`\n Logging into Backend: ${targetBackend}`));

  try {
    const { authUrl, waitForToken } = await authClient.startOAuthFlow({
      backendUrl: targetBackend,
    });

    console.log(`\nBrowser authorization opened automatically. If not, open:`);
    console.log(style.cyan(style.bold(authUrl)));
    console.log(style.dim(`Waiting for authorization callback on port 1455 ...`));

    const creds = await waitForToken();
    console.log(style.green(`\n✓ Authentication Successful! Token saved to ~/.pikaa/credentials.json`));
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

      console.log(style.green(`\n✓ Successfully logged in! Token saved to ~/.pikaa/credentials.json`));
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
  if (worktrees.length === 0) {
    console.log(style.dim("\n  No Git Worktrees active or directory is not a Git repo.\n"));
    return;
  }

  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    console.log();
    console.log(style.bold("  Active Git Worktrees:"));
    for (const w of worktrees) {
      const typeTag = w.isMain ? style.cyan("[MAIN]") : style.yellow("[ISOLATED WORKTREE]");
      console.log(`    • ${typeTag} ${style.bold(w.branch)}: ${style.dim(w.path)}`);
    }
    console.log();
    return;
  }

  const items = worktrees.map((w) => ({
    id: w.branch,
    label: `${w.isMain ? "[MAIN]" : "[WORKTREE]"} ${w.branch}`,
    description: w.path,
    badge: w.isMain ? "main repo" : "isolated",
  }));

  await promptInteractiveList({
    title: `🌳 Active Git Worktrees (${worktrees.length} branches)`,
    items,
    mode: "select",
    customKeyHints: "↑/↓: navigate · Esc: exit",
  });
}

export async function handleRolesCommand(ctx: CommandContext, roleArg?: string): Promise<void> {
  const spawner = ctx.spawner;
  const roleRegistry = spawner?.roleRegistry || new AgentRoleRegistry();
  const roles = roleRegistry.listRoles();

  if (roleArg) {
    const role = roleRegistry.getRole(roleArg.toLowerCase());
    if (role) {
      displayRoleDetails(role);
      return;
    } else {
      console.log(style.yellow(`\n  Unknown role: "${roleArg}". Available roles: ${roles.map((r) => r.name).join(", ")}\n`));
      return;
    }
  }

  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    printRoles(ctx);
    return;
  }

  const items = roles.map((r) => {
    const tools = r.allowedToolNames ? r.allowedToolNames.join(", ") : "all tools";
    return {
      id: r.name,
      label: r.name,
      description: `${r.description} · [${tools}]`,
      badge: r.name === "default" ? "primary" : undefined,
    };
  });

  const res = await promptInteractiveList({
    title: `🎭 Agent Roles & Specialized Personas (${roles.length} roles)`,
    items,
    mode: "select",
    customKeyHints: "↑/↓: navigate · Enter: view details · Esc: close",
  });

  if (res.action === "select" && res.selectedItem) {
    const role = roleRegistry.getRole(res.selectedItem.id);
    if (role) {
      displayRoleDetails(role);
    }
  }
}

function displayRoleDetails(role: AgentRole): void {
  const boxWidth = Math.min(process.stdout.columns ?? 80, 75);
  const border = "─".repeat(Math.max(10, boxWidth - role.name.length - 16));
  const tools = role.allowedToolNames ? role.allowedToolNames.join(", ") : "all tools";
  const nicks = role.nicknameCandidates ? role.nicknameCandidates.join(", ") : "none";

  console.log();
  console.log(`  ${style.cyan("┌──")} ${style.bold(`Role: ${role.name}`)} ${style.cyan(border)}`);
  console.log(`  ${style.cyan("│")}  ${style.bold("Description:")} ${role.description}`);
  console.log(`  ${style.cyan("│")}  ${style.bold("Allowed Tools:")} ${style.dim(`[${tools}]`)}`);
  console.log(`  ${style.cyan("│")}  ${style.bold("Nicknames:")} ${style.dim(`[${nicks}]`)}`);
  console.log(`  ${style.cyan("│")}`);
  console.log(`  ${style.cyan("│")}  ${style.bold("System Prompt:")}`);
  for (const line of role.systemPrompt.split("\n")) {
    console.log(`  ${style.cyan("│")}    ${style.dim(line)}`);
  }
  console.log(`  ${style.cyan("└" + "─".repeat(Math.max(10, boxWidth - 4)))}\n`);
}

function printRoles(ctx: CommandContext): void {
  const spawner = ctx.spawner;
  const roleRegistry = spawner?.roleRegistry || new AgentRoleRegistry();
  const roles = roleRegistry.listRoles();
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

async function handleSkillsCommand(ctx: CommandContext, args: string[]): Promise<void> {
  const loader = ctx.skillsLoader;
  if (!loader) {
    console.log(style.yellow("Skills loader not active."));
    return;
  }

  const sub = (args[0] || "").toLowerCase();
  const target = (args[1] || "").toLowerCase();

  if (sub === "install" || sub === "add") {
    if (!target) {
      console.log(style.yellow("Usage: /skill add <skill-name> [--global]"));
      return;
    }
    const isGlobal = args.includes("--global") || args.includes("-g");
    try {
      console.log(style.dim(`\n  Fetching skill '${target}' from catalog...`));
      const res = await installSkill(target, { cwd: ctx.session.cwd, global: isGlobal });
      loader.clearCache();
      console.log(style.green(`\n  ✓ ${res.message}\n`));
    } catch (err: any) {
      console.log(style.red(`\n  ✕ Failed to install skill: ${err.message}\n`));
    }
    return;
  }

  if (sub === "remove" || sub === "uninstall" || sub === "rm") {
    if (!target) {
      console.log(style.yellow("Usage: /skill remove <skill-name> [--global]"));
      return;
    }
    const isGlobal = args.includes("--global") || args.includes("-g");
    const res = removeSkill(target, { cwd: ctx.session.cwd, global: isGlobal });
    loader.clearCache();
    if (res.removed) {
      console.log(style.green(`\n  ✓ Skill '${target}' removed from ${res.targetDir}\n`));
    } else {
      console.log(style.yellow(`\n  ✕ Skill '${target}' was not found in ${res.targetDir}\n`));
    }
    return;
  }

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
  if (skills.length === 0) {
    console.log(style.dim("\n  No domain skills discovered in .agents/skills/ or ~/.pikaa/skills/\n"));
    return;
  }

  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    console.log();
    console.log(style.bold("  Available Domain Skills (Built-in, Workspace, & Global):"));
    for (const s of skills) {
      const isEnabled = !loader.isSkillDisabled(s.name);
      const statusTag = isEnabled ? style.green("[ENABLED]") : style.dim("[DISABLED]");
      const scopeTag = style.cyan(`[${s.scope}]`);
      console.log(`    • ${style.bold(s.name)} ${scopeTag} ${statusTag}`);
      console.log(`      ${style.dim(s.description)}`);
    }
    console.log();
    return;
  }

  const items = skills.map((s) => ({
    id: s.name,
    label: s.name,
    description: s.description,
    badge: s.scope,
    checked: !loader.isSkillDisabled(s.name),
  }));

  await promptInteractiveList({
    title: `🧩 Domain Skills Manager (${skills.length} available)`,
    items,
    mode: "toggle",
    maxVisible: 8,
    onToggle: (item) => {
      loader.toggleSkill(item.id);
    },
    onAction: (key) => {
      if (key === "a") {
        for (const s of skills) loader.enableSkill(s.name);
        for (const it of items) it.checked = true;
      } else if (key === "d") {
        for (const s of skills) loader.disableSkill(s.name);
        for (const it of items) it.checked = false;
      }
      return false;
    },
    customKeyHints: "↑/↓: navigate · Space: toggle on/off · a: all on · d: all off · Enter/Esc: done",
  });

  const activeCount = skills.filter((s) => !loader.isSkillDisabled(s.name)).length;
  console.log(`\n  ${style.green("✓")} Skills configuration updated: ${style.bold(String(activeCount))} active, ${style.dim(`${skills.length - activeCount} disabled`)}\n`);
}

function printMemories(ctx: CommandContext): void {
  const store = ctx.memoryStore;
  if (!store) {
    console.log(style.yellow("\n  Memory store not active.\n"));
    return;
  }

  const cwd = ctx.session.cwd;
  const memoryDir = store.getProjectMemoryDir(cwd);
  const topics = store.listProjectMemories(cwd);
  const indexContent = store.loadMemoryIndex(cwd);

  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";
  const DIM = "\x1b[2m";
  const CYAN = "\x1b[38;2;120;190;255m";
  const GREEN = "\x1b[38;2;140;220;140m";
  const ORANGE = "\x1b[38;2;217;119;87m";
  const PURPLE = "\x1b[38;2;190;140;240m";
  const YELLOW = "\x1b[38;2;250;210;110m";

  const getCategoryColor = (cat: string) => {
    switch (cat.toLowerCase()) {
      case "user":
        return CYAN;
      case "feedback":
        return GREEN;
      case "project":
        return ORANGE;
      case "reference":
        return PURPLE;
      default:
        return YELLOW;
    }
  };

  console.log();
  console.log(`  ${BOLD}🧠 Project Auto-Memory Bank${RESET}`);
  console.log(`  ${DIM}Directory: ${memoryDir}${RESET}`);
  console.log(`  ${DIM}Status: ${GREEN}Active (Loaded into turn context ≤200 lines)${RESET}`);
  console.log();

  if (topics.length === 0) {
    console.log(`  ${DIM}No persistent topic memories saved for this project yet.${RESET}`);
    console.log(`  ${DIM}As you work, Pikaa automatically records user preferences, feedback, and project context.${RESET}`);
  } else {
    console.log(`  ${BOLD}Learned Memory Topics (${topics.length}):${RESET}`);
    for (const t of topics) {
      const color = getCategoryColor(t.type);
      console.log(`    • ${color}[${t.type}]${RESET} ${BOLD}${t.name}${RESET}: ${DIM}${t.description || t.content.split("\n")[0]}${RESET}`);
    }
  }

  console.log();
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function printRecentConversation(items: any[]): void {
  if (!items || items.length === 0) return;
  const dialog = items
    .filter(
      (i) => i.type === "user_message" || i.type === "agent_message" || i.role === "user" || i.role === "assistant"
    )
    .slice(-3);

  if (dialog.length === 0) return;

  console.log(style.dim("  Recent context:"));
  for (const item of dialog) {
    const isUser = item.role === "user" || item.type === "user_message";
    const text = typeof item.content === "string" ? item.content : (item.text || "");
    const singleLine = text.trim().replace(/\s+/g, " ");
    const preview = singleLine.length > 85 ? singleLine.slice(0, 82) + "..." : singleLine;
    const badge = isUser ? style.brand("  ❯ User:") : style.cyan("  ● Assistant:");
    console.log(`${badge} ${style.dim(preview)}`);
  }
  console.log();
}

export async function handleResumeCommand(ctx: CommandContext, args: string[] = []): Promise<void> {
  const storage = ctx.storageManager;
  if (!storage) {
    console.log(style.yellow("\n  Session persistence manager not active.\n"));
    return;
  }

  const rawThreads = storage.listSessions();
  if (rawThreads.length === 0) {
    console.log(style.dim("\n  No saved conversation sessions found in SQLite database.\n"));
    return;
  }

  // Sort by latest updated first
  const threads = [...rawThreads].sort((a, b) => b.updatedAt - a.updatedAt);

  // Check if an argument filter was passed
  const filterArg = args[0]?.trim();
  let defaultIdx = 0;
  if (filterArg) {
    const foundIdx = threads.findIndex(
      (t) => t.id === filterArg || t.id.toLowerCase().startsWith(filterArg.toLowerCase())
    );
    if (foundIdx !== -1) {
      defaultIdx = foundIdx;
    }
  }

  // Non-interactive / piped stdin fallback
  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    if (filterArg) {
      const match = threads[defaultIdx]!;
      const restored = storage.resumeIntoSession(ctx.session, match.id);
      if (restored) {
        console.log(
          style.green(
            `\n  ✓ Resumed past session: ${style.bold(match.id)} (${restored.items.length} items, model: ${restored.thread.model || ctx.session.model})\n`
          )
        );
        printRecentConversation(restored.items);
      } else {
        console.log(style.red(`\n  ✕ Failed to load session '${match.id}'.\n`));
      }
      return;
    }

    console.log();
    console.log(style.bold("  Saved Sessions in SQLite Store:"));
    for (const t of threads) {
      const timeStr = formatRelativeTime(t.updatedAt);
      const titleStr = t.title && t.title !== "New Session" ? ` - "${t.title}"` : "";
      console.log(`    • ${style.cyan(t.id)} [${style.dim(t.model)}]${titleStr} - ${style.dim(timeStr)} (${t.itemsCount ?? 0} items)`);
    }
    console.log();
    return;
  }

  // Fully Interactive List Prompt
  const items = threads.map((t) => {
    const timeStr = formatRelativeTime(t.updatedAt);
    const titlePart = t.title && t.title !== "New Session" ? `"${t.title.slice(0, 36)}"` : undefined;
    return {
      id: t.id,
      label: t.id,
      badge: t.model,
      description: [titlePart, `${t.itemsCount ?? 0} items`, timeStr].filter(Boolean).join(" · "),
    };
  });

  const res = await promptInteractiveList({
    title: `🗄️ Resume Past Conversation (${threads.length} saved)`,
    items,
    mode: "select",
    defaultIndex: defaultIdx,
    onAction: (key, item, idx) => {
      if (key === "d") {
        storage.deleteSession(item.id);
        items.splice(idx, 1);
        console.log(style.yellow(`\n  ✕ Deleted session ${item.id}`));
      }
      return false;
    },
    customKeyHints: "↑/↓: navigate · Enter: resume conversation · d: delete · Esc: cancel",
  });

  if (res.action === "select" && res.selectedItem) {
    const restored = storage.resumeIntoSession(ctx.session, res.selectedItem.id);
    if (restored) {
      console.log(
        style.green(
          `\n  ✓ Resumed past conversation: ${style.bold(res.selectedItem.id)} (${restored.items.length} items, model: ${restored.thread.model || ctx.session.model})\n`
        )
      );
      printRecentConversation(restored.items);
    } else {
      console.log(style.red(`\n  ✕ Failed to load session '${res.selectedItem.id}'.\n`));
    }
  } else {
    console.log(style.dim("\n  Session resume cancelled.\n"));
  }
}

async function printSessions(ctx: CommandContext): Promise<void> {
  await handleResumeCommand(ctx);
}

function printSessionStats(ctx: CommandContext): void {
  const uptimeMs = ctx.repl ? Date.now() - ctx.repl.sessionStartTime : 0;
  const turns = ctx.repl?.turnCount ?? 0;
  const history = ctx.session.getHistory();
  const historyTokens = estimateTotalTokens(history);
  const maxTokens = DEFAULT_MAX_CONTEXT_TOKENS;
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

async function handleSecurityCommand(ctx: CommandContext, args: string[]): Promise<void> {
  const sub = (args[0] || "scan").toLowerCase();
  const target = args[1] || ctx.session.cwd;

  if (sub === "help") {
    console.log();
    console.log(style.bold("    Security & Vulnerability Assessment Commands (Strix):"));
    console.log(`    ${style.cyan("/security scan")}          - Scan repository for exposed secrets & OWASP Top 10 vulnerabilities`);
    console.log(`    ${style.cyan("/security audit <path>")}  - Run security audit on a specific file or directory`);
    console.log(`    ${style.cyan("/security fix")}           - Spawn security-auditor sub-agent to remediate vulnerabilities`);
    console.log();
    return;
  }

  if (sub === "fix") {
    const spawner = ctx.spawner;
    if (!spawner) {
      console.log(style.yellow("\n  Multi-agent spawner not active. Running in main session...\n"));
      await ctx.session.submit({
        type: "TurnInput",
        request: { text: "Perform a security audit, find all vulnerabilities and exposed secrets, and apply safe code patches to remediate them." },
      });
      return;
    }
    console.log(style.brand("\n    Spawning autonomous security-auditor sub-agent..."));
    const handle = await spawner.spawnAgent({
      taskName: "security_remediation",
      message: "Perform a security audit across the codebase, identify all vulnerabilities and exposed secrets, and apply safe code patches to remediate them.",
      role: "security-auditor",
    });
    console.log(style.green(`  ✓ Sub-agent '${handle.nickname}' (${handle.id}) spawned with role: ${handle.role}\n`));
    return;
  }

  // Default: scan or audit
  console.log(style.brand(`\n    Running static security scan on: ${style.dim(target)} ...`));
  const report = await runSecurityScan(target);
  CliFormatter.printSecurityReport(report);
}

async function handleMcpCommand(ctx: CommandContext, args: string[]): Promise<void> {
  const manager = ctx.mcpManager;
  if (!manager) {
    console.log(style.yellow("\n  MCP Manager is not active in current session.\n"));
    return;
  }

  const sub = (args[0] || "list").toLowerCase();

  if (sub === "help") {
    console.log();
    console.log(style.bold("  🔌 Model Context Protocol (MCP) Commands:"));
    console.log(`    ${style.cyan("/mcp")} or ${style.cyan("/mcp list")}                - List all connected MCP servers & capabilities`);
    console.log(`    ${style.cyan("/mcp tools [server]")}             - List tools exposed by MCP servers`);
    console.log(`    ${style.cyan("/mcp resources [server]")}         - List resources exposed by MCP servers`);
    console.log(`    ${style.cyan("/mcp test <server>")}              - Ping an MCP server and measure latency`);
    console.log(`    ${style.cyan("/mcp add chrome")}                 - Connect built-in Chrome DevTools browser automation`);
    console.log(`    ${style.cyan("/mcp add search")}                 - Connect built-in Cloud Web Search & Live Docs MCP`);
    console.log(`    ${style.cyan("/mcp add sqlite [path]")}          - Connect built-in SQLite & Database Inspector MCP`);
    console.log(`    ${style.cyan("/mcp add <name> <cmd> [args...]")} - Connect and save a new stdio MCP server`);
    console.log(`    ${style.cyan("/mcp remove <name>")}              - Disconnect and remove an MCP server`);
    console.log(`    ${style.cyan("/mcp reload")}                     - Reload all MCP configs and refresh tools`);
    console.log();
    return;
  }

  if (sub === "tools") {
    const serverName = args[1];
    if (serverName) {
      const client = manager.getClient(serverName);
      if (!client) {
        console.log(style.red(`\n  MCP server '${serverName}' not found.\n`));
        return;
      }
      CliFormatter.printMcpTools(serverName, client.getTools());
    } else {
      const clients = manager.listClients();
      if (clients.length === 0) {
        console.log(style.dim("\n  No MCP servers connected.\n"));
        return;
      }
      for (const client of clients) {
        CliFormatter.printMcpTools(client.name, client.getTools());
      }
    }
    return;
  }

  if (sub === "resources") {
    const serverName = args[1];
    if (serverName) {
      const client = manager.getClient(serverName);
      if (!client) {
        console.log(style.red(`\n  MCP server '${serverName}' not found.\n`));
        return;
      }
      CliFormatter.printMcpResources(serverName, client.getResources());
    } else {
      const clients = manager.listClients();
      if (clients.length === 0) {
        console.log(style.dim("\n  No MCP servers connected.\n"));
        return;
      }
      for (const client of clients) {
        CliFormatter.printMcpResources(client.name, client.getResources());
      }
    }
    return;
  }

  if (sub === "test" || sub === "ping") {
    const serverName = args[1];
    if (!serverName) {
      console.log(style.yellow("\n  Usage: /mcp test <server-name>\n"));
      return;
    }
    console.log(style.dim(`\n  Pinging MCP server '${serverName}'...`));
    const result = await manager.pingServer(serverName);
    if (result.success) {
      console.log(style.green(`  ✓ PONG from '${serverName}' in ${result.durationMs}ms\n`));
    } else {
      console.log(style.red(`  ✕ Ping failed for '${serverName}': ${result.error || "Unknown error"}\n`));
    }
    return;
  }

  if (sub === "add") {
    let name = args[1];
    let command = args[2];
    let serverArgs = args.slice(3);

    // Preset auto-detection for chrome / chrome-devtools
    if (name === "chrome" || name === "chrome-devtools") {
      if (!command) {
        command = process.execPath;
        serverArgs = [CHROME_DEVTOOLS_MCP_SERVER_PATH];
      }
    }

    // Preset auto-detection for web-search / search
    if (name === "search" || name === "web-search" || name === "docs") {
      if (!command) {
        command = process.execPath;
        serverArgs = [WEB_SEARCH_MCP_SERVER_PATH];
      }
    }

    // Preset auto-detection for sqlite / db / sqlite-local
    if (name === "sqlite" || name === "db" || name === "sqlite-local") {
      const isCustomBinary = command && (command.startsWith("npx") || command.startsWith("python") || command.startsWith("docker"));
      if (!isCustomBinary) {
        const customDbPath = command; // if user typed '/mcp add sqlite ./data.db'
        command = process.execPath;
        serverArgs = customDbPath ? [SQLITE_MCP_SERVER_PATH, customDbPath] : [SQLITE_MCP_SERVER_PATH];
      }
    }

    if (!name || !command) {
      console.log(style.yellow("\n  Usage: /mcp add <name> <command> [args...]"));
      console.log(style.dim("  Example: /mcp add chrome"));
      console.log(style.dim("  Example: /mcp add search"));
      console.log(style.dim("  Example: /mcp add sqlite [./mydb.sqlite]"));
      console.log(style.dim("  Example: /mcp add postgres npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb\n"));
      return;
    }

    console.log(style.brand(`\n  Connecting to new MCP server '${name}' (${command})...`));
    try {
      const client = await manager.registerServer(name, {
        type: "stdio",
        command,
        args: serverArgs,
      });
      manager.registerToolsIntoRouter(ctx.session.tools);

      const configFile = manager.getDefaultConfigFile(ctx.session.cwd);
      manager.saveServerToConfigFile(configFile, name, {
        type: "stdio",
        command,
        args: serverArgs,
      });

      console.log(
        style.green(
          `  ✓ MCP server '${name}' connected successfully! (${client.getTools().length} tools discovered, saved to ${style.dim(configFile)})\n`
        )
      );
    } catch (err) {
      console.log(style.red(`  ✕ Failed to connect MCP server '${name}': ${err instanceof Error ? err.message : String(err)}\n`));
    }
    return;
  }

  if (sub === "remove" || sub === "rm" || sub === "delete") {
    const name = args[1];
    if (!name) {
      console.log(style.yellow("\n  Usage: /mcp remove <server-name>\n"));
      return;
    }

    const removed = await manager.removeServer(name, ctx.session.tools);
    const configFile = manager.getDefaultConfigFile(ctx.session.cwd);
    manager.removeServerFromConfigFile(configFile, name);

    if (removed) {
      console.log(style.green(`\n  ✓ MCP server '${name}' removed and disconnected.\n`));
    } else {
      console.log(style.yellow(`\n  MCP server '${name}' was not running.\n`));
    }
    return;
  }

  if (sub === "reload" || sub === "restart") {
    console.log(style.brand("\n  Reloading all MCP configurations..."));
    await manager.reload(ctx.session.tools);
    console.log(style.green("  ✓ All MCP servers reloaded and tools refreshed.\n"));
    return;
  }

  // Default: list servers
  const servers = manager.listServers();
  const configFiles = manager.getLoadedConfigFiles();

  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    CliFormatter.printMcpServers(servers, configFiles);
    return;
  }

  if (servers.length === 0) {
    CliFormatter.printMcpServers(servers, configFiles);
    return;
  }

  const items = servers.map((s) => ({
    id: s.name,
    label: s.name,
    badge: s.connected ? "Connected" : "Disconnected",
    description: `${s.toolsCount} tools · ${s.resourcesCount} resources`,
    checked: s.connected,
  }));

  const res = await promptInteractiveList({
    title: `🔌 Connected MCP Servers (${servers.length} total)`,
    items,
    mode: "select",
    onAction: async (key, item) => {
      if (key === "t") {
        console.log(style.dim(`\n  Pinging '${item.id}'...`));
        const testRes = await manager.pingServer(item.id);
        if (testRes.success) {
          console.log(style.green(`  ✓ PONG from '${item.id}' in ${testRes.durationMs}ms`));
        } else {
          console.log(style.red(`  ✕ Ping failed: ${testRes.error}`));
        }
      }
      return false;
    },
    customKeyHints: "↑/↓: navigate · Enter: inspect tools · t: ping test · Esc: exit",
  });

  if (res.action === "select" && res.selectedItem) {
    const client = manager.getClient(res.selectedItem.id);
    if (client) {
      CliFormatter.printMcpTools(res.selectedItem.id, client.getTools());
    }
  }
}

export function printReleaseNotes(): void {
  const version = getCliVersion({ prefix: true });
  const ROSE = "\x1b[38;2;205;105;74m";
  const WHITE = "\x1b[38;2;255;255;255m";
  const GRAY = "\x1b[38;2;148;148;148m";
  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";

  function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "");
  }

  function padLine(str: string, width: number): string {
    const vis = stripAnsi(str);
    return str + " ".repeat(Math.max(0, width - vis.length));
  }

  const totalInnerWidth = 74;
  const contentLines = [
    "",
    "  " + BOLD + WHITE + "🚀 What's New in " + version + " (Latest)" + RESET,
    "  " + ROSE + "•" + RESET + " " + WHITE + BOLD + "Persistent Default AI Model" + RESET + ": Switch via " + ROSE + "/model" + RESET + " and save",
    "    preference across sessions in ~/.pikaa/credentials.json.",
    "  " + ROSE + "•" + RESET + " " + WHITE + BOLD + "Real-time Git Branch Detection" + RESET + ": Header displays active branch",
    "    ( main) alongside user subscription tier (Groupy Pro / Max).",
    "  " + ROSE + "•" + RESET + " " + WHITE + BOLD + "Claude Code Terminal UI Parity" + RESET + ": Authentic pixel emblem, fieldset",
    "    header box, user prompt badge pills, and streaming responses.",
    "  " + ROSE + "•" + RESET + " " + WHITE + BOLD + "Autonomous Sub-Agents & Roles" + RESET + ": Multi-agent spawner with roles",
    "    (Pikaa, Heca, Bankli, Moli) and cryptographic action provenance.",
    "  " + ROSE + "•" + RESET + " " + WHITE + BOLD + "Model Context Protocol (MCP)" + RESET + ": Connect stdio & SSE servers with",
    "    multi-config auto-discovery, tool hot-reloads, and ping tests.",
    "  " + ROSE + "•" + RESET + " " + WHITE + BOLD + "Isolated Git Worktrees" + RESET + ": Run risky tasks in isolated worktree",
    "    branches without dirtying your main workspace (/worktrees).",
    "  " + ROSE + "•" + RESET + " " + WHITE + BOLD + "Strix-Inspired Security Auditor" + RESET + ": Automated scanner for exposed",
    "    secrets, eval(), and SQL injection vulnerabilities (/security).",
    "",
    "  " + BOLD + WHITE + "📦 Previous Highlights (v0.3.0 - v0.3.1)" + RESET,
    "  " + ROSE + "•" + RESET + " " + WHITE + "Unified CI/CD Pipeline" + RESET + ": Single automated release packager on merge.",
    "  " + ROSE + "•" + RESET + " " + WHITE + "Interactive Question Flow" + RESET + ": Selectable multiple-choice dialogs.",
    "  " + ROSE + "•" + RESET + " " + WHITE + "Persistent Memory Store" + RESET + ": Learned user preferences in markdown.",
    "",
    "  " + GRAY + "Tip: Type " + ROSE + "/help" + GRAY + " to view all available commands." + RESET,
  ];

  const topDashes = Math.max(2, totalInnerWidth - (15 + version.length + 14));

  console.log("");
  console.log("  " + ROSE + "┌─ " + ROSE + BOLD + "Groupy Code Release Notes" + RESET + " " + GRAY + version + RESET + " " + ROSE + "─".repeat(topDashes) + "┐" + RESET);
  for (const line of contentLines) {
    console.log("  " + ROSE + "│" + RESET + padLine(line, totalInnerWidth) + ROSE + "│" + RESET);
  }
  console.log("  " + ROSE + "└" + "─".repeat(totalInnerWidth) + "┘" + RESET);
  console.log("");
}

export async function handleModeCommand(ctx: CommandContext, arg?: string): Promise<void> {
  const validModes: Array<{ mode: "auto" | "manual" | "accept-edits" | "plan"; title: string; desc: string; glyph: string; color: string }> = [
    {
      mode: "auto",
      title: "Auto Mode",
      desc: "Tools run automatically without confirmation (fastest autonomous workflow)",
      glyph: "⏵⏵",
      color: "\x1b[38;2;255;215;0m",
    },
    {
      mode: "manual",
      title: "Manual Mode",
      desc: "Every file edit and shell command asks for user confirmation",
      glyph: "⏸",
      color: "\x1b[38;2;148;148;148m",
    },
    {
      mode: "accept-edits",
      title: "Accept Edits Mode",
      desc: "File edits are auto-approved, but shell commands require approval",
      glyph: "⏵⏵",
      color: "\x1b[38;2;175;175;215m",
    },
    {
      mode: "plan",
      title: "Plan Mode",
      desc: "Read-only mode. Blocks all mutations and focuses strictly on planning",
      glyph: "⏸",
      color: "\x1b[38;2;95;175;175m",
    },
  ];

  const currentMode = ctx.session.permissionMode;

  if (arg) {
    const normalized = arg.trim().toLowerCase();
    const match = validModes.find((m) => m.mode === normalized || m.mode.replace("-", "") === normalized);
    if (match) {
      ctx.session.setPermissionMode(match.mode);
      console.log(`\n  ${match.color}${match.glyph} Switched to ${match.title}\x1b[0m\n  ${style.dim(match.desc)}\n`);
      return;
    }
  }

  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    console.log(`\n  Current Permission Mode: ${style.bold(currentMode)}`);
    for (const m of validModes) {
      const active = m.mode === currentMode ? " (active)" : "";
      console.log(`  • ${m.title}${active}: ${m.desc}`);
    }
    console.log();
    return;
  }

  const items = validModes.map((m) => ({
    id: m.mode,
    label: `${m.glyph} ${m.title}`,
    badge: m.mode === currentMode ? "ACTIVE" : undefined,
    description: m.desc,
    checked: m.mode === currentMode,
  }));

  const res = await promptInteractiveList({
    title: "🎛️ Select Execution Permission Mode (Shift+Tab in prompt to cycle)",
    items,
    mode: "select",
    customKeyHints: "↑/↓: navigate · Enter: switch mode · Esc: cancel",
  });

  if (res.action === "select" && res.selectedItem) {
    const chosen = validModes.find((m) => m.mode === res.selectedItem?.id);
    if (chosen) {
      ctx.session.setPermissionMode(chosen.mode);
      console.log(`\n  ${chosen.color}${chosen.glyph} Switched to ${chosen.title}\x1b[0m\n  ${style.dim(chosen.desc)}\n`);
    }
  }
}



