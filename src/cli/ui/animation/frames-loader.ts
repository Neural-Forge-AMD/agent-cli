/**
 * Frames Loader for 36-Frame ASCII Art Variants.
 * Reads and caches raw frame text files from assets/frames/<variant>/frame_<n>.txt.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AnimationVariant } from "./types";
import { ALL_ANIMATION_VARIANTS } from "./types";

export class FramesLoader {
  private static cache = new Map<AnimationVariant, string[]>();
  private static assetsDir: string = resolve(__dirname, "../../../../assets/frames");

  static setAssetsDir(customDir: string): void {
    this.assetsDir = customDir;
    this.cache.clear();
  }

  static getAssetsDir(): string {
    return this.assetsDir;
  }

  /**
   * Loads all 36 frames for a given variant. Returns cached frames on subsequent calls.
   */
  static getFrames(variant: AnimationVariant): string[] {
    if (this.cache.has(variant)) {
      return this.cache.get(variant)!;
    }

    const variantDir = join(this.assetsDir, variant);
    if (!existsSync(variantDir)) {
      // Fallback empty frame list if assets not found
      return [];
    }

    const frames: string[] = [];
    for (let i = 1; i <= 36; i++) {
      const framePath = join(variantDir, `frame_${i}.txt`);
      if (existsSync(framePath)) {
        try {
          const content = readFileSync(framePath, "utf-8");
          frames.push(content);
        } catch {
          // ignore read error
        }
      }
    }

    this.cache.set(variant, frames);
    return frames;
  }

  /**
   * Preload all variants into memory cache.
   */
  static preloadAll(): void {
    for (const variant of ALL_ANIMATION_VARIANTS) {
      this.getFrames(variant);
    }
  }
}
