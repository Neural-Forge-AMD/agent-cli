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
      return `${style.dim(k)}=${style.cyan(valStr)}`;
    })
    .join(" ");

  console.log(`  ${style.brand("⠋")} ${style.bold(`[${step}]`)} ${style.cyan(toolName)} ${argsSummary}`);
}

export function formatTaskStepFinish(
  step: number,
  toolName: string,
  args: Record<string, unknown>,
  output?: string,
  isError = false
): void {
  const icon = isError ? style.red("✗") : style.green("✔");
  const toolNameDisplay = style.bold(toolName);

  if (toolName === "apply_patch" && typeof args.targetContent === "string" && typeof args.replacementContent === "string") {
    const targetFile = args.path ? String(args.path) : undefined;
    console.log(`  ${icon} ${style.dim(`[${step}]`)} ${toolNameDisplay} ${style.dim(targetFile || "")}`);
    CliFormatter.formatPatchDiff(targetFile, args.targetContent, args.replacementContent);
    return;
  }

  let summary = "";
  if (output) {
    const trimmed = output.trim();
    const lines = trimmed.split("\n");
    if (lines.length === 1 && lines[0]!.length <= 60) {
      summary = ` ${style.dim("↳")} ${style.dim(lines[0]!)}`;
    } else if (toolName === "read_file" || toolName === "read_file_range") {
      summary = ` ${style.dim(`↳ (${lines.length} lines read)`)}`;
    } else if (toolName === "grep_search" || toolName === "find_files") {
      summary = ` ${style.dim(`↳ (${lines.length} items found)`)}`;
    } else {
      summary = ` ${style.dim(`↳ (${lines.length} lines output)`)}`;
    }
  }

  console.log(`  ${icon} ${style.dim(`[${step}]`)} ${toolNameDisplay}${summary}`);
  if (isError && output) {
    const firstLine = output.trim().split("\n")[0] || output;
    console.log(`    ${style.red(firstLine.slice(0, 120))}`);
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
    const b = c.brandBold;
    const r = c.reset;
    const g = c.dim;
    const t = c.bold;

    const userDisplay = info.user ? style.cyan(info.user) : style.dim("Guest");
    const version = info.version || getCliVersion({ prefix: true });

    console.log();
    console.log(`  ${b}       ▄▄████████▄▄${r}`);
    console.log(`  ${b}    ▄███▀▀      ▀▀███▄${r}`);
    console.log(`  ${b}  ▄██▀              ▀██▄${r}           ${t}PIKAA AGENT${r} ${style.dim(version)}`);
    console.log(`  ${b} ███    ▄▄████▄▄      ███${r}          ${g}Autonomous Coding Engine${r}`);
    console.log(`  ${b}███   ▄██▀    ▀██▄     ▀▀${r}          ${style.dim("User:")}  ${userDisplay}`);
    console.log(`  ${b}███   ██▌  ██  ▐██████████████▄${r}    ${style.dim("Model:")} ${style.brand(info.model)}`);
    console.log(`  ${b}███   ██▌  ██  ▐██    ██  ██ ▀${r}     ${style.dim("Dir:")}   ${style.dim(info.cwd)}`);
    console.log(`  ${b}███   ▀██▄    ▄██▀     ▄▄${r}`);
    console.log(`  ${b} ███    ▀▀████▀▀      ███${r}`);
    console.log(`  ${b}  ▀██▄              ▄██▀${r}`);
    console.log(`  ${b}    ▀███▄▄      ▄▄███▀${r}`);
    console.log(`  ${b}       ▀▀████████▀▀${r}`);
    console.log();
    console.log(`  ${style.dim("Type /help for slash commands or /exit to quit.")}`);
    console.log();
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
        return `${style.dim(k)}=${style.cyan(valStr)}`;
      })
      .join(" ");

    console.log(`  ${style.brand("◆")} ${style.bold("tool:")} ${style.cyan(toolName)} ${argsSummary}`);
  }

  static formatPatchDiff(filePath: string | undefined, oldSrc: string, newSrc: string): void {
    const lines = parsePatch(oldSrc, newSrc);
    if (lines.length === 0) return;
    console.log(renderDiff(lines, { filePath }));
  }

  static formatToolOutput(output: string, isError = false): void {
    const prefix = isError ? style.red("  ✗ error:") : style.dim("  ↳ output:");
    const lines = output.trim().split("\n");
    const preview = lines.slice(0, 6).map((l) => `${style.dim("    ")}${l}`).join("\n");
    const more = lines.length > 6 ? `\n    ${style.dim(`... (${lines.length - 6} more lines)`)}` : "";

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
    const title = explanation ? ` Task Progress: ${explanation} ` : " Task Progress Plan ";
    const headerLine = `  ┌──${style.brand(title)}${"─".repeat(Math.max(0, 50 - title.length))}`;
    console.log(headerLine);

    for (let i = 0; i < plan.length; i++) {
      const item = plan[i];
      if (!item) continue;
      let icon = style.dim("[ ]");
      let text = style.dim(item.step);

      if (item.status === "completed") {
        icon = style.green("[✓]");
        text = style.bold(item.step);
      } else if (item.status === "in_progress") {
        icon = style.cyan("[⏳]");
        text = style.cyan(item.step);
      }

      console.log(`  │  ${icon} ${i + 1}. ${text}`);
    }

    console.log(`  └──${"─".repeat(50)}\n`);
  }
}
