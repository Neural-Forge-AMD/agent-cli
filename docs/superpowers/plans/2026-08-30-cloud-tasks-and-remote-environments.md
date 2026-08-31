# Cloud Tasks and Remote Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated remote environments and a durable cloud-task lifecycle that lets Groupy create, monitor, inspect, diff, and explicitly apply agent task results.

**Architecture:** `pikaa-cli-backend` becomes the authenticated control plane and retains environments, task state, attempts, artifacts, and immutable audit events. Groupy registers exec-server environments through an outbound relay, creates tasks through HTTPS, and presents status/diff/apply commands; the task worker drives execution only in a disposable git worktree through the exec-server client.

**Tech Stack:** Python 3.10+, FastAPI, SQLAlchemy, Alembic, WebSocket, JWT, TypeScript, Bun, Git.

**Spec:** `groupy/docs/superpowers/specs/2026-08-30-remote-execution-cloud-sandbox-design.md`

## Global Constraints

- The backend authenticates every environment and user action with existing `get_current_user` semantics.
- An environment must connect outbound to the relay; no public host shell listener is introduced.
- Task state transitions and audit events are append-only.
- Task execution always starts from a resolved immutable git commit in a new worktree.
- Diff application is explicit, attempt-specific, and stops safely on conflicts.

---

### Task 1: Add backend persistence models, schemas, and migration

**Files:**
- Create: `pikaa-cli-backend/app/models/cloud_task.py`
- Create: `pikaa-cli-backend/app/schemas/cloud_task.py`
- Create: `pikaa-cli-backend/alembic/versions/<revision>_add_cloud_tasks.py`
- Modify: `pikaa-cli-backend/app/main.py`
- Modify: `pikaa-cli-backend/tests/conftest.py`
- Test: `pikaa-cli-backend/tests/test_cloud_task_models.py`

**Interfaces:**
- Produces SQLAlchemy models `CloudEnvironment`, `CloudTask`, `CloudTaskAttempt`, `CloudTaskArtifact`, and `CloudTaskAuditEvent`.
- Produces Pydantic request `CloudTaskCreate(prompt, environment_id, git_ref, sandbox, attempts, idempotency_key)` and response schemas.

- [ ] **Step 1: Write failing model lifecycle tests**

```py
def test_task_idempotency_returns_original_task(db, user):
    first = create_task(db, user.id, idempotency_key="a" * 36)
    second = create_task(db, user.id, idempotency_key="a" * 36)
    assert first.id == second.id
    assert first.status == "queued"

def test_invalid_task_transition_is_rejected(db, queued_task):
    with pytest.raises(ValueError, match="queued -> succeeded"):
        transition_task(db, queued_task, "succeeded")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_cloud_task_models.py -q`

Expected: FAIL because the models and task service do not exist.

- [ ] **Step 3: Implement schema and migration**

Create UUID string IDs, `owner_user_id` foreign keys, unique `(owner_user_id, idempotency_key)`, environment public-key fingerprint, environment status/last-seen timestamp, attempts numbered from one, artifacts with base commit/diff/log locations, and audit events containing actor, timestamp, event type, and redacted payload JSON. Import the models in `main.py` and `tests/conftest.py` before metadata creation. Make the Alembic revision depend on the repository's current head.

- [ ] **Step 4: Run test and migration verification**

Run: `uv run pytest tests/test_cloud_task_models.py -q`

Expected: PASS.

Run: `uv run alembic upgrade head`

Expected: schema upgrades without an orphaned revision.

- [ ] **Step 5: Commit in backend repository**

```bash
git add app/models/cloud_task.py app/schemas/cloud_task.py app/main.py tests/test_cloud_task_models.py alembic/versions
git commit -m "feat(cloud): add task and environment persistence"
```

### Task 2: Implement authenticated environment registration and relay authorization

**Files:**
- Create: `pikaa-cli-backend/app/api/endpoints/cloud_environments.py`
- Create: `pikaa-cli-backend/app/cloud/registration.py`
- Create: `pikaa-cli-backend/app/cloud/relay.py`
- Modify: `pikaa-cli-backend/app/api/routes.py`
- Modify: `pikaa-cli-backend/app/core/security.py`
- Test: `pikaa-cli-backend/tests/test_cloud_environments.py`

**Interfaces:**
- Produces `POST /api/cloud/environments/register`, `GET /api/cloud/environments`, and WebSocket `/api/cloud/relay/{environment_id}`.
- Registration returns a short-lived signed environment JWT with claims `sub`, `environment_id`, `fingerprint`, `aud="pikaa-exec-relay"`, and `exp`.

- [ ] **Step 1: Write failing registration and relay tests**

```py
def test_owner_can_register_environment_and_get_short_lived_token(client, auth_headers):
    response = client.post("/api/cloud/environments/register", headers=auth_headers, json={"name": "win-dev", "public_key": "ed25519:abc"})
    assert response.status_code == 201
    assert response.json()["relay_token"]

def test_relay_rejects_token_bound_to_different_environment(client, relay_token):
    with pytest.raises(WebSocketDisconnect):
        client.websocket_connect("/api/cloud/relay/other", headers={"Authorization": f"Bearer {relay_token}"})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_cloud_environments.py -q`

Expected: FAIL because routes and relay validation do not exist.

- [ ] **Step 3: Implement registration and bounded relay**

Reuse `get_current_user`; validate Ed25519 public-key format, rotate and hash registration secrets, create JWTs with a five-minute expiry, require TLS in non-testing configuration, apply origin allowlisting, cap frame sizes, rate-limit connection attempts, and forward opaque binary frames only to a verified connection for the same environment. Persist connect/disconnect/rejection events as audit events. Do not decode the inner JSON-RPC payload in the relay.

- [ ] **Step 4: Run focused test suite**

Run: `uv run pytest tests/test_cloud_environments.py -q`

Expected: PASS; include expired-token, cross-user environment, oversized-frame, and reconnect cases.

- [ ] **Step 5: Commit in backend repository**

```bash
git add app/api/endpoints/cloud_environments.py app/cloud app/api/routes.py app/core/security.py tests/test_cloud_environments.py
git commit -m "feat(cloud): register authenticated relay environments"
```

### Task 3: Add Groupy remote exec client and environment commands

**Files:**
- Create: `groupy/src/remote/environment-client.ts`
- Create: `groupy/src/remote/relay-client.ts`
- Create: `groupy/src/remote/index.ts`
- Modify: `groupy/src/cli/index.ts`
- Modify: `groupy/src/cli/commands.ts`
- Test: `groupy/tests/remote-environment.test.ts`

**Interfaces:**
- Produces `RemoteEnvironmentClient.register()`, `list()`, and `connectExec(environmentId)`.
- Adds `pikaa environments register`, `pikaa environments list`, and `pikaa exec-server --remote <url> --environment-id <id>`.

- [ ] **Step 1: Write failing remote client tests**

```ts
test("remote client does not send credential JSON in a relay payload", async () => {
  const transport = recordingTransport();
  await new RemoteEnvironmentClient({ transport, token: "secret" }).connectExec("env-1");
  expect(transport.frames.join("")).not.toContain("secret");
});

test("relay reconnect resumes output from its last sequence cursor", async () => {
  const client = reconnectingClient([{ nextSeq: 2 }, { chunks: [{ seq: 2, data: "later" }] }]);
  expect(await client.read("process-1")).toEqual("later");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/remote-environment.test.ts`

Expected: FAIL because the remote package does not exist.

- [ ] **Step 3: Implement authenticated client**

Use HTTPS for registration/list, retain tokens in the platform credential adapter, perform relay handshake before forwarding the Task 1 exec protocol, authenticate the control connection but encrypt/authenticate end-to-end frames, and expose typed `EnvironmentOffline`, `RelayRejected`, and `RemoteSessionExpired` errors. Store only an environment ID and public metadata in Groupy's SQLite thread data.

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/remote-environment.test.ts`

Expected: PASS; include invalid certificate configuration, expired registration token, and no duplicate process start after reconnect.

- [ ] **Step 5: Commit in Groupy repository**

```bash
git add src/remote src/cli tests/remote-environment.test.ts
git commit -m "feat(remote): connect authenticated exec environments"
```

### Task 4: Implement cloud task API, state machine, and artifact publication

**Files:**
- Create: `pikaa-cli-backend/app/api/endpoints/cloud_tasks.py`
- Create: `pikaa-cli-backend/app/cloud/tasks.py`
- Create: `pikaa-cli-backend/app/cloud/task_worker.py`
- Modify: `pikaa-cli-backend/app/api/routes.py`
- Test: `pikaa-cli-backend/tests/test_cloud_tasks.py`

**Interfaces:**
- Produces create/list/read/diff/apply endpoints and `CloudTaskService.transition(task, to_status, actor, detail)`.
- `CloudTaskWorker.run(task_id)` leases a queued task and produces immutable attempt artifacts.

- [ ] **Step 1: Write failing API tests**

```py
def test_user_can_create_list_and_read_own_cloud_task(client, auth_headers, environment):
    created = client.post("/api/cloud/tasks", headers=auth_headers, json={"prompt": "add test", "environment_id": environment.id, "git_ref": "main", "sandbox": "workspace-write", "attempts": 1, "idempotency_key": "b" * 36})
    assert created.status_code == 201
    assert client.get(f"/api/cloud/tasks/{created.json()['id']}", headers=auth_headers).json()["status"] == "queued"

def test_task_diff_is_not_available_before_successful_attempt(client, auth_headers, task):
    assert client.get(f"/api/cloud/tasks/{task.id}/diff", headers=auth_headers).status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_cloud_tasks.py -q`

Expected: FAIL because routes and worker do not exist.

- [ ] **Step 3: Implement state machine and worker**

Authorize owner access on every endpoint. On worker lease, transition `queued -> provisioning -> running`, resolve `git_ref` to a commit using a fixed argv Git invocation, create a worktree, request a `workspace-write` remote exec session, run one agent attempt per allowed attempt count, collect capped logs and `git diff --binary <base>`, publish `TaskArtifact`, then transition to `succeeded` or `failed`. Use database transaction/row locking for leasing. On cancellation or error, kill the remote session and delete only the exact created worktree after its audit record and artifacts are durable.

- [ ] **Step 4: Run API and worker tests**

Run: `uv run pytest tests/test_cloud_tasks.py -q`

Expected: PASS; include state-transition rejection, cross-user 404, idempotency, worker crash recovery, artifact redaction, and worktree cleanup.

- [ ] **Step 5: Commit in backend repository**

```bash
git add app/api/endpoints/cloud_tasks.py app/cloud/tasks.py app/cloud/task_worker.py app/api/routes.py tests/test_cloud_tasks.py
git commit -m "feat(cloud): execute and publish isolated agent tasks"
```

### Task 5: Add Groupy cloud CLI commands and explicit diff/apply

**Files:**
- Create: `groupy/src/cloud/client.ts`
- Create: `groupy/src/cloud/commands.ts`
- Create: `groupy/src/cloud/index.ts`
- Modify: `groupy/src/cli/index.ts`
- Modify: `groupy/src/cli/commands.ts`
- Test: `groupy/tests/cloud-commands.test.ts`

**Interfaces:**
- Produces `pikaa cloud exec`, `pikaa cloud list`, `pikaa cloud status`, `pikaa cloud diff`, and `pikaa cloud apply`.
- `CloudTaskClient.apply(taskId, attempt)` calls the backend only after `promptChoice` returns confirmation for the printed diff digest.

- [ ] **Step 1: Write failing explicit-apply tests**

```ts
test("cloud apply does not invoke backend before the user confirms the displayed diff digest", async () => {
  const client = recordingCloudClient();
  await runCloudApply({ client, confirm: async () => false, taskId: "task-1", attempt: 1 });
  expect(client.applyCalls).toBe(0);
});

test("cloud status returns the backend terminal failure without masking it", async () => {
  await expect(runCloudStatus(failingCloudClient("sandbox unavailable"), "task-1")).rejects.toThrow("sandbox unavailable");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cloud-commands.test.ts`

Expected: FAIL because cloud commands do not exist.

- [ ] **Step 3: Implement HTTP client and commands**

Use the existing Groupy credentials provider, send idempotency UUIDs on create, display only redacted statuses/log metadata, render unified diff before approval, compute and show its SHA-256 digest, require typed confirmation containing the selected attempt number, and surface merge conflict as a terminal error without retrying apply.

- [ ] **Step 4: Run focused tests**

Run: `bun test tests/cloud-commands.test.ts`

Expected: PASS; include pagination cursor, offline environment, cancelled task, multiple attempts, unconfirmed apply, and merge conflict.

- [ ] **Step 5: Commit in Groupy repository**

```bash
git add src/cloud src/cli tests/cloud-commands.test.ts
git commit -m "feat(cloud): manage remote agent tasks from CLI"
```

### Task 6: Run end-to-end verification and document deployment boundary

**Files:**
- Modify: `groupy/README.md`
- Modify: `pikaa-cli-backend/README.md`
- Modify: `pikaa-cli-backend/docker-compose.yml`
- Test: `pikaa-cli-backend/tests/test_cloud_task_e2e.py`
- Test: `groupy/tests/cloud-e2e.test.ts`

**Interfaces:**
- Produces a documented local development topology: backend, relay, authenticated exec-server, and CLI.

- [ ] **Step 1: Write a failing end-to-end test**

```py
def test_cloud_task_runs_only_in_registered_environment_and_publishes_diff(e2e):
    task = e2e.create_task(environment="registered-env", prompt="write marker")
    result = e2e.wait_for_terminal(task.id)
    assert result.status == "succeeded"
    assert "marker" in e2e.diff(task.id, attempt=1)
```

- [ ] **Step 2: Run test to verify it fails before integration**

Run: `uv run pytest tests/test_cloud_task_e2e.py -q`

Expected: FAIL until backend, relay, worker, and exec-server are wired together.

- [ ] **Step 3: Add reproducible local topology**

Add backend/relay configuration with TLS development certificates, no plaintext secret logging, startup health checks, environment registration steps, and explicit production requirements for managed TLS, durable database, background worker, and native sandbox binaries.

- [ ] **Step 4: Run complete verification**

Run: `uv run pytest -q`

Expected: backend test suite passes.

Run: `bun test --timeout 30000`

Expected: Groupy test suite passes.

Run: `bunx tsc --noEmit`

Expected: Groupy typecheck exits 0.

- [ ] **Step 5: Commit documentation and integration tests in their owning repositories**

```bash
git add README.md docker-compose.yml tests/test_cloud_task_e2e.py
git commit -m "docs(cloud): document remote task deployment"
```
