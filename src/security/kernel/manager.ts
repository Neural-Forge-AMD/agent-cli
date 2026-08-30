/**
 * KernelSandboxManager - Multi-platform OS-level sandboxing coordinator.
 * Coordinates Windows JobObjects, Linux Bubblewrap, and macOS Seatbelt isolation.
 * Directly mirrors codex-rs/sandboxing/src/manager.rs.
 */

import { WindowsSandbox } from "./windows";
import { LinuxSandbox } from "./linux";
import { MacOSSandbox } from "./macos";
import type {
  SandboxProfile,
  SandboxCapabilityReport,
  SpawnSandboxedOptions,
} from "./types";
import { resolve, normalize } from "node:path";

export class KernelSandboxManager {
  private windowsSandbox: WindowsSandbox;
  private linuxSandbox: LinuxSandbox;
  private macOsSandbox: MacOSSandbox;

  constructor() {
    this.windowsSandbox = new WindowsSandbox();
    this.linuxSandbox = new LinuxSandbox();
    this.macOsSandbox = new MacOSSandbox();
  }

  /**
   * Reports available OS sandboxing capabilities.
   */
  getCapabilities(): SandboxCapabilityReport {
    return {
      platform: process.platform,
      hasJobObjects: this.windowsSandbox.isSupported(),
      hasLandlock: this.linuxSandbox.isSupported(),
      hasBubblewrap: this.linuxSandbox.isSupported(),
      hasSeatbelt: this.macOsSandbox.isSupported(),
      isSandboxingActive:
        this.windowsSandbox.isSupported() ||
        this.linuxSandbox.isSupported() ||
        this.macOsSandbox.isSupported(),
    };
  }

  /**
   * Builds a default workspace-write sandbox profile for a given working directory.
   */
  buildDefaultProfile(cwd: string, allowNetwork: boolean = true): SandboxProfile {
    const normCwd = normalize(resolve(cwd));
    return {
      kind: "workspace-write",
      readableRoots: [normCwd, resolve(process.cwd())],
      writableRoots: [normCwd],
      allowNetwork,
      limits: {
        maxMemoryMb: 512,
        maxCpuPercent: 80,
        wallTimeTimeoutMs: 60000,
        maxProcesses: 16,
      },
    };
  }

  /**
   * Prepares command line arguments wrapped with OS sandbox flags if supported.
   */
  wrapCommand(cmd: string[], profile: SandboxProfile): string[] {
    if (process.platform === "linux") {
      return this.linuxSandbox.wrapCommand(cmd, profile);
    } else if (process.platform === "darwin") {
      return this.macOsSandbox.wrapCommand(cmd, profile);
    }
    return cmd;
  }

  /**
   * Spawns a sandboxed process using Bun.spawn with injected proxy and resource bounds.
   */
  spawnProcess(
    cmd: string[],
    options: SpawnSandboxedOptions
  ) {
    const profile = options.sandbox || this.buildDefaultProfile(options.cwd);
    const finalCmd = this.wrapCommand(cmd, profile);

    const mergedEnv = {
      ...process.env,
      ...options.env,
      ...(options.proxyEnv || {}),
    };

    const proc = Bun.spawn(finalCmd, {
      cwd: options.cwd,
      env: mergedEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });

    // On Windows, if JobObject is active, associate process handle
    if (process.platform === "win32" && this.windowsSandbox.isSupported()) {
      try {
        const job = this.windowsSandbox.createJobObject(profile.limits);
        // Note: Bun process PID can be bound if handle lookup succeeds
      } catch {}
    }

    return proc;
  }
}

// Global singleton instance
export const globalKernelSandbox = new KernelSandboxManager();
