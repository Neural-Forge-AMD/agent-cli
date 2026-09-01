/**
 * CredentialsStore - Securely persists and retrieves JWT auth tokens across CLI sessions.
 * Saved to ~/.groupy/credentials.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AuthCredentials } from "./types";
import { getCredentialsPath } from "../config/paths";

export class CredentialsStore {
  private filePath: string;

  constructor(customPath?: string) {
    this.filePath = customPath || getCredentialsPath();
  }

  load(): AuthCredentials | null {
    if (!existsSync(this.filePath)) return null;

    try {
      const raw = readFileSync(this.filePath, "utf8");
      const creds = JSON.parse(raw) as AuthCredentials;

      // Automatically decode user metadata from idToken if user block is missing
      if (creds && creds.idToken && (!creds.user || !creds.user.username)) {
        try {
          const parts = creds.idToken.split(".");
          if (parts[1]) {
            const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
            creds.user = {
              ...creds.user,
              id: creds.user?.id || payload.sub,
              email: creds.user?.email || payload.email || payload["https://api.openai.com/profile"]?.email,
              username: creds.user?.username || payload.preferred_username || payload.username || payload.name || (payload.email ? payload.email.split("@")[0] : undefined),
              role: creds.user?.role || payload.role,
              plan: creds.user?.plan || payload["https://api.openai.com/auth"]?.chatgpt_plan_type || payload.plan || payload.tier,
            };
          }
        } catch {}
      }

      return creds;
    } catch {
      return null;
    }
  }

  getUser(): { username?: string; email?: string; plan?: string; role?: string } | undefined {
    const creds = this.load();
    return creds?.user;
  }

  save(credentials: AuthCredentials): void {
    const dir = resolve(this.filePath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(this.filePath, JSON.stringify(credentials, null, 2), "utf8");
  }

  clear(): boolean {
    if (existsSync(this.filePath)) {
      try {
        unlinkSync(this.filePath);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  getAccessToken(): string | undefined {
    const creds = this.load();
    return creds?.accessToken;
  }

  getBaseUrl(): string | undefined {
    const creds = this.load();
    return creds?.baseUrl;
  }

  getDefaultModel(): string | undefined {
    const creds = this.load();
    return creds?.defaultModel || creds?.model;
  }

  setDefaultModel(model: string): void {
    const existing = this.load() || { accessToken: "" };
    existing.defaultModel = model;
    existing.model = model;
    this.save(existing);
  }
}
