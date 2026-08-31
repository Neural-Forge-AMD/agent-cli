/**
 * Type definitions for the 36-Frame ASCII Art Animation Engine.
 * Directly mirrors codex-rs/tui/src/ascii_animation.rs & frames.rs.
 */

export type AnimationVariant =
  | "default"
  | "groupy"
  | "mesosfer"
  | "blocks"
  | "dots"
  | "hash"
  | "hbars"
  | "vbars"
  | "shapes"
  | "slug";

export const ALL_ANIMATION_VARIANTS: readonly AnimationVariant[] = [
  "default",
  "groupy",
  "mesosfer",
  "blocks",
  "dots",
  "hash",
  "hbars",
  "vbars",
  "shapes",
  "slug",
] as const;

export const DEFAULT_FRAME_TICK_MS = 80;

export interface AsciiAnimationOptions {
  variant?: AnimationVariant;
  frameTickMs?: number;
  assetsDir?: string;
  colorFn?: (frame: string) => string;
}
