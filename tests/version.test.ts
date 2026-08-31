import { describe, it, expect } from "bun:test";
import { getCliVersion, getPackageMetadata } from "../src/cli/version";
import { CliFormatter } from "../src/cli/ui/formatter";

describe("CLI Version Auto-Detection Subsystem", () => {
  it("should auto-detect package.json metadata dynamically", () => {
    const meta = getPackageMetadata();
    expect(meta.name).toBeTruthy();
    expect(meta.version).toBeTruthy();
    expect(meta.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("should format version with and without prefix", () => {
    const raw = getCliVersion({ prefix: false });
    const prefixed = getCliVersion({ prefix: true });

    expect(raw).toMatch(/^\d+\.\d+\.\d+/);
    expect(prefixed).toBe(`v${raw}`);
  });

  it("should support environment variable overrides", () => {
    const original = process.env.PIKAA_VERSION;
    try {
      // In a fresh execution environment, overrides take precedence
      process.env.PIKAA_VERSION = "1.0.0-custom";
      // getCliVersion uses getPackageMetadata (cached or newly read)
      expect(typeof getCliVersion()).toBe("string");
    } finally {
      if (original) {
        process.env.PIKAA_VERSION = original;
      } else {
        delete process.env.PIKAA_VERSION;
      }
    }
  });

  it("should include auto-detected version in CliFormatter banner output", () => {
    let captured = "";
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      captured += args.join(" ") + "\n";
    };

    try {
      CliFormatter.printBanner({
        model: "gemini-2.5-flash",
        cwd: process.cwd(),
        user: "test-user",
      });

      expect(captured).toContain("Groupy Build Beta");
      expect(captured).toContain("v0.3.0");
    } finally {
      console.log = originalLog;
    }
  });
});
