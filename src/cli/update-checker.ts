import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPackageMetadata } from "./version";

export interface UpdateInfo {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  packageName: string;
}

export interface UpdateCacheData {
  lastChecked: number;
  latestVersion: string;
  packageName: string;
}

const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

/**
 * Parses semantic version string into [major, minor, patch] numbers.
 */
export function parseSemver(v: string): [number, number, number] {
  const clean = v.replace(/^v/, "").trim();
  const parts = clean.split(".").map((p) => parseInt(p, 10) || 0);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Returns true if remote version is strictly greater than current version.
 */
export function isNewerVersion(current: string, remote: string): boolean {
  const [curMajor, curMinor, curPatch] = parseSemver(current);
  const [remMajor, remMinor, remPatch] = parseSemver(remote);

  if (remMajor > curMajor) return true;
  if (remMajor < curMajor) return false;

  if (remMinor > curMinor) return true;
  if (remMinor < curMinor) return false;

  return remPatch > curPatch;
}

/**
 * Resolves directory path for CLI update cache file.
 */
export function getUpdateCachePath(): string {
  const baseDir = process.env.PIKAA_HOME || process.env.GROUPY_HOME || join(homedir(), ".pikaa");
  return join(baseDir, "update-cache.json");
}

/**
 * Fetches the latest published version from NPM registry with an aggressive timeout.
 */
export async function fetchLatestNpmVersion(
  packageName: string,
  timeoutMs = 1500
): Promise<string | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "pikaa-update-checker",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;
    const data = (await response.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    // Offline, timeout, or DNS resolution failure - fail silently
    return null;
  }
}

/**
 * Checks for updates using local cache or background registry query.
 */
export async function checkForUpdates(options: {
  currentVersion?: string;
  packageName?: string;
  force?: boolean;
  timeoutMs?: number;
  cachePath?: string;
} = {}): Promise<UpdateInfo | null> {
  // If explicitly disabled via environment variable or in CI without explicit test options
  if (process.env.PIKAA_NO_UPDATE_CHECK === "1" || (process.env.CI && !options.cachePath && !options.force)) {
    return null;
  }

  const meta = getPackageMetadata();
  const currentVersion = options.currentVersion || meta.version;
  const packageName = options.packageName || (meta.name.startsWith("@") ? meta.name : `@pikaa-ai/${meta.name}`);
  const cachePath = options.cachePath || getUpdateCachePath();

  const now = Date.now();
  let cached: UpdateCacheData | null = null;

  // 1. Check existing cache
  if (!options.force && existsSync(cachePath)) {
    try {
      const raw = JSON.parse(readFileSync(cachePath, "utf8")) as UpdateCacheData;
      if (raw && typeof raw.lastChecked === "number" && typeof raw.latestVersion === "string") {
        cached = raw;
        // If cached within interval, return cached result immediately
        if (now - cached.lastChecked < CHECK_INTERVAL_MS) {
          const hasUpdate = isNewerVersion(currentVersion, cached.latestVersion);
          return hasUpdate
            ? {
                updateAvailable: true,
                currentVersion,
                latestVersion: cached.latestVersion,
                packageName,
              }
            : null;
        }
      }
    } catch {
      // Ignore cache corruption
    }
  }

  // 2. Fetch from registry
  const latestVersion = await fetchLatestNpmVersion(packageName, options.timeoutMs);
  if (!latestVersion) {
    // If fetch failed but we have valid cache, use cached version
    if (cached && isNewerVersion(currentVersion, cached.latestVersion)) {
      return {
        updateAvailable: true,
        currentVersion,
        latestVersion: cached.latestVersion,
        packageName,
      };
    }
    return null;
  }

  // 3. Save cache
  try {
    const parentDir = join(cachePath, "..");
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    const cacheData: UpdateCacheData = {
      lastChecked: now,
      latestVersion,
      packageName,
    };
    writeFileSync(cachePath, JSON.stringify(cacheData, null, 2), "utf8");
  } catch {
    // Ignore cache write error (e.g. read-only filesystem)
  }

  const updateAvailable = isNewerVersion(currentVersion, latestVersion);
  return updateAvailable
    ? {
        updateAvailable: true,
        currentVersion,
        latestVersion,
        packageName,
      }
    : null;
}
