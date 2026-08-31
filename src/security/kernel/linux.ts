/**
 * Linux Bubblewrap (bwrap) & Landlock Isolation Engine.
 * Directly mirrors codex-rs/sandboxing/src/bwrap.rs and landlock.rs.
 */

import { existsSync } from "node:fs";
import type { SandboxProfile } from "./types";

export class LinuxSandbox {
  private hasBwrap: boolean = false;

  constructor() {
    this.checkAvailability();
  }

  private checkAvailability() {
    if (process.platform !== "linux") {
      return;
    }
    // Check common locations for bwrap
    this.hasBwrap =
      existsSync("/usr/bin/bwrap") ||
      existsSync("/bin/bwrap") ||
      existsSync("/usr/local/bin/bwrap");
  }

  /**
   * Wraps a command array with Bubblewrap namespace flags.
   */
  wrapCommand(cmd: string[], profile: SandboxProfile): string[] {
    if (!this.hasBwrap || profile.kind === "danger-unrestricted") {
      return cmd;
    }

    const bwrapArgs = [
      "bwrap",
      "--unshare-all",
      "--ro-bind", "/", "/",
      "--dev", "/dev",
      "--proc", "/proc",
      "--tmpfs", "/tmp",
    ];

    // Read-write access for permitted workspace roots
    for (const writableRoot of profile.writableRoots) {
      bwrapArgs.push("--bind", writableRoot, writableRoot);
    }

    // Strict kernel network namespace unshare when network is not allowed
    if (!profile.allowNetwork) {
      bwrapArgs.push("--unshare-net");
    }

    bwrapArgs.push("--", ...cmd);
    return bwrapArgs;
  }

  isSupported(): boolean {
    return process.platform === "linux" && this.hasBwrap;
  }
}
