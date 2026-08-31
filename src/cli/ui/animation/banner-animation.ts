/**
 * Animated Banner & Emblem Transition Engine (Grok Style).
 * Provides crisp dot-matrix braille sweep and Grok Launch Card for Groupy CLI.
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

    // Quick clear and render
    this.renderStatic(info);
  }

  /**
   * Renders the complete Grok Launch Card banner.
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

    console.log();
    console.log(`  ${border}┌────────────────────────────────────────────────────────────┐${reset}`);
    console.log(`  ${border}│${reset}  ${fg}\x1b[1mGroupy Build Beta\x1b[0m ${dim}${version}${reset}${" ".repeat(Math.max(0, 39 - version.length))}${border}│${reset}`);
    console.log(`  ${border}│${reset}  ${amber}\x1b[1mGroupy is here!\x1b[0m                                           ${border}│${reset}`);
    console.log(`  ${border}│${reset}  ${gray}Autonomous agent engine with skills, tools & worktree      ${border}│${reset}`);
    console.log(`  ${border}│${reset}                                                            ${border}│${reset}`);
    console.log(`  ${border}│${reset}  ${fg}New worktree${reset}${" ".repeat(36)}${keyDim}ctrl+w${reset}  ${border}│${reset}`);
    console.log(`  ${border}│${reset}  ${fg}Resume session${reset}${" ".repeat(34)}${keyDim}ctrl+s${reset}  ${border}│${reset}`);
    console.log(`  ${border}│${reset}  ${fg}Model: ${info.model}${reset}${" ".repeat(Math.max(0, 50 - info.model.length))}${border}│${reset}`);
    console.log(`  ${border}│${reset}  ${fg}Quit${reset}${" ".repeat(44)}${keyDim}ctrl+q${reset}  ${border}│${reset}`);
    console.log(`  ${border}└────────────────────────────────────────────────────────────┘${reset}`);
    console.log();
  }
}
