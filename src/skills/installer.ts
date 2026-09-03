/**
 * Skill Installer Subsystem for Pikaa / Groupy CLI.
 * Fetches domain skill specifications from the backend catalog (or registry)
 * and installs SKILL.md into the local workspace (.agents/skills/<name>/SKILL.md)
 * or global directory (~/.pikaa/skills/<name>/SKILL.md).
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { getGlobalSkillsDir } from "../config/paths";
import { CredentialsStore } from "../auth/store";

export interface SkillInstallOptions {
  cwd: string;
  global?: boolean;
  backendUrl?: string;
}

export interface SkillInstallResult {
  success: boolean;
  skillName: string;
  title: string;
  targetPath: string;
  scope: "workspace" | "global";
  message: string;
}

/**
 * Downloads and installs a skill from the backend catalog into .agents/skills or ~/.pikaa/skills.
 */
export async function installSkill(
  skillName: string,
  options: SkillInstallOptions
): Promise<SkillInstallResult> {
  const cleanName = skillName.trim().toLowerCase().replace(/^@/, "");
  if (!cleanName) {
    throw new Error("Skill name cannot be empty.");
  }

  const credStore = new CredentialsStore();
  const creds = credStore.load();
  let backend = (
    options.backendUrl ||
    process.env.PIKAA_BACKEND_URL ||
    process.env.GROUPY_BACKEND_URL ||
    creds?.baseUrl ||
    "https://api.groupy-hub.store"
  ).replace(/\/+$/, "");

  if (backend.endsWith("/v1")) {
    backend = backend.slice(0, -3).replace(/\/+$/, "");
  }

  // 1. Fetch from backend API
  const endpoint = `${backend}/api/skills/${encodeURIComponent(cleanName)}`;
  let resp: Response;
  try {
    resp = await fetch(endpoint, {
      headers: creds?.accessToken ? { Authorization: `Bearer ${creds.accessToken}` } : {},
    });
  } catch (netErr: any) {
    throw new Error(`Failed to connect to backend at ${backend}: ${netErr.message}`);
  }

  if (!resp.ok) {
    if (resp.status === 404) {
      throw new Error(`Skill '${cleanName}' not found in catalog (${endpoint}).`);
    }
    const errText = await resp.text();
    throw new Error(`Backend error (${resp.status}): ${errText}`);
  }

  const skillData = (await resp.json()) as {
    name: string;
    title: string;
    description?: string;
    content: string;
  };

  if (!skillData.content) {
    throw new Error(`Skill '${cleanName}' does not contain markdown content.`);
  }

  // 2. Determine target path
  const scope: "workspace" | "global" = options.global ? "global" : "workspace";
  const targetDir = options.global
    ? resolve(getGlobalSkillsDir(), cleanName)
    : resolve(options.cwd, ".agents", "skills", cleanName);

  mkdirSync(targetDir, { recursive: true });
  const targetFile = join(targetDir, "SKILL.md");

  // If content does not already include frontmatter, prepend frontmatter
  let fileContent = skillData.content;
  if (!fileContent.startsWith("---")) {
    const desc = skillData.description ? `description: "${skillData.description.replace(/"/g, '\\"')}"\n` : "";
    fileContent = `---\nname: ${cleanName}\n${desc}---\n\n${fileContent}`;
  }

  writeFileSync(targetFile, fileContent, "utf-8");

  return {
    success: true,
    skillName: cleanName,
    title: skillData.title || cleanName,
    targetPath: targetFile,
    scope,
    message: `Installed skill '${skillData.title || cleanName}' (@${cleanName}) into ${scope} at ${targetFile}`,
  };
}

/**
 * Removes an installed skill from the local workspace or global directory.
 */
export function removeSkill(
  skillName: string,
  options: { cwd: string; global?: boolean }
): { success: boolean; targetDir: string; removed: boolean } {
  const cleanName = skillName.trim().toLowerCase().replace(/^@/, "");
  const targetDir = options.global
    ? resolve(getGlobalSkillsDir(), cleanName)
    : resolve(options.cwd, ".agents", "skills", cleanName);

  if (!existsSync(targetDir)) {
    return { success: false, targetDir, removed: false };
  }

  rmSync(targetDir, { recursive: true, force: true });
  return { success: true, targetDir, removed: true };
}
