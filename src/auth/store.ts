/**
 * CredentialsStore - Securely persists and retrieves JWT auth tokens across CLI sessions.
 * Saved to ~/.groupy/credentials.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { AuthCredentials } from "./types";

export class CredentialsStore {
  private filePath: string;

  constructor(customPath?: string) {
    this.filePath = customPath || resolve(homedir(), ".groupy", "credentials.json");
  }

  load(): AuthCredentials | null {
    if (!existsSync(this.filePath)) return null;

    try {
      const raw = readFileSync(this.filePath, "utf8");
      return JSON.parse(raw) as AuthCredentials;
    } catch {
      return null;
    }
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
}
