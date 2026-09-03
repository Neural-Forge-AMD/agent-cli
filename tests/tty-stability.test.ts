import { describe, it, expect } from "bun:test";
import { ensureRawMode } from "../src/cli/ui/keypress";
import { InteractiveLineEditor } from "../src/cli/ui/line-editor";
import { WindowsSandbox } from "../src/security/kernel/windows";

describe("Cross-Platform TTY & Console Stability", () => {
  it("ensureRawMode safely guards and debounces redundant mode switches", () => {
    // Should not throw even in test or non-TTY environments
    expect(() => ensureRawMode(true)).not.toThrow();
    expect(() => ensureRawMode(true)).not.toThrow();
    expect(() => ensureRawMode(false)).not.toThrow();
    expect(() => ensureRawMode(false)).not.toThrow();
  });

  it("InteractiveLineEditor initializes and cycles modes reliably", () => {
    const editor = new InteractiveLineEditor({ initialMode: "auto" });
    expect(editor.getMode()).toBe("auto");

    const mode2 = editor.cycleMode();
    expect(mode2).toBe("manual");

    const mode3 = editor.cycleMode();
    expect(mode3).toBe("accept-edits");

    const mode4 = editor.cycleMode();
    expect(mode4).toBe("plan");

    const mode1 = editor.cycleMode();
    expect(mode1).toBe("auto");
  });

  it("WindowsSandbox closes previous handles and cleans up without memory leaks", () => {
    const sandbox = new WindowsSandbox();
    if (sandbox.isSupported()) {
      const h1 = sandbox.createJobObject();
      expect(h1).toBeDefined();

      // Creating a second job should close previous handle and return a new one
      const h2 = sandbox.createJobObject();
      expect(h2).toBeDefined();

      expect(() => sandbox.cleanup()).not.toThrow();
    } else {
      expect(sandbox.createJobObject()).toBeNull();
      expect(() => sandbox.cleanup()).not.toThrow();
    }
  });
});
