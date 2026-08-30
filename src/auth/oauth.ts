/**
 * OAuth 2.0 PKCE & Direct Authentication Flow for Groupy CLI with pikaa-cli-backend.
 */

import { randomBytes, createHash } from "node:crypto";
import { exec } from "node:child_process";
import type { AuthCredentials, DirectLoginParams, OAuthLoginOptions } from "./types";
import { CredentialsStore } from "./store";

export class AuthClient {
  private store: CredentialsStore;

  constructor(customStore?: CredentialsStore) {
    this.store = customStore || new CredentialsStore();
  }

  /**
   * Direct login using Email/Username and Password
   */
  async directLogin(params: DirectLoginParams): Promise<AuthCredentials> {
    const backendUrl = (params.backendUrl || process.env.GROUPY_BACKEND_URL || "https://api.groupy-hub.store").replace(/\/+$/, "");

    const formData = new URLSearchParams({
      username: params.emailOrUsername,
      password: params.password,
    });

    const res = await fetch(`${backendUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    if (!res.ok) {
      let errDetail = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        errDetail = data.detail || JSON.stringify(data);
      } catch {}
      throw new Error(`Login failed: ${errDetail}`);
    }

    const data = await res.json();
    const creds: AuthCredentials = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenType: data.token_type || "Bearer",
      baseUrl: `${backendUrl}/v1`,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };

    this.store.save(creds);
    return creds;
  }

  /**
   * Interactive OAuth 2.0 Authorization Code Flow with PKCE
   */
  async startOAuthFlow(options: OAuthLoginOptions = {}): Promise<{
    authUrl: string;
    waitForToken: () => Promise<AuthCredentials>;
  }> {
    const backendUrl = (options.backendUrl || process.env.GROUPY_BACKEND_URL || "https://api.groupy-hub.store").replace(/\/+$/, "");
    const port = options.port || 1455;
    const redirectUri = `http://localhost:${port}/auth/callback`;
    const timeoutMs = options.timeoutMs || 180000;

    // 1. Generate PKCE pair
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const state = randomBytes(16).toString("hex");

    const authUrl = `${backendUrl}/api/auth/authorize?response_type=code&client_id=groupy-cli&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256&state=${state}&direct=1`;

    let serverResolve: (code: string) => void;
    let serverReject: (err: Error) => void;

    const codePromise = new Promise<string>((resolve, reject) => {
      serverResolve = resolve;
      serverReject = reject;
    });

    // Automatically open browser on supported platforms
    if (options.openBrowser !== false) {
      try {
        const startCmd = process.platform === "win32" ? `start "" "${authUrl}"` : process.platform === "darwin" ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
        exec(startCmd);
      } catch {}
    }

    // 2. Start lightweight local callback HTTP server
    let server: any;
    try {
      server = Bun.serve({
        port,
        fetch: async (req) => {
          const url = new URL(req.url);

          if (url.pathname === "/auth/callback") {
            const code = url.searchParams.get("code");
            const error = url.searchParams.get("error");

            if (error) {
              serverReject(new Error(`OAuth authorization error: ${error}`));
              return new Response(
                "<h1>Authentication Failed</h1><p>You can close this window and return to your terminal.</p>",
                { headers: { "Content-Type": "text/html" } }
              );
            }

            if (!code) {
              serverReject(new Error("No authorization code returned"));
              return new Response(
                "<h1>Missing Code</h1><p>Authorization code was missing.</p>",
                { headers: { "Content-Type": "text/html" } }
              );
            }

            serverResolve(code);

            return new Response(
              `<!DOCTYPE html>
              <html>
                <head>
                  <title>Groupy CLI - Authenticated</title>
                  <style>
                    body { font-family: -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    .box { background: #1e293b; padding: 32px 48px; border-radius: 16px; text-align: center; border: 1px solid #334155; }
                    h1 { color: #d97757; margin-bottom: 8px; font-size: 24px; }
                    p { color: #94a3b8; font-size: 14px; }
                  </style>
                </head>
                <body>
                  <div class="box">
                    <h1>Authentication Successful!</h1>
                    <p>You have successfully logged in to Groupy CLI. You can close this window and return to your terminal.</p>
                  </div>
                </body>
              </html>`,
              { headers: { "Content-Type": "text/html" } }
            );
          }

          return new Response("Not found", { status: 404 });
        },
      });
    } catch (err) {
      throw new Error(`Failed to start local callback server on port ${port}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const waitForToken = async (): Promise<AuthCredentials> => {
      try {
        const timeoutTimer = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("OAuth login timed out after 3 minutes.")), timeoutMs);
        });

        const authorizationCode = await Promise.race([codePromise, timeoutTimer]);

        // 3. Exchange code for access token with PKCE verification
        const tokenRes = await fetch(`${backendUrl}/api/auth/token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code: authorizationCode,
            redirect_uri: redirectUri,
            client_id: "groupy-cli",
            code_verifier: codeVerifier,
          }).toString(),
        });

        if (!tokenRes.ok) {
          let detail = `HTTP ${tokenRes.status}`;
          try {
            const data = await tokenRes.json();
            detail = data.detail?.error_description || data.detail || JSON.stringify(data);
          } catch {}
          throw new Error(`Failed to exchange token: ${detail}`);
        }

        const tokenData = await tokenRes.json();
        const credentials: AuthCredentials = {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          idToken: tokenData.id_token,
          tokenType: tokenData.token_type || "Bearer",
          baseUrl: `${backendUrl}/v1`,
          expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
        };

        this.store.save(credentials);
        return credentials;
      } finally {
        if (server) {
          server.stop();
        }
      }
    };

    return { authUrl, waitForToken };
  }

  private generateCodeVerifier(): string {
    return randomBytes(32)
      .toString("base64url")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 64);
  }

  private generateCodeChallenge(verifier: string): string {
    return createHash("sha256")
      .update(verifier)
      .digest("base64url");
  }
}
