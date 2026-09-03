import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { SkillsLoader } from "../src/skills/loader";
import { createSkillTool } from "../src/skills/tool";
import { AgentRoleRegistry } from "../src/agents/roles";

describe("Scientific Agent Skills Integration Subsystem", () => {
  const testTmpDir = join(tmpdir(), `pikaa_sci_test_${Date.now()}`);

  beforeAll(() => {
    mkdirSync(testTmpDir, { recursive: true });

    const skillsToCreate = [
      {
        name: "astropy",
        desc: "Core Python package for astronomy and astrophysics.",
        instructions: "Astropy documentation and SkyCoord examples.",
      },
      {
        name: "biopython",
        desc: "Tools for biological computation and bioinformatics.",
        instructions: "SeqIO and biopython nucleotide manipulation.",
      },
      {
        name: "qiskit",
        desc: "Open-source SDK for working with quantum computers.",
        instructions: "Qiskit quantum circuit construction and execution instructions in detail.",
      },
      {
        name: "rdkit",
        desc: "Cheminformatics and machine learning software.",
        instructions: "RDKit molecule representation and SMILES parsing.",
      },
      {
        name: "scikit-learn",
        desc: "Machine learning library in Python.",
        instructions: "Scikit-learn model evaluation and pipeline design.",
      },
      {
        name: "polars-bio",
        desc: "High performance bioinformatics dataframe operations.",
        instructions: "Polars biological data transformations.",
      },
    ];

    for (const s of skillsToCreate) {
      const sDir = join(testTmpDir, s.name);
      mkdirSync(sDir, { recursive: true });
      writeFileSync(
        join(sDir, "SKILL.md"),
        `---\nname: ${s.name}\ndescription: ${s.desc}\n---\n# Skill: ${s.name}\n${s.instructions}\n`,
        "utf8"
      );
    }
  });

  afterAll(() => {
    try {
      if (existsSync(testTmpDir)) {
        rmSync(testTmpDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("should have zero built-in skills bundled by default on fresh install", () => {
    const freshLoader = new SkillsLoader({ includeGlobal: false, includeBuiltIn: true });
    const skills = freshLoader.listSkills(process.cwd());
    expect(skills.length).toBe(0);
  });

  it("should parse frontmatter and instructions for scientific skills properly", () => {
    const loader = new SkillsLoader({ customRoots: [testTmpDir], includeGlobal: false, includeBuiltIn: false });
    const astropy = loader.loadSkill(testTmpDir, "astropy");
    expect(astropy).not.toBeNull();
    expect(astropy?.name).toBe("astropy");
    expect(astropy?.description).toContain("astronomy");
    expect(astropy?.instructions).toContain("Astropy");
    expect(astropy?.instructions).toContain("SkyCoord");

    const qiskit = loader.loadSkill(testTmpDir, "qiskit");
    expect(qiskit).not.toBeNull();
    expect(qiskit?.name).toBe("qiskit");
    expect(qiskit?.description.length).toBeGreaterThan(10);
    expect(qiskit?.instructions.length).toBeGreaterThan(50);

    const rdkit = loader.loadSkill(testTmpDir, "rdkit");
    expect(rdkit).not.toBeNull();
    expect(rdkit?.name).toBe("rdkit");
    expect(rdkit?.description.length).toBeGreaterThan(10);
  });

  it("should support normalized and fuzzy matching in loadSkill", () => {
    const loader = new SkillsLoader({ customRoots: [testTmpDir], includeGlobal: false, includeBuiltIn: false });
    // Exact
    const exact = loader.loadSkill(testTmpDir, "scikit-learn");
    expect(exact).not.toBeNull();
    expect(exact?.name).toBe("scikit-learn");

    // Underscore variation
    const underscore = loader.loadSkill(testTmpDir, "scikit_learn");
    expect(underscore).not.toBeNull();
    expect(underscore?.name).toBe("scikit-learn");

    // Uppercase variation
    const uppercase = loader.loadSkill(testTmpDir, "SCIKIT-LEARN");
    expect(uppercase).not.toBeNull();
    expect(uppercase?.name).toBe("scikit-learn");

    // Punctuation variation for other skills
    const bioFuzzy = loader.loadSkill(testTmpDir, "bio_python");
    expect(bioFuzzy).not.toBeNull();
    expect(bioFuzzy?.name).toBe("biopython");

    const polarsBio = loader.loadSkill(testTmpDir, "polars_bio");
    expect(polarsBio).not.toBeNull();
    expect(polarsBio?.name).toBe("polars-bio");
  });

  it("should execute load_skill tool and return formatted markdown instructions", async () => {
    const loader = new SkillsLoader({ customRoots: [testTmpDir], includeGlobal: false, includeBuiltIn: false });
    const skillTool = createSkillTool(loader);

    const result = await skillTool.execute(
      { skill_name: "biopython" },
      { cwd: testTmpDir, turnId: "turn_1", signal: new AbortController().signal }
    );

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("# Skill: biopython");
    expect(result.output).toContain("SeqIO");

    // Error case for nonexistent skill
    const notFound = await skillTool.execute(
      { skill_name: "nonexistent-fake-skill-xyz" },
      { cwd: testTmpDir, turnId: "turn_1", signal: new AbortController().signal }
    );
    expect(notFound.isError).toBeTrue();
    expect(notFound.output).toContain("not found");
  });

  it("should render comprehensive <available_skills> prompt containing scientific skills", () => {
    const loader = new SkillsLoader({ customRoots: [testTmpDir], includeGlobal: false, includeBuiltIn: false });
    const prompt = loader.formatSkillsPrompt(testTmpDir);
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("</available_skills>");
    expect(prompt).toContain("astropy");
    expect(prompt).toContain("biopython");
    expect(prompt).toContain("qiskit");
    expect(prompt).toContain("scikit-learn");
    expect(prompt).toContain("rdkit");
    expect(prompt).toContain("load_skill");
  });

  it("should register scientist role in AgentRoleRegistry with specialized tools and prompt", () => {
    const registry = new AgentRoleRegistry();
    expect(registry.hasRole("scientist")).toBeTrue();

    const scientistRole = registry.getRole("scientist");
    expect(scientistRole).toBeDefined();
    expect(scientistRole?.name).toBe("scientist");
    expect(scientistRole?.systemPrompt).toContain("Computational Research Scientist");
    expect(scientistRole?.nicknameCandidates).toContain("Turing");
    expect(scientistRole?.allowedToolNames).toContain("load_skill");
  });
});
