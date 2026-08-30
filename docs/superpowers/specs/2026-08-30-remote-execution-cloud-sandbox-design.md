# Remote Execution, Cloud Tasks, and Native Sandbox Design

## Goal

Extend Groupy from a local CLI coding agent into a safely distributed agent system: a user can submit, monitor, inspect, and apply a task against an authenticated execution environment on another machine without exposing arbitrary shell access.

## Scope

This design adds three dependent capabilities:

1. A remote exec-server protocol and environment connection lifecycle.
2. A cloud-task control plane for creating, monitoring, reviewing, diffing, and applying agent tasks.
3. OS-enforced command isolation and process hardening for Linux and Windows.

The first delivery does not provide unauthenticated public listeners, arbitrary third-party environment registration, automatic application of a task diff, or an insecure fallback when the requested sandbox cannot be enforced.

## Architecture

```text
Groupy CLI / Agent
        |
        | authenticated HTTPS + WebSocket control channel
        v
Pikaa control plane (pikaa-cli-backend)
  - environment registry
  - task API and durable state
  - relay authorization and audit events
        |
        | authenticated outbound relay; no inbound host port required
        v
Pikaa exec-server on a registered host
  - JSON-RPC process/filesystem executor
  - per-session process/output state
  - platform sandbox launcher
        |
        v
Sandboxed child process in the selected workspace
```

The control plane owns identity, environment selection, task metadata, task status, audit records, and task artifacts. The exec-server owns only its host-local process lifecycle and never accepts an unauthenticated command. The CLI owns presentation, user approvals, and explicit diff application.

## 1. Remote Exec-Server

### Contract

Create an `exec-server` package in Groupy with a versioned JSON-RPC protocol. Each connection performs `initialize` followed by `initialized`; all other calls are rejected before that handshake. The first protocol version exposes:

- `environment/info` returns OS, architecture, shell metadata, sandbox capabilities, and workspace roots.
- `process/start` accepts a non-empty `argv` vector, absolute working directory, allowlisted environment overlay, stdin/TTY mode, and a named sandbox profile.
- `process/read`, `process/write`, `process/kill`, and `process/close` manage only process IDs created by that session.
- `filesystem/read` and `filesystem/list` are bounded, sandbox-profile-aware read operations.

The server assigns a session identifier during initialization. Process output is retained as byte-capped chunks with monotonic sequence numbers so a reconnecting client can continue from `afterSeq`. Closing a session terminates its owned child processes.

### Connection and authentication

An exec-server registers an environment with the control plane using a short-lived, signed environment token. It opens an outbound WebSocket relay connection and receives only streams authorized for that environment. The relay transports opaque encrypted frames; it does not inspect, run, or persist JSON-RPC payloads. Direct localhost WebSocket mode exists only for development and requires an explicit development token.

Each request carries a task/session binding validated by the exec-server. Replay-resistant request IDs, connection-scoped rate limits, maximum frame size, and heartbeat expiry are mandatory. The implementation uses TLS for every network endpoint; secrets are read through the platform credential store rather than persisted in plaintext JSON.

### Failure behavior

Connection loss does not replay a process start. The server retains output and exit state only for a bounded session retention window. A reconnect can retrieve buffered output, but cannot acquire a process belonging to another authenticated session. Relay/authentication errors are surfaced as typed failures and audit events.

## 2. Cloud Task Control Plane

### API and lifecycle

The backend adds task endpoints and durable records:

- `POST /v1/cloud/tasks` creates a task for a registered environment, prompt, git ref, requested sandbox profile, and 1–4 attempts.
- `GET /v1/cloud/tasks` lists tasks with environment/status filters and cursor pagination.
- `GET /v1/cloud/tasks/:taskId` returns status, attempt summaries, artifact metadata, and terminal errors.
- `GET /v1/cloud/tasks/:taskId/diff` returns one selected attempt's bounded unified diff.
- `POST /v1/cloud/tasks/:taskId/apply` requires an explicit selected attempt and applies only after the CLI shows the diff and the user approves.

Task states are `queued`, `provisioning`, `running`, `awaiting_approval`, `succeeded`, `failed`, `cancelled`, and `expired`. State transitions are append-only audit records. A worker leases tasks, creates an isolated worktree, drives a Groupy agent session through the exec-server, collects the git diff and logs, then atomically publishes the terminal attempt artifact.

### Task safety

The worker never uses the user's primary checkout. It creates a named worktree from the requested immutable git ref, validates the resolved commit, and removes the worktree only after artifacts are durable. Task creation is idempotent via a caller-provided UUID. Applying a result is explicit, checks the chosen attempt and target ref, and fails on merge conflicts without modifying the primary checkout further.

## 3. Native Sandbox and Process Hardening

### Common permission model

All executions use a named `SandboxProfile`: `read-only`, `workspace-write`, or `full-access`. A profile contains absolute readable roots, writable roots, explicitly unreadable roots, network mode (`disabled` or `full-access`), command argv, working directory, maximum wall time, maximum output bytes, and maximum child-process count.

`full-access` is never selected implicitly. A request for `read-only` or `workspace-write` fails closed when platform enforcement is unavailable. The current regex approval policy remains a user-interaction layer; it is not treated as a sandbox.

### Linux

Use Bubblewrap to construct a filesystem namespace. Mount runtime dependencies read-only, bind only permitted workspace roots writable, mask denied paths, create a fresh `/proc`, and use a separate network namespace when networking is disabled. Execute the argv directly and validate the Bubblewrap binary's version and SHA-256 before use. Apply resource limits through cgroups v2 where available, otherwise reject profiles whose limits cannot be enforced.

### Windows

Add a small Rust native helper invoked by the Bun exec-server. The helper creates a restricted token/AppContainer, applies allow and deny ACLs to materialized roots, starts the child in a job object with kill-on-close and process/resource limits, and returns structured process events over stdin/stdout. It must restore temporary ACL changes on every exit path. If the current Windows edition or permission model cannot enforce a requested profile, the helper reports `SandboxUnavailable`; it does not launch the command unsandboxed.

### Hardening

Commands are spawned from an argv array; neither server invokes `sh -c` or `powershell -Command`. The executor begins from a scrubbed environment, permits a small inherited-variable allowlist, controls PATH explicitly, uses a new process group/job object, limits output, rejects symlink escapes when resolving workspace paths, and records every launch/exit/denial in the audit stream.

## Data Model

The backend persists `Environment`, `CloudTask`, `TaskAttempt`, `TaskArtifact`, `EnvironmentSession`, and immutable `AuditEvent` records. Environment identity is a public key fingerprint plus rotating registration credential. Task artifacts reference bounded log chunks, patch/diff content, base commit, resulting commit if created, and sandbox audit summary; they never contain raw provider tokens or process environment values.

## Testing and Verification

Tests are test-first and cover protocol handshake ordering, authentication rejection, session ownership, reconnect/read cursor behavior, task idempotency, every valid and invalid state transition, task artifact publication, explicit apply conflict behavior, argv-only spawning, profile serialization, path/symlink escape rejection, and fail-closed sandbox selection.

Linux integration tests run Bubblewrap in a disposable workspace and demonstrate denied write/network access. Windows integration tests run the native helper and demonstrate denied writes outside the allowed root, child-process cleanup, and ACL restoration. Cross-OS protocol tests use a fake transport; they do not falsely claim OS sandbox enforcement.

## Delivery Sequence

1. Define shared permission, exec protocol, audit event, and task contracts with tests.
2. Implement local exec-server plus fail-closed sandbox selection and process hardening.
3. Implement Linux Bubblewrap and Windows Rust helper with platform-specific tests.
4. Implement backend environment registration, authenticated relay, and remote exec client.
5. Implement durable cloud task lifecycle, worker, CLI commands, and explicit diff/apply flow.

Each stage is independently usable and reviewable. The next stage is not enabled until the previous stage has passing unit and integration tests.
