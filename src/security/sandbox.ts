/**
 * Path Sandboxing and Workspace Boundary Enforcement.
 * Mirrors path isolation logic in codex-rs/sandboxing/.
 */

import { resolve, normalize, relative } from "node:path";
import { ExecutionPolicyError } from "../protocol/errors";

export class PathSandbox {
  private allowedRoots: string[];

  constructor(workspaceRoots: string[]) {
    this.allowedRoots = workspaceRoots.map((root) => normalize(resolve(root)));
  }

  /**
   * Validates if a target path is strictly within the allowed workspace roots.
   */
  isPathAllowed(targetPath: string): boolean {
    const normalized = normalize(resolve(targetPath));

    return this.allowedRoots.some((root) => {
      const rel = relative(root, normalized);
      return !rel.startsWith("..") && !resolve(root, rel).startsWith("..");
    });
  }

  /**
   * Asserts that a target path is allowed, throwing an ExecutionPolicyError if violated.
   */
  assertPathAllowed(targetPath: string): string {
    const normalized = normalize(resolve(targetPath));

    if (!this.isPathAllowed(normalized)) {
      throw new ExecutionPolicyError(
        `Path access denied: '${targetPath}' is outside the allowed workspace boundaries (${this.allowedRoots.join(", ")})`
      );
    }

    return normalized;
  }
}
