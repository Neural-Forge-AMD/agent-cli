/**
 * macOS Seatbelt (sandbox-exec) Isolation Engine.
 * Directly mirrors codex-rs/sandboxing/src/seatbelt.rs.
 */

import { existsSync } from "node:fs";
import type { SandboxProfile } from "./types";

export class MacOSSandbox {
  private hasSandboxExec: boolean = false;

  constructor() {
    this.checkAvailability();
  }

  private checkAvailability() {
    if (process.platform !== "darwin") {
      return;
    }
    this.hasSandboxExec = existsSync("/usr/bin/sandbox-exec");
  }

  /**
   * Generates a Seatbelt Scheme Policy (.sbpl) string.
   */
  generateProfile(profile: SandboxProfile): string {
    const rules: string[] = [
      "(version 1)",
      "(deny default)",
      "(allow process-exec)",
      "(allow process-fork)",
      "(allow sysctl*)",
      "(allow mach-lookup)",
      "(allow ipc-posix*)",
      "(allow signal)",
      "(allow file-read*)",
      "(allow file-ioctl)",
    ];

    // Permitted writable paths
    for (const writable of profile.writableRoots) {
      rules.push(`(allow file-write* (subpath "${writable}"))`);
    }

    if (profile.allowNetwork) {
      rules.push("(allow network*)");
    } else {
      rules.push("(deny network*)");
    }

    return rules.join("\n");
  }

  /**
   * Wraps a command array with sandbox-exec flags.
   */
  wrapCommand(cmd: string[], profile: SandboxProfile): string[] {
    if (!this.hasSandboxExec || profile.kind === "danger-unrestricted") {
      return cmd;
    }

    const policy = this.generateProfile(profile);
    return ["/usr/bin/sandbox-exec", "-p", policy, ...cmd];
  }

  isSupported(): boolean {
    return process.platform === "darwin" && this.hasSandboxExec;
  }
}
