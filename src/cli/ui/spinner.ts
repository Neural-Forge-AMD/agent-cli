/**
 * Live Terminal Spinner with smooth multi-variant animations & sine-wave shimmer.
 * Directly mirrors codex-rs/tui/src/status_indicator_widget.rs & motion.rs.
 */

import { c, style } from "./colors";
import { shimmerText } from "./shimmer";

export type SpinnerVariant =
  | "braille"
  | "rotating_blocks"
  | "orbit_dots"
  | "pulse_globe"
  | "sine_dots"
  | "triangles"
  | "block_pulse"
  | "claude_sparkle";

export interface SpinnerConfig {
  frames: string[];
  intervalMs: number;
}

export const SPINNER_VARIANTS: Record<SpinnerVariant, SpinnerConfig> = {
  braille: {
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    intervalMs: 80,
  },
  claude_sparkle: {
    frames: ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"],
    intervalMs: 110,
  },
  rotating_blocks: {
    frames: ["▖", "▘", "▝", "▗"],
    intervalMs: 100,
  },
  orbit_dots: {
    frames: ["⠋", "⠓", "⠚", "⠖", "⠦", "⠴", "⠲", "⠪", "⠡", "⠙"],
    intervalMs: 70,
  },
  pulse_globe: {
    frames: ["◐", "◓", "◑", "◒"],
    intervalMs: 120,
  },
  sine_dots: {
    frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
    intervalMs: 80,
  },
  triangles: {
    frames: ["◢", "◣", "◤", "◥"],
    intervalMs: 90,
  },
  block_pulse: {
    frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "▊", "▋", "▌", "▍", "▎"],
    intervalMs: 70,
  },
};

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) {
    const sec = (ms / 1000).toFixed(1);
    return `${sec}s`;
  }
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m ${seconds}s`;
}

export interface LiveSpinnerOptions {
  variant?: SpinnerVariant;
  enableShimmer?: boolean;
  colorFn?: (frame: string) => string;
}

export class LiveSpinner {
  private variant: SpinnerVariant = "claude_sparkle";
  private frames: string[] = SPINNER_VARIANTS.claude_sparkle.frames;
  private intervalMs: number = SPINNER_VARIANTS.claude_sparkle.intervalMs;
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentMessage = "";
  private isSpinning = false;
  private startTime = 0;
  private enableShimmer: boolean = true;
  private colorFn: (frame: string) => string = (f) => `\x1b[38;2;205;105;74m${f}\x1b[0m`;

  constructor(options: LiveSpinnerOptions = {}) {
    if (options.variant && SPINNER_VARIANTS[options.variant]) {
      this.setVariant(options.variant);
    }
    if (options.enableShimmer !== undefined) {
      this.enableShimmer = options.enableShimmer;
    }
    if (options.colorFn) {
      this.colorFn = options.colorFn;
    }
  }

  public setVariant(variant: SpinnerVariant): void {
    const config = SPINNER_VARIANTS[variant] || SPINNER_VARIANTS.braille;
    this.variant = variant;
    this.frames = config.frames;
    this.intervalMs = config.intervalMs;
    this.frameIndex = 0;

    if (this.isSpinning) {
      this.restartTimer();
    }
  }

  public getVariant(): SpinnerVariant {
    return this.variant;
  }

  public setShimmer(enabled: boolean): void {
    this.enableShimmer = enabled;
  }

  start(message = "Thinking...", customStartTime?: number): void {
    if (this.isSpinning) {
      if (customStartTime !== undefined) {
        this.startTime = customStartTime;
      }
      this.update(message);
      return;
    }

    this.isSpinning = true;
    this.currentMessage = message;
    this.startTime = customStartTime !== undefined ? customStartTime : performance.now();
    this.frameIndex = 0;

    // Render immediately
    this.render();
    this.restartTimer();
  }

  setStartTime(timeMs: number): void {
    this.startTime = timeMs;
  }

  private restartTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, this.intervalMs);
  }

  update(message: string): void {
    this.currentMessage = message;
    if (this.isSpinning) {
      this.render();
    }
  }

  setText(message: string): void {
    this.update(message);
  }

  private render(): void {
    const frame = this.frames[this.frameIndex] || "⠋";
    const elapsedMs = performance.now() - this.startTime;
    const elapsedStr = formatDuration(elapsedMs);
    const timeBadge = style.dim(`(${elapsedStr})`);

    const animatedMsg = this.enableShimmer
      ? shimmerText(this.currentMessage, { sweepSeconds: 2.5 })
      : `${c.dim}${this.currentMessage}${c.reset}`;

    const output = `\r\x1b[K  ${this.colorFn(frame)} ${animatedMsg} ${timeBadge}`;
    process.stdout.write(output);
  }

  stop(finalMessage?: string, success = true): void {
    if (!this.isSpinning) return;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isSpinning = false;

    // Clear the current line
    process.stdout.write("\r\x1b[K");

    if (finalMessage) {
      const icon = success ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
      console.log(`${icon} ${finalMessage}`);
    }
  }

  clear(): void {
    if (this.isSpinning) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.isSpinning = false;
      process.stdout.write("\r\x1b[K");
    }
  }

  isActive(): boolean {
    return this.isSpinning;
  }
}

/**
 * ClaudeThinkingSpinner — Claude Code authentic "working" line implementation for terminal.
 * Features: Pulsing sparkle glyph, rotating whimsical verbs, terracotta shimmer wave, elapsed time & interrupt hint.
 */
export class ClaudeThinkingSpinner {
  private frames = SPINNER_VARIANTS.claude_sparkle.frames;
  private frameIndex = 0;
  private verbs = ["Thinking", "Levitating", "Schlepping", "Herding", "Percolating", "Noodling", "Conjuring"];
  private verbIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isSpinning = false;
  private startTime = 0;
  private lastVerbChange = 0;

  start(customStartTime?: number): void {
    if (this.isSpinning) return;
    this.isSpinning = true;
    this.startTime = customStartTime !== undefined ? customStartTime : performance.now();
    this.lastVerbChange = performance.now();
    this.frameIndex = 0;
    this.verbIndex = 0;

    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      if (performance.now() - this.lastVerbChange > 5200) {
        this.verbIndex = (this.verbIndex + 1) % this.verbs.length;
        this.lastVerbChange = performance.now();
      }
      this.render();
    }, 110);
  }

  private render(): void {
    const frame = this.frames[this.frameIndex] || "✳";
    const verb = this.verbs[this.verbIndex % this.verbs.length] || "Thinking";
    const elapsedSec = ((performance.now() - this.startTime) / 1000).toFixed(1);

    // Terracotta colors
    const terracotta = "\x1b[38;2;205;105;74m";
    const dim = "\x1b[38;2;125;125;125m";
    const reset = "\x1b[0m";

    // Verb with subtle terracotta shimmer wave
    const shimmerVerb = shimmerText(`${verb}…`, {
      sweepSeconds: 2.8,
      baseRgb: [205, 105, 74],
      highlightRgb: [231, 148, 117],
    });

    const output = `\r\x1b[K  ${terracotta}${frame}${reset} ${shimmerVerb}${reset} ${dim}(${elapsedSec}s · esc to interrupt)${reset}`;
    process.stdout.write(output);
  }

  stop(finalMessage?: string, success = true): void {
    if (!this.isSpinning) return;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isSpinning = false;
    process.stdout.write("\r\x1b[K");

    if (finalMessage) {
      const icon = success ? `\x1b[32m✓\x1b[0m` : `\x1b[31m✗\x1b[0m`;
      console.log(`  ${icon} ${finalMessage}`);
    }
  }

  clear(): void {
    if (this.isSpinning) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.isSpinning = false;
      process.stdout.write("\r\x1b[K");
    }
  }

  isActive(): boolean {
    return this.isSpinning;
  }
}

