/**
 * Centralized Path Configuration & Legacy Migration Subsystem.
 * 
 * Canonical Global Directory: ~/.pikaa
 * Automatically migrates legacy ~/.groupy configuration and database files to ~/.pikaa.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

/**
 * Returns the canonical global home directory for Pikaa CLI.
 * Precedence: PIKAA_HOME -> GROUPY_HOME -> ~/.pikaa
 */
export function getPikaaHomeDir(): string {
  const envDir = process.env.PIKAA_HOME || process.env.GROUPY_HOME;
  if (envDir) {
    return resolve(envDir);
  }
  return resolve(homedir(), ".pikaa");
}

/**
 * Returns legacy ~/.groupy home directory.
 */
export function getLegacyGroupyHomeDir(): string {
  if (process.env.GROUPY_HOME) {
    return resolve(process.env.GROUPY_HOME);
  }
  return resolve(homedir(), ".groupy");
}

let hasMigrated = false;

/**
 * Recursively copies directory contents if destination does not exist.
 */
function copyDirRecursiveSync(src: string, dest: string): void {
  if (!existsSync(src)) return;
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);
  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      copyDirRecursiveSync(srcPath, destPath);
    } else if (!existsSync(destPath)) {
      try {
        copyFileSync(srcPath, destPath);
      } catch {}
    }
  }
}

/**
 * Automatically and safely migrates legacy ~/.groupy assets to ~/.pikaa.
 */
export function ensurePikaaHomeMigrated(force = false): string {
  const pikaaHome = getPikaaHomeDir();
  const legacyHome = getLegacyGroupyHomeDir();

  try {
    if (!existsSync(pikaaHome)) {
      mkdirSync(pikaaHome, { recursive: true });
    }
  } catch {}

  if (hasMigrated && !force) {
    return pikaaHome;
  }
  hasMigrated = true;

  try {

    if (existsSync(legacyHome) && legacyHome !== pikaaHome) {
      // 1. Migrate credentials.json
      const legacyCreds = join(legacyHome, "credentials.json");
      const pikaaCreds = join(pikaaHome, "credentials.json");
      if (existsSync(legacyCreds) && !existsSync(pikaaCreds)) {
        copyFileSync(legacyCreds, pikaaCreds);
      }

      // 2. Migrate threads database (groupy_threads.db -> pikaa_threads.db)
      const legacyThreads = join(legacyHome, "groupy_threads.db");
      const pikaaThreads = join(pikaaHome, "pikaa_threads.db");
      if (existsSync(legacyThreads) && !existsSync(pikaaThreads)) {
        copyFileSync(legacyThreads, pikaaThreads);
      }

      // 3. Migrate prefix rules database (groupy_rules.db -> pikaa_rules.db)
      const legacyRules = join(legacyHome, "groupy_rules.db");
      const pikaaRules = join(pikaaHome, "pikaa_rules.db");
      if (existsSync(legacyRules) && !existsSync(pikaaRules)) {
        copyFileSync(legacyRules, pikaaRules);
      }

      // 4. Migrate agent_graph.db
      const legacyGraph = join(legacyHome, "agent_graph.db");
      const pikaaGraph = join(pikaaHome, "agent_graph.db");
      if (existsSync(legacyGraph) && !existsSync(pikaaGraph)) {
        copyFileSync(legacyGraph, pikaaGraph);
      }

      // 5. Migrate memories.md
      const legacyMemories = join(legacyHome, "memories.md");
      const pikaaMemories = join(pikaaHome, "memories.md");
      if (existsSync(legacyMemories) && !existsSync(pikaaMemories)) {
        copyFileSync(legacyMemories, pikaaMemories);
      }

      // 6. Migrate skills & templates directories
      copyDirRecursiveSync(join(legacyHome, "skills"), join(pikaaHome, "skills"));
      copyDirRecursiveSync(join(legacyHome, "templates"), join(pikaaHome, "templates"));
    }
  } catch {
    // Non-fatal if permission issues occur
  }

  return pikaaHome;
}

// Canonical file and directory helpers
export function getCredentialsPath(): string {
  ensurePikaaHomeMigrated();
  return join(getPikaaHomeDir(), "credentials.json");
}

export function getThreadsDbPath(): string {
  ensurePikaaHomeMigrated();
  return join(getPikaaHomeDir(), "pikaa_threads.db");
}

export function getPrefixRulesDbPath(): string {
  ensurePikaaHomeMigrated();
  return join(getPikaaHomeDir(), "pikaa_rules.db");
}

export function getAgentGraphDbPath(): string {
  ensurePikaaHomeMigrated();
  return join(getPikaaHomeDir(), "agent_graph.db");
}

export function getGlobalSkillsDir(): string {
  ensurePikaaHomeMigrated();
  return join(getPikaaHomeDir(), "skills");
}

export function getGlobalTemplatesDir(): string {
  ensurePikaaHomeMigrated();
  return join(getPikaaHomeDir(), "templates");
}

export function getGlobalMemoriesPath(): string {
  ensurePikaaHomeMigrated();
  return join(getPikaaHomeDir(), "memories.md");
}

export function getProjectsDir(): string {
  ensurePikaaHomeMigrated();
  const dir = join(getPikaaHomeDir(), "projects");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {}
  }
  return dir;
}
