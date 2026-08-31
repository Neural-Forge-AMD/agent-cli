# Sandboxed Exec-Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned, authenticated local exec-server that runs only argv-based processes through an OS-enforced sandbox profile and fails closed when enforcement is unavailable.

**Architecture:** The TypeScript exec-server owns JSON-RPC framing, connection/session state, process output retention, and platform selection. A platform launcher produces an execution plan; Linux invokes a verified Bubblewrap command and Windows delegates to a narrowly scoped Rust helper that owns the restricted-token, ACL, and Job Object implementation. Shell tool calls are migrated to the same launcher so local and remote execution share security semantics.

**Tech Stack:** TypeScript, Bun, WebSocket, JSON-RPC 2.0, Rust 2021, Windows APIs, Bubblewrap, Bun test.

**Spec:** `docs/superpowers/specs/2026-08-30-remote-execution-cloud-sandbox-design.md`

## Global Constraints

- Every process start accepts `argv: string[]`; do not construct `sh -c`, `cmd /c`, or `powershell -Command` from agent text.
- Profiles `read-only` and `workspace-write` fail with `SandboxUnavailable` when the current OS cannot enforce them.
- `full-access` remains explicit and requires existing user approval; it is never a security fallback.
- Process ownership is scoped to a server session; session close kills every owned process.
- Tests prove observable security behavior; cross-platform unit tests never claim native enforcement.

---

### Task 1: Define the shared permission, process, and RPC contracts

**Files:**
- Create: `src/exec/protocol.ts`
- Create: `src/exec/types.ts`
- Create: `tests/exec-protocol.test.ts`
- Modify: `src/protocol/errors.ts`
- Modify: `src/protocol/index.ts`

**Interfaces:**
- Produces `SandboxProfile`, `ProcessStartRequest`, `ProcessOutputChunk`, `ExecRpcRequest`, `ExecRpcResponse`, `ExecRpcNotification`, `SandboxUnavailableError`, and `ExecProtocolError`.
- Consumers use `parseRpcMessage(raw: string): ExecRpcRequest` and `validateProcessStart(params: unknown): ProcessStartRequest`.

- [ ] **Step 1: Write the failing protocol tests**

```ts
import { expect, test } from "bun:test";
import { validateProcessStart } from "../src/exec/protocol";

test("process/start accepts argv and a bounded workspace-write profile", () => {
  expect(validateProcessStart({
    processId: "p1", argv: ["git", "status"], cwd: "C:/repo",
    sandbox: { kind: "workspace-write", readableRoots: ["C:/repo"], writableRoots: ["C:/repo"], network: "disabled" },
  }).argv).toEqual(["git", "status"]);
});

test("process/start rejects a shell command string and relative cwd", () => {
  expect(() => validateProcessStart({ command: "git status", cwd: "." })).toThrow("argv");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/exec-protocol.test.ts`

Expected: FAIL because `src/exec/protocol.ts` does not exist.

- [ ] **Step 3: Implement minimal immutable contracts and validators**

```ts
export type SandboxKind = "read-only" | "workspace-write" | "full-access";
export type NetworkMode = "disabled" | "full-access";
export interface SandboxProfile {
  kind: SandboxKind; readableRoots: string[]; writableRoots: string[];
  unreadableRoots?: string[]; network: NetworkMode; maxWallTimeMs?: number;
  maxOutputBytes?: number; maxChildProcesses?: number;
}
export interface ProcessStartRequest { processId: string; argv: string[]; cwd: string; sandbox: SandboxProfile; env?: Record<string, string>; tty?: boolean; pipeStdin?: boolean; }
```

Normalize absolute paths before validation, reject empty argv elements and roots outside the requested profile, cap time/output/process values, and reject unknown RPC methods with `-32601`.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `bun test tests/exec-protocol.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/exec tests/exec-protocol.test.ts src/protocol
git commit -m "feat(exec): define sandboxed exec protocol"
```

### Task 2: Build session-scoped process registry and JSON-RPC server

**Files:**
- Create: `src/exec/process-registry.ts`
- Create: `src/exec/server.ts`
- Create: `src/exec/index.ts`
- Create: `src/cli/exec-server.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/exec-server.test.ts`

**Interfaces:**
- Consumes `ProcessStartRequest` and `SandboxLauncher` from Tasks 1 and 3.
- Produces `ExecServer`, `ExecServerSession`, `ProcessRegistry`, and CLI command `pikaa exec-server --listen ws://127.0.0.1:0 --token <token>`.

- [ ] **Step 1: Write failing ownership and reconnect-output tests**

```ts
test("a second session cannot read a process owned by the first session", async () => {
  const server = await ExecServer.start({ token: "test-token", launcher: fakeLauncher });
  const owner = await connectInitialized(server.url, "test-token");
  const other = await connectInitialized(server.url, "test-token");
  await owner.call("process/start", request("owned"));
  await expect(other.call("process/read", { processId: "owned", afterSeq: null })).rejects.toThrow("not found");
});

test("process/read returns only output after the supplied sequence cursor", async () => {
  const process = registryForTest().recordOutput("p1", "one").recordOutput("p1", "two");
  expect(process.read("p1", 1, 1024).chunks.map((chunk) => chunk.data)).toEqual(["two"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/exec-server.test.ts`

Expected: FAIL because `ExecServer` and the registry do not exist.

- [ ] **Step 3: Implement server lifecycle**

Implement `initialize`/`initialized` ordering, constant-time token comparison, maximum message size, heartbeat timer, sequential request processing, and server notifications `process/output` and `process/exited`. Retain output in a per-process byte ring buffer; each chunk receives the next integer sequence. Call `ProcessRegistry.closeSession(sessionId)` on WebSocket close, heartbeat expiry, or explicit close.

- [ ] **Step 4: Run focused tests to verify they pass**

Run: `bun test tests/exec-server.test.ts`

Expected: PASS; include tests for pre-initialize rejection, invalid token rejection, process-ID reuse rejection, and close-kills-owned-processes.

- [ ] **Step 5: Commit**

```bash
git add src/exec src/cli tests/exec-server.test.ts
git commit -m "feat(exec): add session-scoped JSON-RPC exec server"
```

### Task 3: Create the fail-closed launcher and remove command-string spawning

**Files:**
- Create: `src/security/sandbox-profile.ts`
- Create: `src/security/launcher.ts`
- Modify: `src/security/index.ts`
- Modify: `src/tools/handlers/shell.ts`
- Test: `tests/sandbox-launcher.test.ts`
- Test: `tests/exec-policy.test.ts`

**Interfaces:**
- Produces `SandboxLauncher.prepare(request): Promise<PreparedProcess>` where `PreparedProcess` has `argv`, `cwd`, `env`, `spawn()`, and `close()`.
- `shell` tool consumes structured `argv` from a parser and invokes `SandboxLauncher`; it no longer calls an OS command shell.

- [ ] **Step 1: Write failing launcher tests**

```ts
test("workspace-write fails closed when native enforcement is unavailable", async () => {
  const launcher = new SandboxLauncher({ platform: "unsupported" });
  await expect(launcher.prepare(requestWithProfile("workspace-write"))).rejects.toMatchObject({ code: "SANDBOX_UNAVAILABLE" });
});

test("launcher scrubs inherited secrets and retains allowlisted variables", async () => {
  const prepared = await new SandboxLauncher({ platform: "fake" }).prepare(requestWithEnv({ SECRET: "x", LANG: "en_US.UTF-8" }));
  expect(prepared.env).toEqual({ LANG: "en_US.UTF-8" });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/sandbox-launcher.test.ts`

Expected: FAIL because `SandboxLauncher` does not exist.

- [ ] **Step 3: Implement profile enforcement boundary**

Use `PathSandbox` for canonical root validation, construct a scrubbed environment from `LANG`, `LC_ALL`, `TERM`, `TZ`, and caller-declared variables allowed by configuration, and expose `full-access` only through an explicit `allowFullAccess` option. Replace the shell tool's `command` parameter with `{ argv: string[] }`; preserve compatibility only by returning a typed error for a legacy command string rather than parsing it through a shell.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/sandbox-launcher.test.ts tests/exec-policy.test.ts`

Expected: PASS; test profile root escape, symlink escape, timeout, output cap, and no fallback from `workspace-write` to unsandboxed Bun.spawn.

- [ ] **Step 5: Commit**

```bash
git add src/security src/tools/handlers/shell.ts tests
git commit -m "feat(security): require structured sandboxed process launch"
```

### Task 4: Implement Linux Bubblewrap launcher

**Files:**
- Create: `src/security/linux-bwrap.ts`
- Create: `scripts/verify-bwrap.ts`
- Test: `tests/linux-bwrap.test.ts`
- Test: `tests/linux-bwrap.integration.test.ts`

**Interfaces:**
- Produces `LinuxBwrapLauncher` implementing `SandboxPlatformLauncher`.
- Consumes a `SandboxProfile` and returns Bubblewrap argv with no shell interpolation.

- [ ] **Step 1: Write failing command-construction tests**

```ts
test("workspace-write binds only writable roots and unshares disabled networking", () => {
  const argv = new LinuxBwrapLauncher({ bwrapPath: "/usr/bin/bwrap" }).buildArgs(requestWithProfile("workspace-write"));
  expect(argv).toContain("--unshare-net");
  expect(argv).toEqual(expect.arrayContaining(["--bind", "/repo", "/repo"]));
  expect(argv).not.toEqual(expect.arrayContaining(["--bind", "/home", "/home"]));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/linux-bwrap.test.ts`

Expected: FAIL because `LinuxBwrapLauncher` does not exist.

- [ ] **Step 3: Implement Bubblewrap validation and argv construction**

Resolve only a configured absolute Bubblewrap path, require executable permissions, check the SHA-256 against a configured release manifest, mount system runtime paths read-only, bind writable roots, mask unreadable roots, create `/proc`, unshare network when disabled, and preserve only approved file descriptors. Reject a missing or checksum-mismatched binary.

- [ ] **Step 4: Run unit and Linux-only integration tests**

Run: `bun test tests/linux-bwrap.test.ts`

Expected: PASS on every OS.

Run on Linux: `bun test tests/linux-bwrap.integration.test.ts`

Expected: PASS; prove a write outside the workspace and a network request fail inside Bubblewrap. On Windows/macOS the integration file reports `skip` with the platform reason.

- [ ] **Step 5: Commit**

```bash
git add src/security/linux-bwrap.ts scripts/verify-bwrap.ts tests/linux-bwrap*
git commit -m "feat(sandbox): add verified Linux bubblewrap launcher"
```

### Task 5: Add the Windows native sandbox helper

**Files:**
- Create: `native/windows-sandbox/Cargo.toml`
- Create: `native/windows-sandbox/src/main.rs`
- Create: `native/windows-sandbox/src/protocol.rs`
- Create: `native/windows-sandbox/src/sandbox.rs`
- Create: `src/security/windows-native.ts`
- Test: `tests/windows-native.test.ts`
- Test: `native/windows-sandbox/tests/integration.rs`

**Interfaces:**
- Produces executable `pikaa-windows-sandbox` using newline-delimited JSON on stdin/stdout.
- `WindowsNativeLauncher.prepare(request)` invokes the helper and maps its machine-readable `sandbox_unavailable`, `started`, `output`, and `exited` messages into Groupy protocol events.

- [ ] **Step 1: Write failing TypeScript contract tests and Rust integration fixture**

```ts
test("Windows helper refusal is surfaced as SandboxUnavailable and command does not start", async () => {
  const helper = fakeWindowsHelper([{ type: "sandbox_unavailable", reason: "restricted token unavailable" }]);
  await expect(new WindowsNativeLauncher({ helper }).prepare(requestWithProfile("read-only"))).rejects.toMatchObject({ code: "SANDBOX_UNAVAILABLE" });
  expect(helper.receivedStart).toBe(false);
});
```

```rust
#[test]
fn denied_parent_directory_cannot_be_written_by_restricted_child() {
    let result = run_fixture(Profile::workspace_write(temp_workspace()));
    assert!(result.outside_write_denied);
    assert!(result.acls_restored);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/windows-native.test.ts`

Expected: FAIL because `WindowsNativeLauncher` does not exist.

Run on Windows: `cargo test --manifest-path native/windows-sandbox/Cargo.toml`

Expected: FAIL because the helper crate does not exist.

- [ ] **Step 3: Implement the native helper**

Use Windows API bindings to create a restricted token/AppContainer, calculate materialized allow and deny paths, add inheritable ACL entries, create a Job Object with `KILL_ON_JOB_CLOSE` plus memory/process limits, launch direct argv through `CreateProcessAsUserW`, stream bounded stdout/stderr, and restore every changed ACL through an RAII cleanup guard. Return `sandbox_unavailable` before spawning if any native prerequisite fails.

- [ ] **Step 4: Run verification**

Run: `bun test tests/windows-native.test.ts`

Expected: PASS on every OS using the fake-helper transport.

Run on Windows: `cargo test --manifest-path native/windows-sandbox/Cargo.toml`

Expected: PASS; prove outside-write denial, job cleanup, and ACL restoration.

- [ ] **Step 5: Commit**

```bash
git add native/windows-sandbox src/security/windows-native.ts tests/windows-native.test.ts
git commit -m "feat(sandbox): add fail-closed Windows native helper"
```

### Task 6: Complete local integration and regression verification

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Test: `tests/exec-server.test.ts`
- Test: `tests/shell-tool.integration.test.ts`

**Interfaces:**
- Produces documented `pikaa exec-server` startup, profile behavior, and platform support matrix.

- [ ] **Step 1: Write an end-to-end failing test**

```ts
test("initialized client starts argv process and receives ordered output and exit notifications", async () => {
  const client = await localExecClient();
  await client.start({ processId: "echo", argv: [testEchoPath(), "hello"], cwd: workspace(), sandbox: fullAccessProfile() });
  expect(await client.collectOutput("echo")).toEqual("hello\n");
  expect(await client.waitForExit("echo")).toEqual(0);
});
```

- [ ] **Step 2: Run test to verify it fails before wiring**

Run: `bun test tests/shell-tool.integration.test.ts`

Expected: FAIL until CLI/server/launcher wiring is complete.

- [ ] **Step 3: Wire production CLI and document exact requirements**

Add `exec-server` command parsing, `bun run test:exec` script, native-helper build instructions, and documentation that only `full-access` can run when no verified platform sandbox is installed.

- [ ] **Step 4: Run all Groupy verification**

Run: `bun test --timeout 30000`

Expected: all existing and new tests pass.

Run: `bunx tsc --noEmit`

Expected: exit 0 after repairing the project-local Bun dependency installation if needed.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json src tests native
git commit -m "feat(exec): deliver sandboxed local exec server"
```
