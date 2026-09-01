/**
 * Authentic Claude Code Welcome Box & Header (brainless.swerdlow.dev style)
 * Implements Claude Code's signature fieldset box, pixel sprite logo, identity & tips columns.
 */

import { getCliVersion } from "../../version";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { CredentialsStore } from "../../../auth/store";

export interface BannerInfo {
  model: string;
  cwd: string;
  user?: string;
  role?: string;
  version?: string;
  plan?: string;
  branch?: string;
}

export interface BannerAnimationOptions {
  animate?: boolean;
  durationMs?: number;
  onFinish?: () => void;
}

const ROSE = "\x1b[38;2;205;105;74m";
const ROSE_DIM = "\x1b[38;2;120;60;45m";
const WHITE = "\x1b[38;2;255;255;255m";
const GRAY = "\x1b[38;2;148;148;148m";
const BOLD = "\x1b[1m";
const ITALIC = "\x1b[3m";
const RESET = "\x1b[0m";

function shortenPath(cwd: string): string {
  const home = homedir();
  if (cwd.startsWith(home)) {
    return `~${cwd.slice(home.length).replace(/\\/g, "/")}`;
  }
  return cwd.replace(/\\/g, "/");
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function center(str: string, width: number): string {
  const vis = stripAnsi(str);
  if (vis.length >= width) return truncate(str, width);
  const padLeft = Math.floor((width - vis.length) / 2);
  const padRight = width - vis.length - padLeft;
  return " ".repeat(padLeft) + str + " ".repeat(padRight);
}

function padRight(str: string, width: number): string {
  const vis = stripAnsi(str);
  if (vis.length > width) return truncate(str, width);
  return str + " ".repeat(Math.max(0, width - vis.length));
}

function truncate(str: string, maxLen: number): string {
  const vis = stripAnsi(str);
  if (vis.length <= maxLen) return str;
  return vis.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function getGitBranch(cwd: string): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export class BannerAnimator {
  static async play(
    info: BannerInfo,
    options: BannerAnimationOptions = {}
  ): Promise<void> {
    this.renderStatic(info);
  }

  static renderStatic(info: BannerInfo): void {
    const version = info.version || getCliVersion({ prefix: true });
    // Clean user name from dashboard auth (or fallback to OS user)
    const storedUser = new CredentialsStore().getUser();
    let rawUser = info.user || "";
    if (!rawUser || rawUser.toLowerCase() === "authenticated" || rawUser.toLowerCase() === "default") {
      rawUser = storedUser?.username || (storedUser?.email ? storedUser.email.split("@")[0] : undefined) || process.env.GROUPY_USER || process.env.USER || process.env.USERNAME || "Developer";
    }
    const user = rawUser.charAt(0).toUpperCase() + rawUser.slice(1);

    const shortCwd = shortenPath(info.cwd);
    const modelName = info.model.includes("/") ? info.model.split("/").pop() || info.model : info.model;
    
    // Dynamic Subscription Plan / Tier from dashboard (Free, Pro, Max, Team, Enterprise)
    const rawPlan = info.plan || storedUser?.plan || process.env.GROUPY_PLAN || process.env.GROUPY_TIER || process.env.PIKAA_PLAN || process.env.PIKAA_TIER || "Pro";
    const planFormatted = rawPlan.charAt(0).toUpperCase() + rawPlan.slice(1).toLowerCase();
    const modelLine = `${modelName} · Groupy ${planFormatted}`;

    // Active Git Branch
    const branchName = info.branch || getGitBranch(info.cwd) || "main";
    const branchLine = ` ${branchName}`;

    const cols = typeof process.stdout?.columns === "number" ? process.stdout.columns : 80;
    const totalInnerWidth = Math.min(80, Math.max(68, cols - 6));

    if (totalInnerWidth >= 70) {
      this.renderTwoColumn(totalInnerWidth, version, user, modelLine, branchLine, shortCwd);
    } else {
      this.renderSingleColumn(totalInnerWidth, version, user, modelLine, branchLine, shortCwd);
    }
  }

  private static renderTwoColumn(
    totalInnerWidth: number,
    version: string,
    user: string,
    modelLine: string,
    branchLine: string,
    cwd: string
  ): void {
    const leftWidth = 30;
    // Layout: '  │' + left(30) + ' │ ' + rightContentWidth + ' │'
    // Inner width = leftWidth(30) + 3 (' │ ') + rightContentWidth + 1 (' ') = leftWidth + 4 + rightContentWidth
    const rightContentWidth = totalInnerWidth - leftWidth - 4;

    // Key (Kunci) Pixel Art Emblem
    const sprite = [
      `${ROSE} ▗▄▄▄▄▖        ${RESET}`,
      `${ROSE}▐█ ▄▄ █▌▄▄▄▄▄▄▄${RESET}`,
      `${ROSE}▐█ ▀▀ █▌ █  █ █${RESET}`,
      `${ROSE} ▝▀▀▀▀▘  ▀  ▀ ▀${RESET}`,
    ];

    const leftLines = [
      center(`${BOLD}${WHITE}Welcome back ${user}!${RESET}`, leftWidth),
      center(sprite[0]!, leftWidth),
      center(sprite[1]!, leftWidth),
      center(sprite[2]!, leftWidth),
      center(sprite[3]!, leftWidth),
      center(`${GRAY}${truncate(modelLine, leftWidth)}${RESET}`, leftWidth),
      center(`${GRAY}${truncate(branchLine, leftWidth)}${RESET}`, leftWidth),
      center(`${GRAY}${truncate(cwd, leftWidth)}${RESET}`, leftWidth),
    ];

    const rightLines = [
      `${BOLD}${ROSE}Tips for getting started${RESET}`,
      `${WHITE}${truncate("Ask Groupy to create a new app or clone a repo", rightContentWidth)}${RESET}`,
      `${ROSE}${"─".repeat(rightContentWidth)}${RESET}`,
      `${BOLD}${ROSE}What's new in ${version}${RESET}`,
      `${WHITE}${truncate("Persistent default AI model (/model)", rightContentWidth)}${RESET}`,
      `${WHITE}${truncate("Isolated Git worktree task runner (/worktrees)", rightContentWidth)}${RESET}`,
      `${ITALIC}${GRAY}Type /release-notes for full changelog${RESET}`,
      ``,
    ];

    const maxRows = Math.max(leftLines.length, rightLines.length);

    // Title: ┌─ Groupy Code v0.3.2 ─────────────┐
    // '┌─ Groupy Code ' (14) + version + ' ' (1) = 15 + version.length
    const topDashes = Math.max(2, totalInnerWidth - (15 + version.length));

    console.log();
    console.log(`  ${ROSE}┌─ ${ROSE}${BOLD}Groupy Code${RESET} ${GRAY}${version}${RESET} ${ROSE}${"─".repeat(topDashes)}┐${RESET}`);

    for (let i = 0; i < maxRows; i++) {
      const left = leftLines[i] || " ".repeat(leftWidth);
      const right = rightLines[i] || "";
      const rightFormatted = padRight(right, rightContentWidth);

      console.log(
        `  ${ROSE}│${RESET}${left} ${ROSE_DIM}│${RESET} ${rightFormatted} ${ROSE}│${RESET}`
      );
    }

    console.log(`  ${ROSE}└${"─".repeat(totalInnerWidth)}┘${RESET}`);
    console.log();
  }

  private static renderSingleColumn(
    totalInnerWidth: number,
    version: string,
    user: string,
    modelLine: string,
    branchLine: string,
    cwd: string
  ): void {
    const topDashes = Math.max(2, totalInnerWidth - (15 + version.length));

    console.log();
    console.log(`  ${ROSE}┌─ ${ROSE}${BOLD}Groupy Code${RESET} ${GRAY}${version}${RESET} ${ROSE}${"─".repeat(topDashes)}┐${RESET}`);

    const lines = [
      center(`${BOLD}${WHITE}Welcome back ${user}!${RESET}`, totalInnerWidth),
      center(`${ROSE} ▗▄▄▄▄▖        ${RESET}`, totalInnerWidth),
      center(`${ROSE}▐█ ▄▄ █▌▄▄▄▄▄▄▄${RESET}`, totalInnerWidth),
      center(`${ROSE}▐█ ▀▀ █▌ █  █ █${RESET}`, totalInnerWidth),
      center(`${ROSE} ▝▀▀▀▀▘  ▀  ▀ ▀${RESET}`, totalInnerWidth),
      center(`${GRAY}${modelLine}${RESET}`, totalInnerWidth),
      center(`${GRAY}${branchLine} · ${cwd}${RESET}`, totalInnerWidth),
      `${ROSE}${"─".repeat(totalInnerWidth)}${RESET}`,
      ` ${BOLD}${ROSE}Tips:${RESET} ${WHITE}${truncate("Ask Groupy to create a new app or inspect code", totalInnerWidth - 8)}${RESET}`,
    ];

    for (const line of lines) {
      console.log(`  ${ROSE}│${RESET}${padRight(line, totalInnerWidth)}${ROSE}│${RESET}`);
    }

    console.log(`  ${ROSE}└${"─".repeat(totalInnerWidth)}┘${RESET}`);
    console.log();
  }
}
