import { c, style } from "./colors";
import { parsePatch, renderDiff } from "./diff";
import { formatDuration } from "./spinner";
import type { PlanItem } from "../../protocol/events";
import { BannerAnimator, type BannerInfo, type BannerAnimationOptions } from "./animation/banner-animation";
import { getCliVersion } from "../version";

export function renderGroupyBanner(info: BannerInfo, options?: BannerAnimationOptions): void {
  BannerAnimator.renderStatic(info);
}

export async function renderAnimatedGroupyBanner(info: BannerInfo, options?: BannerAnimationOptions): Promise<void> {
  await BannerAnimator.play(info, options);
}

export function formatTaskProgressPlan(plan: PlanItem[], explanation?: string): void {
  CliFormatter.formatTaskProgressPlan(plan, explanation);
}

export interface TurnSummaryMetrics {
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextTokens?: number;
  maxContextTokens?: number;
  sessionUptimeMs?: number;
  subAgents?: Array<{
    nickname: string;
    role: string;
    runningTimeMs: number;
    status: string;
  }>;
  toolCalls?: string[];
  filesModified?: string[];
}

export function formatTurnSummary(metrics: TurnSummaryMetrics): void {
  CliFormatter.formatTurnSummary(metrics);
}

export function formatTaskStepStart(step: number, toolName: string, args: Record<string, unknown>): void {
  const argsSummary = Object.entries(args)
    .map(([k, v]) => {
      const valStr = typeof v === "string" ? `"${v.length > 35 ? v.slice(0, 32) + "..." : v}"` : JSON.stringify(v);
      return `${style.dim(k)}=\x1b[38;2;170;175;190m${valStr}\x1b[0m`;
    })
    .join(" ");

  const dot = "\x1b[38;2;217;119;87m●\x1b[0m";
  console.log(`  ${dot} ${style.bold(toolName)} ${argsSummary ? `${style.dim("(")}${argsSummary}${style.dim(")")}` : ""}`);
}

export function formatTaskStepFinish(
  step: number,
  toolName: string,
  args: Record<string, unknown>,
  output?: string,
  isError = false
): void {
  const dot = isError ? "\x1b[38;2;247;118;142m●\x1b[0m" : "\x1b[38;2;78;169;111m●\x1b[0m";
  const toolNameDisplay = style.bold(toolName);

  if (toolName === "apply_patch" && typeof args.targetContent === "string" && typeof args.replacementContent === "string") {
    const targetFile = args.path ? String(args.path) : undefined;
    CliFormatter.formatPatchDiff(targetFile, args.targetContent, args.replacementContent);
    return;
  }

  let summary = "";
  if (output) {
    const trimmed = output.trim();
    const lines = trimmed.split("\n");
    if (lines.length === 1 && lines[0]!.length <= 60) {
      summary = lines[0]!;
    } else if (toolName === "read_file" || toolName === "read_file_range") {
      summary = `${lines.length} lines read`;
    } else if (toolName === "grep_search" || toolName === "find_files") {
      summary = `${lines.length} items found`;
    } else {
      summary = `${lines.length} lines output`;
    }
  }

  const argsSummary = Object.entries(args)
    .map(([k, v]) => {
      const valStr = typeof v === "string" ? `"${v.length > 35 ? v.slice(0, 32) + "..." : v}"` : JSON.stringify(v);
      return `${style.dim(k)}=\x1b[38;2;170;175;190m${valStr}\x1b[0m`;
    })
    .join(" ");

  console.log(`  ${dot} ${toolNameDisplay} ${argsSummary ? `${style.dim("(")}${argsSummary}${style.dim(")")}` : ""}`);
  if (summary) {
    console.log(`    \x1b[38;2;86;95;137m⎿\x1b[0m ${style.dim(summary)}`);
  }
  if (isError && output) {
    const firstLine = output.trim().split("\n")[0] || output;
    console.log(`      ${style.red(firstLine.slice(0, 120))}`);
  }
}

export function formatToolCard(toolName: string, args: Record<string, unknown>, output?: string, isError = false): void {
  CliFormatter.formatToolCall(toolName, args);
  if (toolName === "apply_patch" && typeof args.targetContent === "string" && typeof args.replacementContent === "string") {
    CliFormatter.formatPatchDiff(args.path as string | undefined, args.targetContent, args.replacementContent);
    return;
  }
  if (output !== undefined) {
    CliFormatter.formatToolOutput(output, isError);
  }
}

export class CliFormatter {
  static printBanner(info: { model: string; cwd: string; user?: string; role?: string; version?: string }): void {
    BannerAnimator.renderStatic(info);
  }

  static printUpdateNotice(update: { currentVersion: string; latestVersion: string; packageName?: string }): void {
    const pkg = update.packageName || "@pikaa-ai/pikaa";
    const cur = update.currentVersion.startsWith("v") ? update.currentVersion : `v${update.currentVersion}`;
    const lat = update.latestVersion.startsWith("v") ? update.latestVersion : `v${update.latestVersion}`;

    const innerWidth = 54;
    const padLine = (content: string) => {
      const visibleLen = style.stripAnsi(content).length;
      const padRight = Math.max(0, innerWidth - visibleLen);
      return `  ${style.yellow("│")}  ${content}${" ".repeat(padRight)}${style.yellow("│")}`;
    };

    const topBorder = `  ${style.yellow("╭")}${style.yellow("─".repeat(innerWidth + 2))}${style.yellow("╮")}`;
    const bottomBorder = `  ${style.yellow("╰")}${style.yellow("─".repeat(innerWidth + 2))}${style.yellow("╯")}`;

    console.log(topBorder);
    console.log(padLine(`Update available: ${style.dim(cur)} → ${style.green(style.bold(lat))}`));
    console.log(padLine(`${style.dim("Run to update:")}`));
    console.log(padLine(`  ${style.cyan(`bun add -g ${pkg}`)}`));
    console.log(padLine(`  ${style.dim("or:")} ${style.dim(`npm i -g ${pkg}`)}`));
    console.log(bottomBorder);
    console.log();
  }

  static printSecurityReport(report: {
    scannedFiles: number;
    findings: Array<{
      id: string;
      category: string;
      severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
      filePath: string;
      lineNumber: number;
      snippet: string;
      description: string;
      recommendation: string;
    }>;
    durationMs: number;
    summary: { critical: number; high: number; medium: number; low: number };
  }): void {
    console.log();
    console.log(`  ${style.brandBold("🛡️  Codebase Security & Vulnerability Assessment (Strix)")}`);
    console.log(`  ${style.dim(`Scanned ${report.scannedFiles} files in ${(report.durationMs).toFixed(1)}ms`)}`);
    console.log();

    if (report.findings.length === 0) {
      console.log(`  ${style.green("✓ No critical vulnerabilities or exposed secrets detected.")}\n`);
      return;
    }

    const { critical, high, medium, low } = report.summary;
    const stats: string[] = [];
    if (critical > 0) stats.push(style.red(`${critical} CRITICAL`));
    if (high > 0) stats.push(style.yellow(`${high} HIGH`));
    if (medium > 0) stats.push(style.cyan(`${medium} MEDIUM`));
    if (low > 0) stats.push(style.dim(`${low} LOW`));

    console.log(`  ${style.bold("Findings Summary:")} ${stats.join(style.dim(" · "))}`);
    console.log(`  ${style.dim("─".repeat(64))}`);

    for (let i = 0; i < report.findings.length; i++) {
      const f = report.findings[i]!;
      const sevColor = f.severity === "CRITICAL" ? style.red : f.severity === "HIGH" ? style.yellow : style.cyan;
      console.log(`\n  [${style.bold(String(i + 1))}] [${sevColor(f.severity)}] ${style.bold(f.category)}: ${f.description}`);
      console.log(`      ${style.dim("Location:")} ${style.cyan(f.filePath)}:${style.yellow(String(f.lineNumber))}`);
      console.log(`      ${style.dim("Snippet:")}  ${style.dim(f.snippet)}`);
      console.log(`      ${style.green("Remedy:")}   ${f.recommendation}`);
    }

    console.log(`\n  ${style.dim("─".repeat(64))}`);
    console.log(`  ${style.dim("To auto-fix these issues, run:")} ${style.cyan("@spawn security-auditor \"Fix all identified vulnerabilities\"")}\n`);
  }

  static formatToolCall(toolName: string, args: Record<string, unknown>): void {
    const argsSummary = Object.entries(args)
      .map(([k, v]) => {
        const valStr = typeof v === "string" ? `"${v.length > 40 ? v.slice(0, 37) + "..." : v}"` : JSON.stringify(v);
        return `${style.dim(k)}=\x1b[38;2;170;175;190m${valStr}\x1b[0m`;
      })
      .join(" ");

    const dot = "\x1b[38;2;78;169;111m●\x1b[0m";
    console.log(`  ${dot} ${style.bold(toolName)} ${argsSummary ? `${style.dim("(")}${argsSummary}${style.dim(")")}` : ""}`);
  }

  static formatPatchDiff(filePath: string | undefined, oldSrc: string, newSrc: string): void {
    const lines = parsePatch(oldSrc, newSrc);
    if (lines.length === 0) return;

    if (filePath) {
      const dot = "\x1b[38;2;78;169;111m●\x1b[0m";
      const arrow = "\x1b[38;2;86;95;137m⎿\x1b[0m";
      console.log(`  ${dot} ${style.bold("Update")} \x1b[38;2;140;140;150m(\x1b[38;2;220;220;230m${filePath}\x1b[38;2;140;140;150m)\x1b[0m`);
      console.log(`    ${arrow} ${style.dim("Applied patch diff hunks")}`);
    }

    console.log(renderDiff(lines, { filePath }));
  }

  static formatToolOutput(output: string, isError = false): void {
    const arrow = "\x1b[38;2;86;95;137m⎿\x1b[0m";
    const prefix = isError ? `    ${arrow} ${style.red("error:")}` : `    ${arrow}`;
    const lines = output.trim().split("\n");
    const preview = lines.slice(0, 6).map((l) => `      ${style.dim(l)}`).join("\n");
    const more = lines.length > 6 ? `\n      ${style.dim(`... (${lines.length - 6} more lines)`)}` : "";

    console.log(`${prefix}\n${preview}${more}`);
  }

  static formatTurnSummary(metrics: TurnSummaryMetrics): void {
    const formatTokens = (n: number): string => {
      if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
      if (n >= 1000) {
        const val = (n / 1000).toFixed(1);
        return val.endsWith(".0") ? `${val.slice(0, -2)}k` : `${val}k`;
      }
      return String(n);
    };

    const durationSec = (metrics.durationMs / 1000).toFixed(1);
    const parts: string[] = [`${c.bold}${durationSec}s${c.reset}`];

    // Explicit Input and Output tokens
    if (metrics.inputTokens !== undefined || metrics.outputTokens !== undefined) {
      const inStr = metrics.inputTokens !== undefined ? formatTokens(metrics.inputTokens) : "0";
      const outStr = metrics.outputTokens !== undefined ? formatTokens(metrics.outputTokens) : "0";
      parts.push(`${style.cyan(`${inStr} in`)} ${style.dim("/")} ${style.cyan(`${outStr} out`)}`);
    } else if (metrics.totalTokens !== undefined && metrics.totalTokens > 0) {
      parts.push(`${style.dim(`${formatTokens(metrics.totalTokens)} tokens`)}`);
    }

    // Context window percentage
    if (metrics.contextTokens !== undefined && metrics.maxContextTokens !== undefined && metrics.maxContextTokens > 0) {
      const pct = Math.round((metrics.contextTokens / metrics.maxContextTokens) * 100);
      const colorFn = pct < 50 ? style.green : pct < 80 ? style.yellow : style.red;
      const ctxLabel = colorFn(`${pct}% context`);
      parts.push(ctxLabel);
    }

    if (metrics.toolCalls && metrics.toolCalls.length > 0) {
      const count = metrics.toolCalls.length;
      const uniqueTools = Array.from(new Set(metrics.toolCalls));
      const toolLabel = count === 1 ? `1 tool (${uniqueTools.join(", ")})` : `${count} tools (${uniqueTools.join(", ")})`;
      parts.push(`${style.cyan(toolLabel)}`);
    }

    if (metrics.filesModified && metrics.filesModified.length > 0) {
      const count = metrics.filesModified.length;
      const fileLabel = count === 1 ? `1 file updated` : `${count} files updated`;
      parts.push(`${style.green(fileLabel)}`);
    }

    const dot = `${style.dim(" · ")}`;
    console.log(`\n  ${c.brandBold}✻${c.reset} ${style.dim("Completed in")} ${parts.join(dot)}`);

    const sessionParts: string[] = [];
    if (metrics.sessionUptimeMs !== undefined && metrics.sessionUptimeMs >= 1000) {
      sessionParts.push(`${style.dim("session:")} ${style.bold(formatDuration(metrics.sessionUptimeMs))}`);
    }

    if (metrics.subAgents && metrics.subAgents.length > 0) {
      const agentBadges = metrics.subAgents.map((a) => {
        const timeStr = formatDuration(a.runningTimeMs);
        const icon = a.status === "running" ? style.brand("●") : a.status === "completed" ? style.green("✔") : style.red("✗");
        return `${icon} ${style.cyan(a.nickname)} ${style.dim(`(${a.role}, ${timeStr})`)}`;
      });
      sessionParts.push(`${style.dim("sub-agents:")} [${agentBadges.join(", ")}]`);
    }

    if (sessionParts.length > 0) {
      console.log(`    ${style.dim("↳")} ${sessionParts.join(dot)}`);
    }
    console.log();
  }

  static formatMarkdownLine(chunk: string): string {
    // Highlight markdown bold **text**
    let formatted = chunk.replace(/\*\*(.*?)\*\*/g, `${c.bold}$1${c.reset}`);
    // Highlight inline code `text`
    formatted = formatted.replace(/`([^`]+)`/g, `${c.cyan}$1${c.reset}`);
    // Highlight markdown headings # Header
    formatted = formatted.replace(/^(#{1,3})\s+(.*)$/gm, `${c.bold}${c.brand}$1 $2${c.reset}`);
    return formatted;
  }

  static formatTaskProgressPlan(plan: PlanItem[], explanation?: string): void {
    console.log();
    if (explanation) {
      console.log(`  ${style.bold(explanation)}`);
    }

    const DONE = "\x1b[38;5;114m✔\x1b[0m";
    const ACTIVE = "\x1b[38;5;174m◼\x1b[0m";
    const PENDING = "\x1b[38;5;246m◻\x1b[0m";
    const DIM = "\x1b[38;5;246m";
    const RESET = "\x1b[0m";

    for (let i = 0; i < plan.length; i++) {
      const item = plan[i];
      if (!item) continue;

      const prefix = i === 0 ? "  ⎿ " : "    ";
      if (item.status === "completed") {
        console.log(`  ${DIM}${prefix}${RESET}${DONE} \x1b[9m\x1b[38;5;246m${item.step}\x1b[0m`);
      } else if (item.status === "in_progress") {
        console.log(`  ${DIM}${prefix}${RESET}${ACTIVE} \x1b[1m\x1b[38;5;174m${item.step}\x1b[0m`);
      } else {
        console.log(`  ${DIM}${prefix}${RESET}${PENDING} \x1b[38;5;246m${item.step}\x1b[0m`);
      }
    }
    console.log();
  }

  static printMcpServers(
    servers: Array<{
      name: string;
      connected: boolean;
      serverInfo?: { name?: string; version?: string };
      toolsCount: number;
      resourcesCount: number;
      promptsCount: number;
    }>,
    configFiles: string[] = []
  ): void {
    console.log();
    console.log(style.bold("  🔌 Model Context Protocol (MCP) Servers:"));
    if (configFiles.length > 0) {
      console.log(`  ${style.dim("Loaded configs:")} ${style.dim(configFiles.join(", "))}`);
    }
    console.log(`  ${style.dim("─".repeat(64))}`);

    if (servers.length === 0) {
      console.log(`  ${style.dim("No active MCP servers connected.")}`);
      console.log(`  ${style.dim("To add an MCP server, run:")} ${style.cyan("/mcp add <name> <command> [args...]")}`);
      console.log(`  ${style.dim("Example:")} ${style.cyan("/mcp add sqlite npx -y @modelcontextprotocol/server-sqlite /path/to/db.sqlite")}\n`);
      return;
    }

    for (const s of servers) {
      const statusIcon = s.connected ? style.green("● Online") : style.red("○ Disconnected");
      const info = s.serverInfo ? ` (${s.serverInfo.name || ""} v${s.serverInfo.version || "1.0"})` : "";
      console.log(`\n    • ${style.bold(s.name)}${style.dim(info)} — [${statusIcon}]`);
      console.log(
        `      ${style.dim("Capabilities:")} ${style.cyan(`${s.toolsCount} tools`)} ${style.dim("·")} ${style.cyan(`${s.resourcesCount} resources`)} ${style.dim("·")} ${style.cyan(`${s.promptsCount} prompts`)}`
      );
    }

    console.log(`\n  ${style.dim("─".repeat(64))}`);
    console.log(`  ${style.dim("Commands:")} ${style.cyan("/mcp tools [server]")} ${style.dim("·")} ${style.cyan("/mcp test <server>")} ${style.dim("·")} ${style.cyan("/mcp add <name> <cmd>")}\n`);
  }

  static printMcpTools(serverName: string, tools: Array<{ name: string; description?: string; inputSchema?: any }>): void {
    console.log();
    console.log(style.bold(`  🛠️  MCP Tools for [${style.cyan(serverName)}] (${tools.length} tools):`));
    console.log(`  ${style.dim("─".repeat(64))}`);

    if (tools.length === 0) {
      console.log(`  ${style.dim("No tools exposed by this server.")}\n`);
      return;
    }

    for (const t of tools) {
      console.log(`    • ${style.cyan(t.name)}: ${t.description || style.dim("No description")}`);
      const props = t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : [];
      const req = new Set(t.inputSchema?.required || []);
      if (props.length > 0) {
        const paramList = props.map((p) => (req.has(p) ? style.yellow(`${p}*`) : style.dim(p))).join(", ");
        console.log(`      ${style.dim("Params:")} ${paramList}`);
      }
    }
    console.log();
  }

  static printMcpResources(serverName: string, resources: Array<{ uri: string; name?: string; description?: string; mimeType?: string }>): void {
    console.log();
    console.log(style.bold(`  📦 MCP Resources for [${style.cyan(serverName)}] (${resources.length} resources):`));
    console.log(`  ${style.dim("─".repeat(64))}`);

    if (resources.length === 0) {
      console.log(`  ${style.dim("No resources exposed by this server.")}\n`);
      return;
    }

    for (const r of resources) {
      const label = r.name || r.description ? ` (${r.name || r.description})` : "";
      console.log(`    • ${style.cyan(r.uri)}${style.dim(label)} ${r.mimeType ? style.dim(`[${r.mimeType}]`) : ""}`);
    }
    console.log();
  }

  /**
   * Formats a Claude Code style user prompt row (❯ chip + dark solid background spanning full terminal width).
   */
  static formatClaudeUserPrompt(text: string): string {
    const cols = typeof process.stdout?.columns === "number" && process.stdout.columns > 0
      ? process.stdout.columns
      : 80;

    // Total width of the dark box spanning to right edge with 2 leading spaces indent
    const boxWidth = Math.max(20, cols - 2);
    const contentWidth = Math.max(10, boxWidth - 3); // 3 characters for ` > ` prefix

    const BG = "\x1b[48;2;43;43;45m";
    const CHEVRON = "\x1b[38;2;128;128;133m";
    const TEXT = "\x1b[38;2;240;240;242m";
    const RESET = "\x1b[0m";

    const rawLines = text.split("\n");
    const wrappedLines: string[] = [];

    for (const rawLine of rawLines) {
      if (rawLine.length === 0) {
        wrappedLines.push("");
        continue;
      }
      let current = rawLine;
      while (current.length > contentWidth) {
        let breakIdx = current.lastIndexOf(" ", contentWidth);
        if (breakIdx <= 0) {
          breakIdx = contentWidth;
        }
        wrappedLines.push(current.slice(0, breakIdx));
        current = current.slice(breakIdx).trimStart();
      }
      if (current.length > 0) {
        wrappedLines.push(current);
      }
    }

    const formatted = wrappedLines.map((line, idx) => {
      const prefix = idx === 0 ? `${CHEVRON} ❯ ` : `${CHEVRON}   `;
      const padLen = Math.max(0, contentWidth - line.length);
      return `  ${BG}${prefix}${TEXT}${line}${" ".repeat(padLen)}${RESET}`;
    });

    return formatted.join("\n");
  }

  /**
   * Formats a Claude Code style assistant message turn (monospace light-slate text).
   */
  static formatClaudeAssistantResponse(text: string): string {
    return `  \x1b[38;2;192;202;245m${text}\x1b[0m`;
  }

  /**
   * Formats conversation turns matching Claude Code / brainless specifications.
   */
  static formatClaudeMessage(role: "user" | "assistant", text: string): string {
    if (role === "user") {
      return CliFormatter.formatClaudeUserPrompt(text);
    }
    return CliFormatter.formatClaudeAssistantResponse(text);
  }
}
