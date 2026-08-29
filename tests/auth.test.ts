import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { rmSync, existsSync } from "node:fs";
import {
  CredentialsStore,
  AuthClient,
  ModelClient,
  type AuthCredentials,
} from "../src";

describe("Authentication & Token Management (pikaa-cli-backend integration)", () => {
  let testCredsPath: string;
  let store: CredentialsStore;

  beforeEach(() => {
    testCredsPath = resolve(tmpdir(), `groupy-auth-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.json`);
    store = new CredentialsStore(testCredsPath);
  });

  afterEach(() => {
    try {
      if (existsSync(testCredsPath)) {
        rmSync(testCredsPath, { force: true });
      }
    } catch {}
  });

  test("CredentialsStore saves, loads, and clears authentication tokens", () => {
    expect(store.load()).toBeNull();

    const sampleCreds: AuthCredentials = {
      accessToken: "jwt_token_sample_12345",
      refreshToken: "refresh_token_67890",
      tokenType: "Bearer",
      baseUrl: "http://localhost:8090/v1",
      expiresAt: Date.now() + 3600 * 1000,
      user: {
        id: "usr_001",
        email: "dev@mesosfer.ai",
        username: "mesosfer_dev",
        role: "admin",
      },
    };

    store.save(sampleCreds);

    const loaded = store.load();
    expect(loaded).toBeDefined();
    expect(loaded?.accessToken).toBe("jwt_token_sample_12345");
    expect(loaded?.baseUrl).toBe("http://localhost:8090/v1");
    expect(loaded?.user?.email).toBe("dev@mesosfer.ai");

    expect(store.getAccessToken()).toBe("jwt_token_sample_12345");
    expect(store.getBaseUrl()).toBe("http://localhost:8090/v1");

    store.clear();
    expect(store.load()).toBeNull();
  });

  test("ModelClient reads stored credentials from CredentialsStore", () => {
    store.save({
      accessToken: "auto_discovered_jwt_token",
      baseUrl: "http://127.0.0.1:8090/v1",
    });

    const client = new ModelClient();
    const session = client.newSession();
    expect(session).toBeDefined();
  });

  test("AuthClient generates PKCE URL and captures authorization callback", async () => {
    const authClient = new AuthClient(store);
    const port = 1459; // Use unique test port

    // Mock backend for OAuth token exchange
    const mockBackend = Bun.serve({
      port: 8099,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname === "/api/auth/token") {
          const body = await req.text();
          const params = new URLSearchParams(body);
          if (params.get("code") === "valid_mock_code") {
            return new Response(
              JSON.stringify({
                access_token: "mock_jwt_access_token_xyz",
                refresh_token: "mock_refresh_token_xyz",
                token_type: "Bearer",
                expires_in: 3600,
              }),
              { headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(JSON.stringify({ detail: "invalid_grant" }), { status: 400 });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    try {
      const { authUrl, waitForToken } = await authClient.startOAuthFlow({
        backendUrl: "http://localhost:8099",
        port,
        timeoutMs: 5000,
      });

      expect(authUrl).toContain("http://localhost:8099/api/auth/authorize");
      expect(authUrl).toContain("response_type=code");
      expect(authUrl).toContain("code_challenge=");
      expect(authUrl).toContain("code_challenge_method=S256");

      // Extract state parameter
      const parsedUrl = new URL(authUrl);
      const state = parsedUrl.searchParams.get("state");

      // Simulate browser callback hitting local redirect server
      const callbackPromise = fetch(`http://localhost:${port}/auth/callback?code=valid_mock_code&state=${state}`);

      const [creds, callbackRes] = await Promise.all([waitForToken(), callbackPromise]);

      expect(callbackRes.status).toBe(200);
      expect(creds.accessToken).toBe("mock_jwt_access_token_xyz");
      expect(creds.baseUrl).toBe("http://localhost:8099/v1");

      // Verify token was persisted in store
      expect(store.getAccessToken()).toBe("mock_jwt_access_token_xyz");
    } finally {
      mockBackend.stop();
    }
  });
});
