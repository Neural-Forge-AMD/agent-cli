import { describe, it, expect } from "bun:test";
import { resolve } from "node:path";
import { SkillsLoader } from "../src/skills/loader";
import { createSkillTool } from "../src/skills/tool";
import { AgentRoleRegistry } from "../src/agents/roles";

describe("Scientific Agent Skills Integration Subsystem", () => {
  const cwd = process.cwd();
  const loader = new SkillsLoader({
    includeGlobal: false,
    includeBuiltIn: true,
  });

  it("should discover all 170+ built-in skills including scientific skills catalog", () => {
    const skills = loader.listSkills(cwd);
    expect(skills.length).toBeGreaterThanOrEqual(170);

    const skillNames = new Set(skills.map((s) => s.name.toLowerCase()));

    // Verify key scientific domain skills are present
    const expectedScientificSkills = [
      "astropy",
      "biopython",
      "qiskit",
      "cirq",
      "rdkit",
      "scikit-learn",
      "scanpy",
      "anndata",
      "deepchem",
      "diffdock",
      "sympy",
      "polars-bio",
      "pysam",
      "pymatgen",
      "transformers",
      "dask",
      "matplotlib",
      "seaborn",
      "literature-review",
      "scientific-writing",
    ];

    for (const expected of expectedScientificSkills) {
      expect(skillNames.has(expected)).toBeTrue();
    }
  });

  it("should parse frontmatter and instructions for scientific skills properly", () => {
    const astropy = loader.loadSkill(cwd, "astropy");
    expect(astropy).not.toBeNull();
    expect(astropy?.name).toBe("astropy");
    expect(astropy?.description).toContain("astronomy");
    expect(astropy?.instructions).toContain("Astropy");
    expect(astropy?.instructions).toContain("SkyCoord");

    const qiskit = loader.loadSkill(cwd, "qiskit");
    expect(qiskit).not.toBeNull();
    expect(qiskit?.name).toBe("qiskit");
    expect(qiskit?.description.length).toBeGreaterThan(10);
    expect(qiskit?.instructions.length).toBeGreaterThan(100);

    const rdkit = loader.loadSkill(cwd, "rdkit");
    expect(rdkit).not.toBeNull();
    expect(rdkit?.name).toBe("rdkit");
    expect(rdkit?.description.length).toBeGreaterThan(10);
  });

  it("should support normalized and fuzzy matching in loadSkill", () => {
    // Exact
    const exact = loader.loadSkill(cwd, "scikit-learn");
    expect(exact).not.toBeNull();
    expect(exact?.name).toBe("scikit-learn");

    // Underscore variation
    const underscore = loader.loadSkill(cwd, "scikit_learn");
    expect(underscore).not.toBeNull();
    expect(underscore?.name).toBe("scikit-learn");

    // Uppercase variation
    const uppercase = loader.loadSkill(cwd, "SCIKIT-LEARN");
    expect(uppercase).not.toBeNull();
    expect(uppercase?.name).toBe("scikit-learn");

    // Punctuation variation for other skills
    const bioFuzzy = loader.loadSkill(cwd, "bio_python");
    expect(bioFuzzy).not.toBeNull();
    expect(bioFuzzy?.name).toBe("biopython");

    const polarsBio = loader.loadSkill(cwd, "polars_bio");
    expect(polarsBio).not.toBeNull();
    expect(polarsBio?.name).toBe("polars-bio");
  });

  it("should execute load_skill tool and return formatted markdown instructions", async () => {
    const skillTool = createSkillTool(loader);

    const result = await skillTool.execute(
      { skill_name: "biopython" },
      { cwd, turnId: "turn_1", signal: new AbortController().signal }
    );

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("# Skill: biopython");
    expect(result.output).toContain("SeqIO");

    // Error case for nonexistent skill
    const notFound = await skillTool.execute(
      { skill_name: "nonexistent-fake-skill-xyz" },
      { cwd, turnId: "turn_1", signal: new AbortController().signal }
    );
    expect(notFound.isError).toBeTrue();
    expect(notFound.output).toContain("not found");
  });

  it("should render comprehensive <available_skills> prompt containing scientific skills", () => {
    const prompt = loader.formatSkillsPrompt(cwd);
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
