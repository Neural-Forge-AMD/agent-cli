/**
 * Process Killer & Global Process Lifecycle Registry for MCP Child Processes.
 * 
 * Guarantees that all spawned child processes and their descendant process
 * trees (e.g. npx -> node, uvx -> python, docker) are cleanly and immediately
 * terminated when:
 * 1. An MCP server is disconnected or removed.
 * 2. The REPL session terminates (/exit, /quit, EOF).
 * 3. The process receives termination signals (SIGINT, SIGTERM, SIGHUP).
 * 4. Uncaught exceptions or unhandled promise rejections occur.
 * 5. Normal process exit event fires.
 */

import { spawnSync } from "node:child_process";

export interface TrackedMcpProcess {
  pid: number;
  command: string;
  close?: () => Promise<void> | void;
}

export class GlobalProcessRegistry {
  private static trackedProcesses = new Map<number, TrackedMcpProcess>();
  private static hooksInstalled = false;

  /**
   * Kills a process and its entire process tree unconditionally.
   */
  static killProcessTree(pid: number, signal: NodeJS.Signals = "SIGKILL"): void {
    if (!pid || pid <= 0) return;

    if (process.platform === "win32") {
      try {
        // Windows: /T kills process and any child processes; /F forcefully terminates
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } catch {
        try {
          process.kill(pid, signal);
        } catch {}
      }
    } else {
      // Unix / macOS: Try killing negative PID (process group) first, then fallback to direct PID
      try {
        process.kill(-pid, signal);
      } catch {
        try {
          process.kill(pid, signal);
        } catch {}
      }
    }
  }

  /**
   * Registers a spawned MCP child process for lifecycle tracking and exit cleanup.
   */
  static register(pid: number, command: string, closeFn?: () => Promise<void> | void): void {
    if (!pid || pid <= 0) return;
    this.ensureExitHooks();
    this.trackedProcesses.set(pid, { pid, command, close: closeFn });
  }

  /**
   * Unregisters a child process once it has exited or been cleaned up.
   */
  static unregister(pid: number): void {
    this.trackedProcesses.delete(pid);
  }

  /**
   * Returns list of currently active tracked MCP process IDs.
   */
  static getTrackedPids(): number[] {
    return Array.from(this.trackedProcesses.keys());
  }

  /**
   * Synchronously and forcefully terminates all active MCP child process trees.
   */
  static killAll(): void {
    if (this.trackedProcesses.size === 0) return;

    for (const [pid, proc] of this.trackedProcesses) {
      if (proc.close) {
        try {
          proc.close();
        } catch {}
      }
      this.killProcessTree(pid);
    }
    this.trackedProcesses.clear();
  }

  /**
   * Asynchronously and gracefully closes all MCP child processes.
   */
  static async closeAllGracefully(): Promise<void> {
    const promises: Array<Promise<void>> = [];

    for (const [pid, proc] of this.trackedProcesses) {
      if (proc.close) {
        try {
          const res = proc.close();
          if (res && typeof (res as any).then === "function") {
            promises.push(res as Promise<void>);
          }
        } catch {}
      }
      // Backup forceful kill
      this.killProcessTree(pid);
    }

    try {
      await Promise.allSettled(promises);
    } catch {}

    this.trackedProcesses.clear();
  }

  /**
   * Installs process-wide exit and signal hooks once.
   */
  static ensureExitHooks(): void {
    if (this.hooksInstalled) return;
    this.hooksInstalled = true;

    // Normal process exit
    process.on("exit", () => {
      GlobalProcessRegistry.killAll();
    });

    // POSIX / Windows termination signals
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK" as any];
    for (const sig of signals) {
      try {
        process.on(sig, () => {
          GlobalProcessRegistry.killAll();
        });
      } catch {}
    }

    // Uncaught crashes
    process.on("uncaughtException", (err) => {
      GlobalProcessRegistry.killAll();
    });

    process.on("unhandledRejection", (reason) => {
      GlobalProcessRegistry.killAll();
    });
  }
}
