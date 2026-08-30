/**
 * Drives 36-Frame ASCII Art Animations across the CLI, Onboarding, and Splash screens.
 * Directly mirrors codex-rs/tui/src/ascii_animation.rs.
 */

import { FramesLoader } from "./frames-loader";
import type { AnimationVariant, AsciiAnimationOptions } from "./types";
import { ALL_ANIMATION_VARIANTS, DEFAULT_FRAME_TICK_MS } from "./types";
import { c } from "../colors";

export class AsciiAnimation {
  private variant: AnimationVariant;
  private frameTickMs: number;
  private startTime: number;
  private currentFrameIndex: number = 0;
  private colorFn?: (frame: string) => string;

  constructor(options: AsciiAnimationOptions = {}) {
    this.variant = options.variant || "default";
    this.frameTickMs = options.frameTickMs ?? DEFAULT_FRAME_TICK_MS;
    this.startTime = Date.now();
    this.colorFn = options.colorFn;

    if (options.assetsDir) {
      FramesLoader.setAssetsDir(options.assetsDir);
    }
  }

  /**
   * Returns all frames for the currently active variant.
   */
  public getFrames(): string[] {
    return FramesLoader.getFrames(this.variant);
  }

  /**
   * Gets the active frame based on wall-clock elapsed time since start.
   * Time-synchronized just like codex-rs/tui/src/ascii_animation.rs.
   */
  public currentFrame(now: number = Date.now()): string {
    const frames = this.getFrames();
    if (frames.length === 0) return "";

    if (this.frameTickMs === 0) {
      return frames[0] || "";
    }

    const elapsedMs = Math.max(0, now - this.startTime);
    const frameIndex = Math.floor(elapsedMs / this.frameTickMs) % frames.length;
    const rawFrame = frames[frameIndex] || "";

    return this.colorFn ? this.colorFn(rawFrame) : rawFrame;
  }

  /**
   * Advances sequentially by one frame index and returns the frame string.
   */
  public nextFrame(): string {
    const frames = this.getFrames();
    if (frames.length === 0) return "";

    const rawFrame = frames[this.currentFrameIndex % frames.length] || "";
    this.currentFrameIndex = (this.currentFrameIndex + 1) % frames.length;

    return this.colorFn ? this.colorFn(rawFrame) : rawFrame;
  }

  /**
   * Sets the active animation variant (e.g. 'codex', 'blocks', 'openai').
   */
  public setVariant(variant: AnimationVariant): void {
    this.variant = variant;
    this.currentFrameIndex = 0;
    this.startTime = Date.now();
  }

  public getVariant(): AnimationVariant {
    return this.variant;
  }

  /**
   * Switches to a different random variant from the available catalog.
   */
  public pickRandomVariant(): AnimationVariant {
    const available = ALL_ANIMATION_VARIANTS.filter((v) => v !== this.variant);
    const randomIndex = Math.floor(Math.random() * available.length);
    const nextVariant = available[randomIndex] || "default";
    this.setVariant(nextVariant);
    return nextVariant;
  }

  /**
   * Plays the ASCII animation live in the terminal for a given duration.
   * Useful for splash screens, welcome banners, or idle waiting states.
   */
  public async play(
    durationMs: number = 3000,
    options: {
      signal?: AbortSignal;
      onFrame?: (frame: string, index: number) => void;
      clearScreen?: boolean;
    } = {}
  ): Promise<void> {
    const frames = this.getFrames();
    if (frames.length === 0) return;

    const hideCursor = "\x1b[?25l";
    const showCursor = "\x1b[?25h";
    const resetCursor = "\x1b[H";

    if (process.stdout.isTTY) {
      process.stdout.write(hideCursor);
      if (options.clearScreen) {
        process.stdout.write("\x1b[2J\x1b[H");
      }
    }

    const start = Date.now();
    try {
      while (Date.now() - start < durationMs) {
        if (options.signal?.aborted) break;

        const frame = this.currentFrame();
        if (options.onFrame) {
          options.onFrame(frame, this.currentFrameIndex);
        } else if (process.stdout.isTTY) {
          process.stdout.write(resetCursor + frame);
        }

        await new Promise((resolve) => setTimeout(resolve, this.frameTickMs));
      }
    } finally {
      if (process.stdout.isTTY) {
        process.stdout.write(showCursor);
      }
    }
  }
}
