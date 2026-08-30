/**
 * High-fidelity Sine-Wave Shimmer & Motion Engine for Terminal UI.
 * Directly mirrors codex-rs/tui/src/shimmer.rs & motion.rs.
 * 
 * Computes a dynamic cosine wave that sweeps across text with TrueColor ANSI RGB blending.
 */

import { c } from "./colors";

export interface ShimmerOptions {
  sweepSeconds?: number;
  bandHalfWidth?: number;
  baseRgb?: [number, number, number];
  highlightRgb?: [number, number, number];
  enabled?: boolean;
}

const DEFAULT_BASE_RGB: [number, number, number] = [140, 140, 140]; // Dim gray
const DEFAULT_HIGHLIGHT_RGB: [number, number, number] = [235, 235, 235]; // Bright white/terracotta

function blendRgb(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number
): [number, number, number] {
  const clampT = Math.max(0, Math.min(1, t));
  return [
    Math.round(c1[0] * clampT + c2[0] * (1 - clampT)),
    Math.round(c1[1] * clampT + c2[1] * (1 - clampT)),
    Math.round(c1[2] * clampT + c2[2] * (1 - clampT)),
  ];
}

const processStartTime = Date.now();

/**
 * Applies a glowing sine-wave shimmer animation across the input string.
 * When rendered in a loop, text appears to shine with a moving beam of light.
 */
export function shimmerText(
  text: string,
  options: ShimmerOptions = {},
  elapsedMs?: number
): string {
  if (!text) return "";
  if (options.enabled === false) return text;

  const sweepSeconds = options.sweepSeconds ?? 2.0;
  const bandHalfWidth = options.bandHalfWidth ?? 4.0;
  const baseColor = options.baseRgb ?? DEFAULT_BASE_RGB;
  const highlightColor = options.highlightRgb ?? DEFAULT_HIGHLIGHT_RGB;

  const chars = Array.from(text);
  const padding = 8;
  const period = chars.length + padding * 2;

  const totalElapsedMs = elapsedMs !== undefined ? Math.abs(elapsedMs) : (Date.now() - processStartTime);
  const elapsedSec = (totalElapsedMs / 1000) % sweepSeconds;
  const progress = elapsedSec / sweepSeconds;
  const beamPos = progress * period;

  let result = "";

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    const charPos = i + padding;
    const dist = Math.abs(charPos - beamPos);

    if (dist <= bandHalfWidth) {
      // Cosine bell curve: 0.5 * (1 + cos(pi * dist / bandHalfWidth))
      const x = Math.PI * (dist / bandHalfWidth);
      const intensity = 0.5 * (1.0 + Math.cos(x));
      const [r, g, b] = blendRgb(highlightColor, baseColor, intensity);
      result += `\x1b[38;2;${r};${g};${b}m${char}`;
    } else {
      const [r, g, b] = baseColor;
      result += `\x1b[38;2;${r};${g};${b}m${char}`;
    }
  }

  result += c.reset;
  return result;
}
