import { describe, it, expect } from "bun:test";
import { AsciiAnimation } from "../src/cli/ui/animation/ascii-animation";
import { FramesLoader } from "../src/cli/ui/animation/frames-loader";
import { ALL_ANIMATION_VARIANTS } from "../src/cli/ui/animation/types";

describe("36-Frame ASCII Art Animation Subsystem", () => {
  it("should successfully load 36 frames for all 10 variants from assets", () => {
    for (const variant of ALL_ANIMATION_VARIANTS) {
      const frames = FramesLoader.getFrames(variant);
      expect(frames.length).toBe(36);
      expect(typeof frames[0]).toBe("string");
      expect(frames[0]!.length).toBeGreaterThan(10);
    }
  });

  it("should calculate correct frame index based on elapsed time", () => {
    const anim = new AsciiAnimation({ variant: "default", frameTickMs: 80 });
    const frames = anim.getFrames();
    expect(frames.length).toBe(36);

    const baseTime = Date.now();
    // At t = 0 -> frame 0
    expect(anim.currentFrame(baseTime)).toBe(frames[0]!);
    // At t = 80ms -> frame 1
    expect(anim.currentFrame(baseTime + 80)).toBe(frames[1]!);
    // At t = 35 * 80ms (2800ms) -> frame 35
    expect(anim.currentFrame(baseTime + 2800)).toBe(frames[35]!);
    // At t = 36 * 80ms (2880ms) -> loops back to frame 0
    expect(anim.currentFrame(baseTime + 2880)).toBe(frames[0]!);
  });

  it("should advance frame on nextFrame()", () => {
    const anim = new AsciiAnimation({ variant: "blocks" });
    const frames = anim.getFrames();

    const f1 = anim.nextFrame();
    const f2 = anim.nextFrame();
    const f3 = anim.nextFrame();

    expect(f1).toBe(frames[0]!);
    expect(f2).toBe(frames[1]!);
    expect(f3).toBe(frames[2]!);
  });

  it("should support variant switching and picking random variants", () => {
    const anim = new AsciiAnimation({ variant: "default" });
    expect(anim.getVariant()).toBe("default");

    anim.setVariant("mesosfer");
    expect(anim.getVariant()).toBe("mesosfer");
    expect(anim.getFrames().length).toBe(36);

    const random = anim.pickRandomVariant();
    expect(ALL_ANIMATION_VARIANTS).toContain(random);
    expect(random).not.toBe("mesosfer");
  });

  it("should apply custom color formatting function to frames", () => {
    const anim = new AsciiAnimation({
      variant: "groupy",
      colorFn: (frame) => `\x1b[35m${frame}\x1b[0m`,
    });

    const frame = anim.nextFrame();
    expect(frame.startsWith("\x1b[35m")).toBe(true);
    expect(frame.endsWith("\x1b[0m")).toBe(true);
  });
});
