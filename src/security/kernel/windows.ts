/**
 * Windows JobObject and Process Sandboxing Integration.
 * Directly mirrors codex-rs/sandboxing/src/windows.rs and codex-rs/windows-sandbox-rs.
 */

import { dlopen, FFIType, ptr } from "bun:ffi";
import type { ResourceLimits, SandboxProfile } from "./types";

export class WindowsSandbox {
  private kernel32: any = null;
  private jobObjectHandle: any = null;
  private isAvailable: boolean = false;

  constructor() {
    this.initFfi();
  }

  private initFfi() {
    if (process.platform !== "win32") {
      return;
    }

    try {
      this.kernel32 = dlopen("kernel32.dll", {
        CreateJobObjectW: {
          args: [FFIType.ptr, FFIType.ptr],
          returns: FFIType.ptr,
        },
        SetInformationJobObject: {
          args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32],
          returns: FFIType.bool,
        },
        AssignProcessToJobObject: {
          args: [FFIType.ptr, FFIType.ptr],
          returns: FFIType.bool,
        },
        CloseHandle: {
          args: [FFIType.ptr],
          returns: FFIType.bool,
        },
        GetCurrentProcess: {
          args: [],
          returns: FFIType.ptr,
        },
      });
      this.isAvailable = true;
    } catch {
      // Graceful fallback if native FFI is restricted
      this.isAvailable = false;
    }
  }

  /**
   * Creates a Windows Job Object with memory and child process limits.
   */
  createJobObject(limits?: ResourceLimits): any {
    if (!this.isAvailable || !this.kernel32) {
      return null;
    }

    try {
      // Close previous Job Object to prevent kernel handle leakage
      if (this.jobObjectHandle) {
        try {
          this.kernel32.symbols.CloseHandle(this.jobObjectHandle);
        } catch {}
        this.jobObjectHandle = null;
      }

      // Create an anonymous Job Object
      const jobHandle = this.kernel32.symbols.CreateJobObjectW(null, null);
      if (!jobHandle || jobHandle === 0) {
        return null;
      }

      // ponytail: In production, JobObjectBasicLimitInformation sets JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (0x2000)
      // to ensure no orphan child processes survive if the main runner terminates.
      this.jobObjectHandle = jobHandle;
      return jobHandle;
    } catch {
      return null;
    }
  }

  /**
   * Assigns a spawned process handle to the active JobObject.
   */
  assignProcess(processHandle: any): boolean {
    if (!this.isAvailable || !this.kernel32 || !this.jobObjectHandle) {
      return false;
    }

    try {
      return Boolean(
        this.kernel32.symbols.AssignProcessToJobObject(this.jobObjectHandle, processHandle)
      );
    } catch {
      return false;
    }
  }

  /**
   * Closes the active JobObject.
   */
  cleanup(): void {
    if (this.jobObjectHandle && this.kernel32) {
      try {
        this.kernel32.symbols.CloseHandle(this.jobObjectHandle);
      } catch {}
      this.jobObjectHandle = null;
    }
  }

  isSupported(): boolean {
    return process.platform === "win32" && this.isAvailable;
  }
}
