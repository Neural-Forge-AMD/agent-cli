import { describe, it, expect } from "bun:test";
import {
  LiveSpinner,
  SPINNER_VARIANTS,
  type SpinnerVariant,
} from "../src/cli/ui/spinner";
import { shimmerText } from "../src/cli/ui/shimmer";

describe("Multi-Variant Spinner & Shimmer Subsystem", () => {
  describe("Shimmer Motion Engine", () => {
    it("should return empty string for empty input", () => {
      expect(shimmerText("")).toBe("");
    });

    it("should return unchanged string when disabled", () => {
      expect(shimmerText("Thinking...", { enabled: false })).toBe("Thinking...");
    });

    it("should generate TrueColor RGB ANSI sequences across text characters", () => {
      const result = shimmerText("Thinking deeply...", { sweepSeconds: 2.0 });
      expect(result).toContain("\x1b[38;2;"); // 24-bit TrueColor ANSI code
      expect(result).toContain("\x1b[0m"); // Reset code
    });

    it("should advance wave position based on timestamp", () => {
      const t1 = shimmerText("Executing tool", {}, 1000);
      const t2 = shimmerText("Executing tool", {}, 2000);
      expect(t1).not.toBe(t2);
    });
  });

  describe("Multi-Variant Spinners", () => {
    const variants: SpinnerVariant[] = [
      "braille",
      "rotating_blocks",
      "orbit_dots",
      "pulse_globe",
      "sine_dots",
      "triangles",
      "block_pulse",
    ];

    it("should contain all expected spinner configs in catalog", () => {
      for (const v of variants) {
        const config = SPINNER_VARIANTS[v];
        expect(config).toBeDefined();
        expect(config.frames.length).toBeGreaterThanOrEqual(4);
        expect(config.intervalMs).toBeGreaterThanOrEqual(50);
      }
    });

    it("should allow switching spinner variants dynamically", () => {
      const spinner = new LiveSpinner({ variant: "braille", enableShimmer: false });
      expect(spinner.getVariant()).toBe("braille");

      spinner.setVariant("orbit_dots");
      expect(spinner.getVariant()).toBe("orbit_dots");

      spinner.setVariant("rotating_blocks");
      expect(spinner.getVariant()).toBe("rotating_blocks");
    });

    it("should handle start, update, and stop cleanly", () => {
      const spinner = new LiveSpinner({ variant: "pulse_globe" });
      expect(spinner.isActive()).toBe(false);

      spinner.start("Analyzing workspace...");
      expect(spinner.isActive()).toBe(true);

      spinner.update("Running git status...");
      expect(spinner.isActive()).toBe(true);

      spinner.stop("Task finished successfully", true);
      expect(spinner.isActive()).toBe(false);
    });
  });
});
