import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
}

let cachedMetadata: PackageMetadata | null = null;

/**
 * Automatically discovers and resolves package version and metadata from package.json
 * searching upward from the current module location and process working directory.
 */
export function getPackageMetadata(): PackageMetadata {
  if (cachedMetadata) {
    return cachedMetadata;
  }

  // 1. Check environment variable overrides (only explicit PIKAA/GROUPY variables, never npm_package_*)
  const envVersion = process.env.PIKAA_VERSION || process.env.GROUPY_VERSION;
  const envName = process.env.PIKAA_NAME || process.env.GROUPY_NAME;

  if (envVersion) {
    cachedMetadata = {
      name: envName || "pikaa",
      version: envVersion,
    };
    return cachedMetadata;
  }

  // 2. Resolve starting directories to search upwards (CLI module location first)
  const searchDirs: string[] = [];

  try {
    const currentDir = typeof __dirname !== "undefined"
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
    searchDirs.push(currentDir);
  } catch {
    // Ignore URL resolution errors in bundled environments
  }

  for (const startDir of searchDirs) {
    let current = resolve(startDir);
    for (let depth = 0; depth < 5; depth++) {
      const candidate = join(current, "package.json");
      if (existsSync(candidate)) {
        try {
          const content = JSON.parse(readFileSync(candidate, "utf8"));
          if (
            content &&
            typeof content.version === "string" &&
            (content.name === "@pikaa-ai/pikaa" ||
             content.name === "pikaa" ||
             content.bin?.pikaa ||
             content.bin?.groupy)
          ) {
            const cleanName = content.name?.startsWith("@")
              ? content.name.split("/")[1] || content.name
              : content.name || "pikaa";

            cachedMetadata = {
              name: cleanName,
              version: content.version,
              description: content.description,
            };
            return cachedMetadata;
          }
        } catch {
          // Continue searching if JSON parsing fails
        }
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  // 3. Check process.cwd() ONLY if it is the groupy/pikaa repo itself
  try {
    const cwdCandidate = join(process.cwd(), "package.json");
    if (existsSync(cwdCandidate)) {
      const content = JSON.parse(readFileSync(cwdCandidate, "utf8"));
      if (
        content &&
        typeof content.version === "string" &&
        (content.name === "@pikaa-ai/pikaa" ||
         content.name === "pikaa" ||
         content.bin?.pikaa ||
         content.bin?.groupy)
      ) {
        cachedMetadata = {
          name: "pikaa",
          version: content.version,
          description: content.description,
        };
        return cachedMetadata;
      }
    }
  } catch {}

  // 4. Safe fallback if running in standalone binary where package.json is absent
  cachedMetadata = {
    name: "pikaa",
    version: "0.3.5",
  };
  return cachedMetadata;
}

/**
 * Returns the auto-detected version string (e.g. "0.2.5" or "v0.2.5")
 */
export function getCliVersion(options: { prefix?: boolean } = {}): string {
  const meta = getPackageMetadata();
  const rawVersion = meta.version.replace(/^v/, "");
  return options.prefix ? `v${rawVersion}` : rawVersion;
}
