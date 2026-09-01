import packageJson from "../../package.json";

export interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
}

let cachedMetadata: PackageMetadata | null = null;

/**
 * Automatically discovers and resolves package version and metadata from package.json
 * embedded dynamically at build time, with optional environment variable overrides.
 */
export function getPackageMetadata(): PackageMetadata {
  if (cachedMetadata) {
    return cachedMetadata;
  }

  // 1. Check environment variable overrides (only explicit PIKAA/GROUPY variables, never ambient npm_package_*)
  const envVersion = process.env.PIKAA_VERSION || process.env.GROUPY_VERSION;
  const envName = process.env.PIKAA_NAME || process.env.GROUPY_NAME;

  const rawName = packageJson?.name || "pikaa";
  const cleanName = rawName.startsWith("@")
    ? rawName.split("/")[1] || rawName
    : rawName;

  const autoVersion = (packageJson && typeof packageJson.version === "string")
    ? packageJson.version
    : "0.0.0";

  cachedMetadata = {
    name: envName || cleanName,
    version: envVersion || autoVersion,
    description: packageJson?.description,
  };

  return cachedMetadata;
}

/**
 * Returns the auto-detected version string (e.g. "0.3.8" or "v0.3.8")
 */
export function getCliVersion(options: { prefix?: boolean } = {}): string {
  const meta = getPackageMetadata();
  const rawVersion = meta.version.replace(/^v/, "");
  return options.prefix ? `v${rawVersion}` : rawVersion;
}
