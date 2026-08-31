import { describe, it, expect } from "bun:test";
import { GrokPermission } from "../src/ui/components/grok/grok-permission";
import { GrokPrompt } from "../src/ui/components/grok/grok-prompt";
import { GrokSlashMenu } from "../src/ui/components/grok/grok-slash-menu";
import { GrokHeader, GrokLogo } from "../src/ui/components/grok/grok-header";
import { GrokStatus } from "../src/ui/components/grok/grok-status";
import { promptToolApproval } from "../src/cli/ui/prompt";

describe("Grok Permission & Grok Slash Menu UI Integration", () => {
  it("should export Grok React components properly", () => {
    expect(typeof GrokPermission).toBe("function");
    expect(typeof GrokPrompt).toBe("function");
    expect(typeof GrokSlashMenu).toBe("function");
    expect(typeof GrokHeader).toBe("function");
    expect(typeof GrokLogo).toBe("function");
    expect(typeof GrokStatus).toBe("function");
  });

  it("should execute promptToolApproval with Grok left-border layout in non-TTY / test mode", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg?: any) => {
      output += (msg ?? "") + "\n";
    };

    try {
      const decision = await promptToolApproval({
        toolName: "Bash",
        description: "Write permission probe output file",
        command: "echo permission-probe-ok > probe-out.txt",
      });

      expect(decision).toBe("yes");
      expect(output).toContain("│");
      expect(output).toContain("Write permission probe output file");
      expect(output).toContain("echo permission-probe-ok > probe-out.txt");
      expect(output).toContain("Yes, and don't ask again for anything (always-approve mode)");
      expect(output).toContain("Yes, proceed");
      expect(output).toContain("No, reject (type to add feedback)");
      expect(output).toContain("2/3");
      expect(output).toContain(":select");
      expect(output).toContain("Ctrl+o");
      expect(output).toContain(":yolo");
      expect(output).toContain("Ctrl+c");
      expect(output).toContain(":cancel");
    } finally {
      console.log = originalLog;
    }
  });
});
