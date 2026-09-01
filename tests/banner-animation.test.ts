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
      expect(output).toContain("Groupy Code");
      expect(output).toContain("Welcome back");
      expect(output).toContain("Tips for getting started");
      expect(output).toContain("What's new");
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
      expect(clean).toContain("Groupy Code");
      expect(clean).toContain("Welcome back");
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
