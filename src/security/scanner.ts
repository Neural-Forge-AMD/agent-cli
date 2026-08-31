/**
 * Static Security & Vulnerability Scanner for Groupy CLI (inspired by Strix).
 * Scans codebases for exposed secrets, OWASP Top 10 vulnerabilities,
 * dangerous execution sinks, and insecure configurations.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export type FindingSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface SecurityFinding {
  id: string;
  category: string;
  severity: FindingSeverity;
  filePath: string;
  lineNumber: number;
  snippet: string;
  description: string;
  recommendation: string;
}

export interface SecurityScanReport {
  scannedFiles: number;
  findings: SecurityFinding[];
  durationMs: number;
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

interface RuleDef {
  id: string;
  category: string;
  severity: FindingSeverity;
  pattern: RegExp;
  description: string;
  recommendation: string;
  fileExtensions?: string[];
}

const SECURITY_RULES: RuleDef[] = [
  // 1. Secrets & Credentials
  {
    id: "SEC-001",
    category: "Secrets Leakage",
    severity: "CRITICAL",
    pattern: /sk-(?:proj-)?[A-Za-z0-9-_]{20,}/,
    description: "Hardcoded OpenAI API key detected in source code.",
    recommendation: "Store API keys in environment variables (e.g. process.env.OPENAI_API_KEY) or a secure vault.",
  },
  {
    id: "SEC-002",
    category: "Secrets Leakage",
    severity: "CRITICAL",
    pattern: /AKIA[0-9A-Z]{16}/,
    description: "Exposed AWS Access Key ID found in source code.",
    recommendation: "Rotate the exposed key immediately and use IAM Roles or AWS environment credentials.",
  },
  {
    id: "SEC-003",
    category: "Secrets Leakage",
    severity: "CRITICAL",
    pattern: /ghp_[0-9a-zA-Z]{36}/,
    description: "Exposed GitHub Personal Access Token (PAT) detected.",
    recommendation: "Revoke the token and inject credentials via GitHub Actions Secrets or environment variables.",
  },
  {
    id: "SEC-004",
    category: "Secrets Leakage",
    severity: "CRITICAL",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    description: "Unencrypted private cryptographic key committed to source repository.",
    recommendation: "Remove private key from git history and manage certificates through a secret manager.",
  },
  {
    id: "SEC-005",
    category: "Secrets Leakage",
    severity: "HIGH",
    pattern: /(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[a-zA-Z0-9_.-]+:[^@\s"']+@[a-zA-Z0-9_.-]+/i,
    description: "Hardcoded database connection string containing plaintext credentials.",
    recommendation: "Extract connection URI into DATABASE_URL environment variable.",
  },

  // 2. Dangerous Execution & Command Injection
  {
    id: "SEC-010",
    category: "Code Injection",
    severity: "HIGH",
    pattern: /\beval\s*\(/,
    description: "Use of dangerous `eval()` function permits arbitrary code execution.",
    recommendation: "Avoid eval(). Use structured JSON.parse() or dedicated domain-specific parsers.",
    fileExtensions: [".js", ".ts", ".jsx", ".tsx", ".py"],
  },
  {
    id: "SEC-011",
    category: "Command Injection",
    severity: "HIGH",
    pattern: /(?:child_process|cp)\.exec\s*\([^,)]*\+/,
    description: "Dynamic string concatenation in `child_process.exec()` creates command injection vectors.",
    recommendation: "Use `execFile` or `spawn` with an array of arguments rather than executing raw shell strings.",
    fileExtensions: [".js", ".ts"],
  },

  // 3. Cryptography & Auth Weaknesses
  {
    id: "SEC-020",
    category: "Broken Authentication",
    severity: "MEDIUM",
    pattern: /jwt\.(?:sign|verify)\s*\([^,]+,\s*["'](?:secret|test|123456|dev|password)["']\s*\)/i,
    description: "Weak or hardcoded JWT secret key used in token signing/verification.",
    recommendation: "Use a high-entropy secret (at least 256 bits) loaded securely from environment variables.",
    fileExtensions: [".js", ".ts", ".py"],
  },
  {
    id: "SEC-021",
    category: "Broken Authentication",
    severity: "MEDIUM",
    pattern: /jwt\.decode\s*\(/,
    description: "`jwt.decode()` used without signature verification.",
    recommendation: "Use `jwt.verify()` with explicit algorithm pinning to validate token authenticity.",
    fileExtensions: [".js", ".ts"],
  },

  // 4. SQL Injection
  {
    id: "SEC-030",
    category: "SQL Injection",
    severity: "HIGH",
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\s+.*(?:WHERE|VALUES)\s+.*["']\s*\+\s*[a-zA-Z0-9_.]+/i,
    description: "Unparameterized raw SQL string concatenation detected.",
    recommendation: "Use parameterized queries or ORM bindings (e.g. `$1`, `?`, or named parameters).",
    fileExtensions: [".js", ".ts", ".py", ".go", ".rs"],
  },

  // 5. SSRF / Cloud Metadata Probing
  {
    id: "SEC-040",
    category: "SSRF",
    severity: "HIGH",
    pattern: /169\.254\.169\.254/,
    description: "Direct reference to AWS/Cloud instance metadata IP address (169.254.169.254).",
    recommendation: "Restrict outbound HTTP access to metadata endpoints and enforce egress IP filtering.",
  },
];

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  "vendor",
  "target",
  "tests",
  "__tests__",
]);

const IGNORED_EXTS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".log",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".ico",
  ".woff",
  ".woff2",
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
  "scanner.ts",
]);

/**
 * Recursively scans a workspace directory for security vulnerabilities and secrets.
 */
export async function runSecurityScan(
  targetDir: string,
  options: { maxFiles?: number; fileExtensions?: string[]; includeTests?: boolean } = {}
): Promise<SecurityScanReport> {
  const startTime = performance.now();
  const root = resolve(targetDir);
  const isDirectTestDir = targetDir.includes("test") || Boolean(options.includeTests);
  const maxFiles = options.maxFiles || 2000;
  const findings: SecurityFinding[] = [];
  let scannedCount = 0;

  function walk(current: string): void {
    if (scannedCount >= maxFiles || !existsSync(current)) return;

    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (scannedCount >= maxFiles) break;

      const fullPath = join(current, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (
          !entry.startsWith(".agent-worktrees") &&
          (!IGNORED_DIRS.has(entry) || (isDirectTestDir && (entry === "tests" || entry === "__tests__")))
        ) {
          walk(fullPath);
        }
      } else if (stat.isFile()) {
        if (IGNORED_FILES.has(entry) || stat.size > 2 * 1024 * 1024) {
          continue;
        }

        const ext = entry.includes(".") ? `.${entry.split(".").pop()!.toLowerCase()}` : "";
        if (IGNORED_EXTS.has(ext)) {
          continue;
        }

        if (options.fileExtensions && options.fileExtensions.length > 0) {
          if (!options.fileExtensions.includes(ext)) continue;
        }

        scannedCount++;
        scanFile(fullPath, root, ext, findings);
      }
    }
  }

  function scanFile(filePath: string, baseRoot: string, ext: string, out: SecurityFinding[]): void {
    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      return;
    }

    const lines = content.split("\n");
    const relPath = relative(baseRoot, filePath);

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx]!;
      // Ignore scanner self-definitions and test rules
      if (line.includes("SECURITY_RULES") || line.includes("pattern: /")) continue;

      for (const rule of SECURITY_RULES) {
        if (rule.fileExtensions && ext && !rule.fileExtensions.includes(ext)) {
          continue;
        }

        if (rule.pattern.test(line)) {
          out.push({
            id: rule.id,
            category: rule.category,
            severity: rule.severity,
            filePath: relPath,
            lineNumber: lineIdx + 1,
            snippet: line.trim().slice(0, 120),
            description: rule.description,
            recommendation: rule.recommendation,
          });
        }
      }
    }
  }

  walk(root);

  const durationMs = performance.now() - startTime;
  const summary = {
    critical: findings.filter((f) => f.severity === "CRITICAL").length,
    high: findings.filter((f) => f.severity === "HIGH").length,
    medium: findings.filter((f) => f.severity === "MEDIUM").length,
    low: findings.filter((f) => f.severity === "LOW").length,
  };

  return {
    scannedFiles: scannedCount,
    findings,
    durationMs,
    summary,
  };
}
