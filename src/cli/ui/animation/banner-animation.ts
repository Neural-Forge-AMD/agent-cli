/**
 * Animated Banner & Emblem Transition Engine.
 * Provides smooth, high-impact terminal startup animation for Groupy/Pikaa CLI.
 */

import { c, style } from "../colors";
import { shimmerText } from "../shimmer";
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

const LOGO_FRAMES = [
  // Frame 1: Core ignition point
  [
    `                        `,
    `                        `,
    `           ▄▄           `,
    `          ████          `,
    `           ▀▀           `,
    `                        `,
    `                        `,
  ],
  // Frame 2: Expanding ring
  [
    `                        `,
    `       ▄▄████▄▄         `,
    `     ▄██▀    ▀██▄       `,
    `     ███  ██  ███       `,
    `     ▀██▄    ▄██▀       `,
    `       ▀▀████▀▀         `,
    `                        `,
  ],
  // Frame 3: Outer shield forming
  [
    `     ▄███▀▀  ▀▀███▄     `,
    `   ▄██▀          ▀██▄   `,
    `  ███   ▄████▄   ███    `,
    `  ███  ██▌  ▐██  ███    `,
    `  ███   ▀████▀   ███    `,
    `   ▀██▄          ▄██▀   `,
    `     ▀███▄▄  ▄▄███▀     `,
  ],
  // Frame 4: Final complete terracotta emblem
  [
    `       ▄▄████████▄▄     `,
    `    ▄███▀▀      ▀▀███▄  `,
    `  ▄██▀              ▀██▄`,
    ` ███    ▄▄████▄▄      ███`,
    `███   ▄██▀    ▀██▄     ▀▀`,
    `███   ██▌  ██  ▐██████████████▄`,
    `███   ██▌  ██  ▐██    ██  ██ ▀`,
    `███   ▀██▄    ▄██▀     ▄▄`,
    ` ███    ▀▀████▀▀      ███`,
    `  ▀██▄              ▄██▀`,
    `    ▀███▄▄      ▄▄███▀  `,
    `       ▀▀████████▀▀     `,
  ],
];

export class BannerAnimator {
  /**
   * Plays a smooth in-place animated reveal of the emblem, then renders the full banner.
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

    const b = c.brandBold;
    const r = c.reset;

    // Fast reveal frames (50ms per step)
    for (let f = 0; f < LOGO_FRAMES.length - 1; f++) {
      const frameLines = LOGO_FRAMES[f]!;
      process.stdout.write("\x1b[H\x1b[2J"); // clear screen
      console.log("\n");
      for (const line of frameLines) {
        console.log(`  ${b}${line}${r}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 55));
    }

    // Final render
    process.stdout.write("\x1b[H\x1b[2J");
    this.renderStatic(info, { withShimmerSweep: true });
  }

  /**
   * Renders the complete, beautiful static Groupy / Pikaa emblem banner.
   */
  static renderStatic(info: BannerInfo, options: { withShimmerSweep?: boolean } = {}): void {
    const b = c.brandBold;
    const r = c.reset;
    const g = c.dim;
    const t = c.bold;

    const userDisplay = info.user ? style.cyan(info.user) : style.dim("Guest");
    const roleBadge = info.role && info.role !== "default" ? ` [${style.yellow(info.role)}]` : "";
    const version = info.version || getCliVersion({ prefix: true });
    const versionBadge = ` ${style.dim(version)}`;

    const titleText = options.withShimmerSweep
      ? `${shimmerText("PIKAA AGENT", { sweepSeconds: 1.5 })}${versionBadge}`
      : `${t}PIKAA AGENT${r}${versionBadge}`;

    console.log();
    console.log(`  ${b}       ▄▄████████▄▄${r}`);
    console.log(`  ${b}    ▄███▀▀      ▀▀███▄${r}`);
    console.log(`  ${b}  ▄██▀              ▀██▄${r}           ${titleText}${roleBadge}`);
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
}
