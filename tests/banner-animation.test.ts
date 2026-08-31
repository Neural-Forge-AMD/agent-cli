import { describe, it, expect } from "bun:test";
import { BannerAnimator, type BannerInfo } from "../src/cli/ui/animation/banner-animation";

describe("Animated Banner Logo Subsystem", () => {
  const sampleInfo: BannerInfo = {
    model: "gpt-4o",
    cwd: "/workspace/test-project",
    user: "developer@mesosfer.com",
    role: "architect",
  };

  it("should render static banner synchronously without errors", () => {
    let output = "";
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      BannerAnimator.renderStatic(sampleInfo);
      expect(output).toContain("Groupy Build Beta");
      expect(output).toContain("Groupy is here!");
      expect(output).toContain("gpt-4o");
      expect(output).toContain("ctrl+w");
      expect(output).toContain("ctrl+s");
    } finally {
      console.log = originalLog;
    }
  });

  it("should support banner card rendering", () => {
    let output = "";
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      BannerAnimator.renderStatic(sampleInfo, { withShimmerSweep: true });
      const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
      expect(clean).toContain("Groupy Build Beta");
      expect(clean).toContain("Groupy is here!");
    } finally {
      console.log = originalLog;
    }
  });

  it("should execute play transition without throwing errors", async () => {
    await BannerAnimator.play(sampleInfo, { animate: false });
    // Verify fast animated execution in test
    await BannerAnimator.play(sampleInfo, { animate: true });
  });
});
