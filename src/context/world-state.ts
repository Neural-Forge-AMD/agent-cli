/**
 * World State Management.
 * Captures environment snapshot: CWD, git branch, modified files, OS.
 * 
 * Mirrors codex-rs/core/src/context/world_state.rs.
 */

export interface WorldState {
  cwd: string;
  os: string;
  gitBranch?: string;
  gitModifiedCount?: number;
  timestamp: number;
}

export async function captureWorldState(cwd: string): Promise<WorldState> {
  let gitBranch: string | undefined;
  let gitModifiedCount: number | undefined;

  try {
    const branchProc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const branchOut = (await new Response(branchProc.stdout).text()).trim();
    if (branchOut) {
      gitBranch = branchOut;
    }

    const statusProc = Bun.spawn(["git", "status", "--porcelain"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const statusOut = (await new Response(statusProc.stdout).text()).trim();
    if (statusOut) {
      gitModifiedCount = statusOut.split("\n").filter(Boolean).length;
    } else {
      gitModifiedCount = 0;
    }
  } catch {
    // Not a git repository or git unavailable
  }

  return {
    cwd,
    os: `${process.platform} ${process.arch}`,
    gitBranch,
    gitModifiedCount,
    timestamp: Date.now(),
  };
}

export function formatWorldStatePrompt(state: WorldState): string {
  const parts = [
    `Current Working Directory: ${state.cwd}`,
    `Platform: ${state.os}`,
  ];

  if (state.gitBranch) {
    parts.push(`Git Branch: ${state.gitBranch}`);
    parts.push(`Git Modified Files: ${state.gitModifiedCount ?? 0}`);
  }

  return parts.join("\n");
}
