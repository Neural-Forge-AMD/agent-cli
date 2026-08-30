/**
 * Kernel Sandboxing & Resource Limits Types.
 * Directly mirrors codex-rs/sandboxing and codex-rs/windows-sandbox-rs.
 */

export type SandboxKind = "read-only" | "workspace-write" | "danger-unrestricted";

export interface ResourceLimits {
  /** Maximum RAM allocation for the process tree in megabytes */
  maxMemoryMb?: number;
  /** Maximum CPU percentage limit (1-100) */
  maxCpuPercent?: number;
  /** Wall clock execution timeout in milliseconds */
  wallTimeTimeoutMs?: number;
  /** Max concurrent child processes */
  maxProcesses?: number;
}

export interface SandboxProfile {
  kind: SandboxKind;
  readableRoots: string[];
  writableRoots: string[];
  unreadableRoots?: string[];
  allowNetwork: boolean;
  limits?: ResourceLimits;
}

export interface SpawnSandboxedOptions {
  cwd: string;
  env?: Record<string, string>;
  sandbox?: SandboxProfile;
  timeoutMs?: number;
  proxyEnv?: Record<string, string>;
}

export interface SandboxCapabilityReport {
  platform: NodeJS.Platform;
  hasJobObjects: boolean;
  hasLandlock: boolean;
  hasBubblewrap: boolean;
  hasSeatbelt: boolean;
  isSandboxingActive: boolean;
}
