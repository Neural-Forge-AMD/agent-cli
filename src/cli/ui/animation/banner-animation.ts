/**
 * Animated Banner & Emblem Transition Engine (Grok Style).
 * Provides responsive Grok Launch Card with perfect box border alignment for Groupy CLI.
 */

import { getCliVersion } from "../../version";

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

function getResponsiveWidth(): number {
  const cols = typeof process.stdout?.columns === "number" ? process.stdout.columns : 80;
  return Math.min(68, Math.max(48, cols - 6));
}

function formatBoxLine(
  content: string,
  innerWidth: number,
  border = "\x1b[38;2;47;47;51m",
  reset = "\x1b[0m"
): string {
  const visible = content.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, innerWidth - visible.length);
  return `  ${border}│${reset}${content}${" ".repeat(pad)}${border}│${reset}`;
}

function formatMenuLine(
  label: string,
  key = "",
  innerWidth: number,
  fg: string,
  keyDim: string,
  reset: string
): string {
  const left = `  ${fg}${label}${reset}`;
  const right = key ? `${keyDim}${key}${reset}  ` : "  ";
  const leftVis = `  ${label}`;
  const rightVis = key ? `${key}  ` : "  ";
  const spaceCount = Math.max(1, innerWidth - leftVis.length - rightVis.length);
  return `${left}${" ".repeat(spaceCount)}${right}`;
}

export class BannerAnimator {
  /**
   * Plays a smooth in-place animated reveal of the Grok card, then renders the full banner.
   */
  static async play(
    info: BannerInfo,
    options: BannerAnimationOptions = {}
  ): Promise<void> {
    const isTTY = Boolean(process.stdout.isTTY);
    const shouldAnimate = options.animate ?? (isTTY && process.env.NODE_ENV !== "test");

    if (!shouldAnimate) {
      this.renderStatic(info);
      return;
    }

    this.renderStatic(info);
  }

  /**
   * Renders the complete responsive Grok Launch Card banner.
   */
  static renderStatic(info: BannerInfo, options: { withShimmerSweep?: boolean } = {}): void {
    const version = info.version || getCliVersion({ prefix: true });
    const amber = "\x1b[38;2;224;175;104m";
    const fg = "\x1b[38;2;232;232;232m";
    const dim = "\x1b[38;2;122;122;122m";
    const gray = "\x1b[38;2;139;139;144m";
    const keyDim = "\x1b[38;2;106;106;106m";
    const border = "\x1b[38;2;47;47;51m";
    const reset = "\x1b[0m";

    const width = getResponsiveWidth();
    console.log();
    console.log(`  ${border}┌${"─".repeat(width)}┐${reset}`);
    console.log(formatBoxLine(`  ${fg}\x1b[1mGroupy Build Beta\x1b[0m ${dim}${version}${reset}`, width, border, reset));
    console.log(formatBoxLine(`  ${amber}\x1b[1mGroupy is here!\x1b[0m`, width, border, reset));
    console.log(formatBoxLine(`  ${gray}Autonomous agent engine with skills, tools & worktree${reset}`, width, border, reset));
    console.log(formatBoxLine(``, width, border, reset));
    console.log(formatBoxLine(formatMenuLine("New worktree", "ctrl+w", width, fg, keyDim, reset), width, border, reset));
    console.log(formatBoxLine(formatMenuLine("Resume session", "ctrl+s", width, fg, keyDim, reset), width, border, reset));
    console.log(formatBoxLine(formatMenuLine(`Model: ${info.model}`, "", width, fg, keyDim, reset), width, border, reset));
    console.log(formatBoxLine(formatMenuLine("Quit", "ctrl+q", width, fg, keyDim, reset), width, border, reset));
    console.log(`  ${border}└${"─".repeat(width)}┘${reset}`);
    console.log();
  }
}
