import { expect, test, describe } from "bun:test";
import { KernelSandboxManager } from "../src/security/kernel/manager";
import { LinuxSandbox } from "../src/security/kernel/linux";
import { MacOSSandbox } from "../src/security/kernel/macos";

describe("Kernel Sandboxing & Platform Isolation", () => {
  test("KernelSandboxManager reports system capabilities", () => {
    const manager = new KernelSandboxManager();
    const capabilities = manager.getCapabilities();

    expect(capabilities.platform).toBe(process.platform);
    expect(typeof capabilities.isSandboxingActive).toBe("boolean");
  });

  test("KernelSandboxManager builds default workspace-write profile with zero-trust network", () => {
    const manager = new KernelSandboxManager();
    const profile = manager.buildDefaultProfile(process.cwd());

    expect(profile.kind).toBe("workspace-write");
    expect(profile.writableRoots.length).toBeGreaterThanOrEqual(1);
    expect(profile.allowNetwork).toBe(false); // Secure default
    expect(profile.limits?.maxMemoryMb).toBe(512);

    const escalatedProfile = manager.buildDefaultProfile(process.cwd(), true);
    expect(escalatedProfile.allowNetwork).toBe(true);
  });

  test("LinuxSandbox wraps commands with bwrap flags and unshares net when disabled", () => {
    const linux = new LinuxSandbox();
    const profileNoNet = {
      kind: "workspace-write" as const,
      readableRoots: ["/workspace"],
      writableRoots: ["/workspace"],
      allowNetwork: false,
    };

    if (linux.isSupported()) {
      const wrapped = linux.wrapCommand(["ls", "-la"], profileNoNet);
      expect(wrapped[0]).toBe("bwrap");
      expect(wrapped).toContain("--unshare-all");
      expect(wrapped).toContain("--unshare-net");
      expect(wrapped).toContain("--bind");
    } else {
      // Graceful passthrough when not on linux with bwrap
      const wrapped = linux.wrapCommand(["ls", "-la"], profileNoNet);
      expect(wrapped).toEqual(["ls", "-la"]);
    }
  });

  test("MacOSSandbox generates valid Seatbelt Scheme policy with allow/deny network rules", () => {
    const macos = new MacOSSandbox();
    
    // With network
    const profileWithNet = {
      kind: "workspace-write" as const,
      readableRoots: ["/Users/dev/repo"],
      writableRoots: ["/Users/dev/repo"],
      allowNetwork: true,
    };
    const policyWithNet = macos.generateProfile(profileWithNet);
    expect(policyWithNet).toContain("(version 1)");
    expect(policyWithNet).toContain("(deny default)");
    expect(policyWithNet).toContain('(allow file-write* (subpath "/Users/dev/repo"))');
    expect(policyWithNet).toContain("(allow network*)");

    // Without network
    const profileNoNet = {
      kind: "workspace-write" as const,
      readableRoots: ["/Users/dev/repo"],
      writableRoots: ["/Users/dev/repo"],
      allowNetwork: false,
    };
    const policyNoNet = macos.generateProfile(profileNoNet);
    expect(policyNoNet).toContain("(deny network*)");
  });
});
