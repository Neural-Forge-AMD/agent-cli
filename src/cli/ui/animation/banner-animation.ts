/**
 * Authentic Claude Code Welcome Box & Header (brainless.swerdlow.dev style)
 * Implements Claude Code's signature fieldset box, pixel sprite logo, identity & tips columns.
 */

import { getCliVersion } from "../../version";
import { homedir } from "node:os";

export interface BannerInfo {
  model: string;
  cwd: string;
  user?: string;
  role?: string;
  version?: string;
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
const BLUE_ACCENT = "\x1b[38;2;192;202;245m";
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

export class BannerAnimator {
  static async play(
    info: BannerInfo,
    options: BannerAnimationOptions = {}
  ): Promise<void> {
    this.renderStatic(info);
  }

  static renderStatic(info: BannerInfo): void {
    const version = info.version || getCliVersion({ prefix: true });
    const user = info.user || process.env.USER || process.env.USERNAME || "Developer";
    const shortCwd = shortenPath(info.cwd);
    const modelName = info.model.includes("/") ? info.model.split("/").pop() || info.model : info.model;
    const modelLine = `${modelName} · Groupy Max`;
    const orgLine = `${user.toLowerCase()}'s Organization`;

    const cols = typeof process.stdout?.columns === "number" ? process.stdout.columns : 80;
    const totalWidth = Math.min(84, Math.max(64, cols - 4));

    if (totalWidth >= 70) {
      this.renderTwoColumn(totalWidth, version, user, modelLine, orgLine, shortCwd);
    } else {
      this.renderSingleColumn(totalWidth, version, user, modelLine, orgLine, shortCwd);
    }
  }

  private static renderTwoColumn(
    width: number,
    version: string,
    user: string,
    modelLine: string,
    orgLine: string,
    cwd: string
  ): void {
    const leftWidth = 32;
    const rightWidth = width - leftWidth - 5; // 5 chars for "  │  "

    // Claude Pixel Sprite lines
    const sprite = [
      `     ${ROSE}▗▄▄▄▄▄▄▄▄▄▄▄▄▖${RESET}`,
      `     ${ROSE}▐█ █ █ █ █ █ █${RESET}`,
      `     ${ROSE}▐████████████▌${RESET}`,
      `      ${ROSE}▝█ █    █ █▘${RESET}`,
    ];

    const leftLines = [
      `  ${BOLD}${WHITE}Welcome back ${user}!${RESET}`,
      sprite[0]!,
      sprite[1]!,
      sprite[2]!,
      sprite[3]!,
      `  ${GRAY}${this.truncate(modelLine, leftWidth - 2)}${RESET}`,
      `  ${GRAY}${this.truncate(orgLine, leftWidth - 2)}${RESET}`,
      `  ${GRAY}${this.truncate(cwd, leftWidth - 2)}${RESET}`,
    ];

    const rightLines = [
      `${BOLD}${ROSE}Tips for getting started${RESET}`,
      `${WHITE}Ask Groupy to create a new app or clone a repo${RESET}`,
      `${ROSE}${"─".repeat(rightWidth)}${RESET}`,
      `${BOLD}${ROSE}What's new${RESET}`,
      `${WHITE}Added Claude Code terminal UI parity${RESET}`,
      `${WHITE}Added multi-agent sub-agents & MCP servers${RESET}`,
      `${ITALIC}${GRAY}/release-notes for more${RESET}`,
      ``,
    ];

    const maxRows = Math.max(leftLines.length, rightLines.length);

    // Title border
    const titleText = ` Groupy Code ${version} `;
    const titleLen = 13 + version.length;
    const topDashes = Math.max(2, width - titleLen - 4);
    
    console.log();
    console.log(`  ${ROSE}┌─ ${ROSE}${BOLD}Groupy Code${RESET} ${GRAY}${version}${RESET} ${ROSE}${"─".repeat(topDashes)}┐${RESET}`);

    for (let i = 0; i < maxRows; i++) {
      const left = leftLines[i] || "";
      const right = rightLines[i] || "";

      const leftVis = this.stripAnsi(left);
      const rightVis = this.stripAnsi(right);

      const leftPad = Math.max(0, leftWidth - leftVis.length);
      const rightPad = Math.max(0, rightWidth - rightVis.length);

      console.log(
        `  ${ROSE}│${RESET} ${left}${" ".repeat(leftPad)} ${ROSE_DIM}│${RESET} ${right}${" ".repeat(rightPad)} ${ROSE}│${RESET}`
      );
    }

    console.log(`  ${ROSE}└${"─".repeat(width)}┘${RESET}`);
    console.log();
  }

  private static renderSingleColumn(
    width: number,
    version: string,
    user: string,
    modelLine: string,
    orgLine: string,
    cwd: string
  ): void {
    const innerWidth = width - 4;
    const titleLen = 13 + version.length;
    const topDashes = Math.max(2, width - titleLen - 4);

    console.log();
    console.log(`  ${ROSE}┌─ ${ROSE}${BOLD}Groupy Code${RESET} ${GRAY}${version}${RESET} ${ROSE}${"─".repeat(topDashes)}┐${RESET}`);

    const lines = [
      `  ${BOLD}${WHITE}Welcome back ${user}!${RESET}`,
      `  ${ROSE}▗▄▄▄▄▄▄▄▄▄▄▄▄▖${RESET}`,
      `  ${ROSE}▐████████████▌${RESET}`,
      `  ${GRAY}${modelLine}${RESET}`,
      `  ${GRAY}${cwd}${RESET}`,
      `  ${ROSE}${"─".repeat(innerWidth)}${RESET}`,
      `  ${BOLD}${ROSE}Tips:${RESET} ${WHITE}Ask Groupy to create a new app or inspect code${RESET}`,
    ];

    for (const line of lines) {
      const vis = this.stripAnsi(line);
      const pad = Math.max(0, innerWidth - vis.length);
      console.log(`  ${ROSE}│${RESET}${line}${" ".repeat(pad)}${ROSE}│${RESET}`);
    }

    console.log(`  ${ROSE}└${"─".repeat(width)}┘${RESET}`);
    console.log();
  }

  private static stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, "");
  }

  private static truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 1) + "…";
  }
}
