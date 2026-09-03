import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SkillsLoader } from "../src/skills/loader";
import { AgentRoleRegistry } from "../src/agents/roles";
import { runSecurityScan } from "../src/security/scanner";
import { CliFormatter } from "../src/cli/ui/formatter";

describe("Strix-Inspired Security Auditor & Pentesting Subsystem", () => {
  let testWorkspace: string;

  beforeEach(() => {
    testWorkspace = join(tmpdir(), `pikaa_sec_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(testWorkspace, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testWorkspace)) {
      rmSync(testWorkspace, { recursive: true, force: true });
    }
  });

  it("should discover security skills in workspace", () => {
    const secSkillDir = join(testWorkspace, ".agents", "skills", "security-auditor");
    mkdirSync(secSkillDir, { recursive: true });
    writeFileSync(
      join(secSkillDir, "SKILL.md"),
      `---
name: security-auditor
description: Security auditor skill
---
Attack Surface Mapping & Vulnerability Analysis.
`,
      "utf8"
    );

    const loader = new SkillsLoader({ includeGlobal: false, includeBuiltIn: false });
    const skills = loader.listSkills(testWorkspace);

    const names = skills.map((s) => s.name);
    expect(names).toContain("security-auditor");

    const secSkill = loader.loadSkill(testWorkspace, "security-auditor");
    expect(secSkill).not.toBeNull();
    expect(secSkill?.instructions).toContain("Attack Surface Mapping");
    expect(secSkill?.instructions).toContain("Vulnerability Analysis");
  });

  it("should register security-auditor role in AgentRoleRegistry with specialized prompt and nicknames", () => {
    const registry = new AgentRoleRegistry();
    expect(registry.hasRole("security-auditor")).toBe(true);

    const role = registry.getRole("security-auditor");
    expect(role).toBeDefined();
    expect(role?.nicknameCandidates).toContain("Strix");
    expect(role?.nicknameCandidates).toContain("Aegis");
    expect(role?.systemPrompt).toContain("Elite Security Auditor");
    expect(role?.allowedToolNames).toContain("apply_patch");
  });

  it("should detect exposed secrets, eval(), and SQL injection in source files", async () => {
    // 1. Insecure file with exposed OpenAI key and dangerous eval
    const vulnerableJs = `
      const apiKey = "sk-proj-abc123456789012345678901234567890";
      function executeUserCode(userStr) {
        return eval(userStr);
      }
    `;
    writeFileSync(join(testWorkspace, "vulnerable.js"), vulnerableJs, "utf8");

    // 2. Insecure file with raw SQL concatenation
    const vulnerableDb = `
      function getUser(id) {
        const query = "SELECT * FROM users WHERE id = '" + id + "'";
        return db.query(query);
      }
    `;
    writeFileSync(join(testWorkspace, "db.ts"), vulnerableDb, "utf8");

    // 3. Insecure file with weak JWT secret
    const vulnerableAuth = `
      const token = jwt.sign({ sub: 123 }, "123456");
    `;
    writeFileSync(join(testWorkspace, "auth.ts"), vulnerableAuth, "utf8");

    // Run security scan
    const report = await runSecurityScan(testWorkspace);

    expect(report.scannedFiles).toBe(3);
    expect(report.findings.length).toBeGreaterThanOrEqual(4);

    const categories = report.findings.map((f) => f.category);
    expect(categories).toContain("Secrets Leakage");
    expect(categories).toContain("Code Injection");
    expect(categories).toContain("SQL Injection");
    expect(categories).toContain("Broken Authentication");

    expect(report.summary.critical).toBeGreaterThanOrEqual(1);
    expect(report.summary.high).toBeGreaterThanOrEqual(2);
    expect(report.summary.medium).toBeGreaterThanOrEqual(1);
  });

  it("should render security report card cleanly in CliFormatter", () => {
    let captured = "";
    const orig = console.log;
    console.log = (...args: any[]) => {
      captured += args.join(" ") + "\n";
    };

    try {
      CliFormatter.printSecurityReport({
        scannedFiles: 15,
        durationMs: 42.5,
        summary: { critical: 1, high: 2, medium: 1, low: 0 },
        findings: [
          {
            id: "SEC-001",
            category: "Secrets Leakage",
            severity: "CRITICAL",
            filePath: "src/config.ts",
            lineNumber: 12,
            snippet: "const apiKey = 'sk-proj-xyz...'",
            description: "Hardcoded OpenAI key found",
            recommendation: "Use process.env.OPENAI_API_KEY",
          },
        ],
      });

      expect(captured).toContain("Codebase Security & Vulnerability Assessment");
      expect(captured).toContain("CRITICAL");
      expect(captured).toContain("src/config.ts");
      expect(captured).toContain("Hardcoded OpenAI key found");
    } finally {
      console.log = orig;
    }
  });
});
