/**
 * Automated Project Analyzer & Onboarding Engine for `/init` command.
 * Strictly adheres to Claude Code / Anthropic Best Practices:
 * - Ultra-concise, high-signal, zero-fluff
 * - Focuses on exact Bash commands AI cannot guess
 * - Focuses on non-obvious architectural patterns, env quirks, and workflow checks
 * - Avoids bloated directory dumps or generic boilerplate that degrades context
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

export interface DetectedCommands {
  dev?: string;
  build?: string;
  test?: string;
  typecheck?: string;
  lint?: string;
  format?: string;
  dockerBuild?: string;
}

export interface ProjectAnalysisResult {
  projectName: string;
  description?: string;
  languages: string[];
  packageManager?: string;
  frameworks: string[];
  infrastructure: string[];
  commands: DetectedCommands;
  architectureNotes: string[];
  codeConventions: string[];
  hasExistingInstructions: boolean;
  existingInstructionFile?: string;
}

export class ProjectAnalyzer {
  constructor(private cwd: string = process.cwd()) {}

  /**
   * Scans and analyzes the current workspace directory following Anthropic best practices.
   */
  public analyze(): ProjectAnalysisResult {
    const readmeInfo = this.extractReadmeMetadata();
    const projectName = readmeInfo.title || this.detectProjectName();
    const languages = this.detectLanguages();
    const packageManager = this.detectPackageManager();
    const frameworks: string[] = [];
    const infrastructure: string[] = [];
    const commands: DetectedCommands = {};
    const architectureNotes: string[] = [];
    const codeConventions: string[] = [];

    let description: string | undefined = readmeInfo.description;

    // 1. Node / TypeScript / JavaScript Analysis
    const pkgPath = join(this.cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8").replace(/^\uFEFF/, ""));
        if (!description && pkg.description) description = pkg.description;

        const pm = packageManager || "npm";
        const runPrefix = pm === "bun" || pm === "yarn" || pm === "pnpm" ? `${pm} run` : "npm run";
        const testPrefix = pm === "bun" ? "bun test" : pm === "pnpm" ? "pnpm test" : pm === "yarn" ? "yarn test" : "npm test";

        if (pkg.scripts) {
          if (pkg.scripts.dev) commands.dev = `${runPrefix} dev`;
          else if (pkg.scripts.start) commands.dev = `${runPrefix} start`;
          if (pkg.scripts.build) commands.build = `${runPrefix} build`;
          if (pkg.scripts.test) commands.test = pkg.scripts.test === "bun test" ? "bun test" : testPrefix;
          if (pkg.scripts.typecheck) commands.typecheck = `${runPrefix} typecheck`;
          else if (pkg.scripts.check) commands.typecheck = `${runPrefix} check`;
          if (pkg.scripts.lint) commands.lint = `${runPrefix} lint`;
          if (pkg.scripts.format) commands.format = `${runPrefix} format`;
        }

        const allDeps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
        };

        if (allDeps.next) frameworks.push("Next.js");
        if (allDeps.react) frameworks.push("React");
        if (allDeps.vue) frameworks.push("Vue.js");
        if (allDeps.svelte || allDeps["@sveltejs/kit"]) frameworks.push("Svelte");
        if (allDeps.astro) frameworks.push("Astro");
        if (allDeps.vite) frameworks.push("Vite");
        if (allDeps.express) frameworks.push("Express");
        if (allDeps.hono) frameworks.push("Hono");
        if (allDeps.fastify) frameworks.push("Fastify");
        if (allDeps["@nestjs/core"]) frameworks.push("NestJS");
        if (allDeps.tailwindcss) frameworks.push("TailwindCSS");
        if (allDeps["lucide-react"] || allDeps.lucide) frameworks.push("Lucide Icons");
        if (allDeps.zustand) frameworks.push("Zustand");
        if (allDeps["@tanstack/react-query"]) frameworks.push("TanStack Query");
        if (allDeps.oxlint) frameworks.push("Oxlint");
        if (allDeps.eslint) frameworks.push("ESLint");
        if (allDeps.vitest) frameworks.push("Vitest");
        if (allDeps.jest) frameworks.push("Jest");
        if (allDeps.playwright || allDeps["@playwright/test"]) frameworks.push("Playwright");

        if (pkg.type === "module") {
          codeConventions.push("Use ES modules (`import/export`), not CommonJS (`require`).");
        }
      } catch {}
    }

    // 2. TypeScript specific conventions
    const tsconfigPath = join(this.cwd, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      try {
        const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8").replace(/^\uFEFF/, ""));
        if (tsconfig.compilerOptions?.strict) {
          codeConventions.push("TypeScript strict mode enabled.");
        }
        if (!commands.typecheck) {
          commands.typecheck = "tsc --noEmit";
        }
      } catch {}
    }

    // 3. Rust Analysis
    const cargoPath = join(this.cwd, "Cargo.toml");
    if (existsSync(cargoPath)) {
      try {
        commands.dev = commands.dev || "cargo run";
        commands.build = commands.build || "cargo build";
        commands.test = commands.test || "cargo test";
        commands.lint = commands.lint || "cargo clippy";
        frameworks.push("Rust Cargo");
      } catch {}
    }

    // 4. Go Analysis
    const goModPath = join(this.cwd, "go.mod");
    if (existsSync(goModPath)) {
      try {
        commands.dev = commands.dev || "go run .";
        commands.build = commands.build || "go build ./...";
        commands.test = commands.test || "go test ./...";
        commands.lint = commands.lint || "golangci-lint run";
        frameworks.push("Go Modules");
      } catch {}
    }

    // 5. Python Analysis
    const pyprojectPath = join(this.cwd, "pyproject.toml");
    const requirementsPath = join(this.cwd, "requirements.txt");
    if (existsSync(pyprojectPath) || existsSync(requirementsPath)) {
      commands.test = commands.test || "pytest";
      commands.lint = commands.lint || "ruff check .";
      if (existsSync(join(this.cwd, "uv.lock"))) {
        frameworks.push("uv");
        commands.test = "uv run pytest";
      } else if (existsSync(join(this.cwd, "poetry.lock"))) {
        frameworks.push("Poetry");
        commands.test = "poetry run pytest";
      }
    }

    // 6. Infrastructure & Deployment
    if (existsSync(join(this.cwd, "Dockerfile"))) {
      infrastructure.push("Docker");
      const sanitizedName = projectName.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
      commands.dockerBuild = `docker build -t ${sanitizedName || "app"} .`;
    }
    if (existsSync(join(this.cwd, "nginx.conf"))) {
      infrastructure.push("Nginx");
    }

    // 7. Architectural Observations (High Signal)
    if (existsSync(join(this.cwd, "src/api.ts")) || existsSync(join(this.cwd, "src/api"))) {
      architectureNotes.push("Backend API endpoints and network client logic are centralized in `src/api`.");
    }
    if (existsSync(join(this.cwd, "src/components"))) {
      architectureNotes.push("Reusable UI presentation components live in `src/components/`.");
    }
    if (existsSync(join(this.cwd, "src/types.ts")) || existsSync(join(this.cwd, "src/types"))) {
      architectureNotes.push("Shared TypeScript data models and interfaces are defined in `src/types`.");
    }
    if (existsSync(join(this.cwd, ".env.example"))) {
      architectureNotes.push("Environment configuration template is in `.env.example`.");
    }

    // 8. Workflow checks
    if (commands.typecheck || commands.lint || commands.test) {
      const checks: string[] = [];
      if (commands.typecheck) checks.push(`typecheck (\`${commands.typecheck}\`)`);
      if (commands.lint) checks.push(`lint (\`${commands.lint}\`)`);
      if (commands.test) checks.push(`tests (\`${commands.test}\`)`);
      codeConventions.push(`Run ${checks.join(" and ")} before concluding any major code edits.`);
    }

    // 9. Existing instruction check
    const instructionFiles = ["AGENTS.md", "CLAUDE.md", ".agents.md", "AGENTS.override.md"];
    let hasExistingInstructions = false;
    let existingInstructionFile: string | undefined;

    for (const f of instructionFiles) {
      if (existsSync(join(this.cwd, f))) {
        hasExistingInstructions = true;
        existingInstructionFile = f;
        break;
      }
    }

    return {
      projectName,
      description,
      languages,
      packageManager,
      frameworks,
      infrastructure,
      commands,
      architectureNotes,
      codeConventions,
      hasExistingInstructions,
      existingInstructionFile,
    };
  }

  /**
   * Generates a concise, high-signal AGENTS.md following Anthropic Best Practices.
   */
  public generateAgentsMarkdown(analysis: ProjectAnalysisResult): string {
    const lines: string[] = [];

    lines.push(`# ${analysis.projectName}`);
    lines.push("");
    if (analysis.description) {
      lines.push(`> ${analysis.description}`);
      lines.push("");
    }

    // Development Commands (Most critical section per Anthropic docs)
    lines.push("## Commands");
    lines.push("");
    if (Object.keys(analysis.commands).length > 0) {
      if (analysis.commands.dev) lines.push(`- **Dev Server**: \`${analysis.commands.dev}\``);
      if (analysis.commands.build) lines.push(`- **Build**: \`${analysis.commands.build}\``);
      if (analysis.commands.test) lines.push(`- **Test**: \`${analysis.commands.test}\``);
      if (analysis.commands.typecheck) lines.push(`- **Typecheck**: \`${analysis.commands.typecheck}\``);
      if (analysis.commands.lint) lines.push(`- **Lint**: \`${analysis.commands.lint}\``);
      if (analysis.commands.format) lines.push(`- **Format**: \`${analysis.commands.format}\``);
      if (analysis.commands.dockerBuild) lines.push(`- **Docker Build**: \`${analysis.commands.dockerBuild}\``);
    } else {
      lines.push("- *No standard build/test commands detected.*");
    }
    lines.push("");

    // Architecture & Stack Overview
    lines.push("## Architecture & Stack");
    lines.push("");
    const stackItems: string[] = [];
    if (analysis.languages.length > 0) stackItems.push(analysis.languages.join(", "));
    if (analysis.frameworks.length > 0) stackItems.push(analysis.frameworks.join(", "));
    if (analysis.infrastructure.length > 0) stackItems.push(analysis.infrastructure.join(", "));
    if (stackItems.length > 0) {
      lines.push(`- **Core Stack**: ${stackItems.join(" • ")}`);
    }

    for (const note of analysis.architectureNotes) {
      lines.push(`- ${note}`);
    }
    lines.push("");

    // Code Style & Workflow Guidelines (Specific & Actionable)
    lines.push("## Workflow & Code Guidelines");
    lines.push("");
    if (analysis.codeConventions.length > 0) {
      for (const conv of analysis.codeConventions) {
        lines.push(`- ${conv}`);
      }
    }
    lines.push("- Prefer targeted edits over whole-file rewrites.");
    lines.push("- When fixing errors, address the root cause rather than suppressing compiler warnings.");
    lines.push("");

    return lines.join("\n");
  }

  private extractReadmeMetadata(): { title?: string; description?: string } {
    const readmeFiles = ["README.md", "readme.md", "README.MD"];
    for (const file of readmeFiles) {
      const fullPath = join(this.cwd, file);
      if (existsSync(fullPath)) {
        try {
          const content = readFileSync(fullPath, "utf8");
          const lines = content.split("\n");

          let title: string | undefined;
          let description: string | undefined;

          for (const line of lines) {
            const trimmed = line.trim();

            if (!title && trimmed.startsWith("# ")) {
              title = trimmed.replace(/^#\s+/, "").trim();
              continue;
            }

            if (title && !description && trimmed.length > 0 && !trimmed.startsWith("#") && !trimmed.startsWith("```") && !trimmed.startsWith("[")) {
              description = trimmed;
              break;
            }
          }

          return { title, description };
        } catch {}
      }
    }
    return {};
  }

  private detectProjectName(): string {
    const pkgPath = join(this.cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8").replace(/^\uFEFF/, ""));
        if (pkg.name && pkg.name !== "frontend" && pkg.name !== "backend" && pkg.name !== "app") {
          return pkg.name.startsWith("@") ? pkg.name.split("/")[1] || pkg.name : pkg.name;
        }
      } catch {}
    }

    const cargoPath = join(this.cwd, "Cargo.toml");
    if (existsSync(cargoPath)) {
      try {
        const match = readFileSync(cargoPath, "utf8").match(/name\s*=\s*"([^"]+)"/);
        if (match?.[1]) return match[1];
      } catch {}
    }

    const goModPath = join(this.cwd, "go.mod");
    if (existsSync(goModPath)) {
      try {
        const match = readFileSync(goModPath, "utf8").match(/module\s+([^\s]+)/);
        if (match?.[1]) return basename(match[1]);
      } catch {}
    }

    return basename(this.cwd);
  }

  private detectLanguages(): string[] {
    const langs = new Set<string>();

    if (existsSync(join(this.cwd, "tsconfig.json")) || this.hasFileWithExtension(".ts", ".tsx")) {
      langs.add("TypeScript");
    }
    if (existsSync(join(this.cwd, "package.json")) || this.hasFileWithExtension(".js", ".jsx", ".mjs")) {
      langs.add("JavaScript");
    }
    if (existsSync(join(this.cwd, "Cargo.toml")) || this.hasFileWithExtension(".rs")) {
      langs.add("Rust");
    }
    if (existsSync(join(this.cwd, "go.mod")) || this.hasFileWithExtension(".go")) {
      langs.add("Go");
    }
    if (existsSync(join(this.cwd, "pyproject.toml")) || existsSync(join(this.cwd, "requirements.txt")) || this.hasFileWithExtension(".py")) {
      langs.add("Python");
    }
    if (existsSync(join(this.cwd, "pom.xml")) || existsSync(join(this.cwd, "build.gradle")) || this.hasFileWithExtension(".java")) {
      langs.add("Java");
    }
    if (existsSync(join(this.cwd, "CMakeLists.txt")) || this.hasFileWithExtension(".cpp", ".c", ".h", ".hpp")) {
      langs.add("C/C++");
    }

    return Array.from(langs);
  }

  private detectPackageManager(): string | undefined {
    if (existsSync(join(this.cwd, "bun.lockb")) || existsSync(join(this.cwd, "bun.lock"))) return "bun";
    if (existsSync(join(this.cwd, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(join(this.cwd, "yarn.lock"))) return "yarn";
    if (existsSync(join(this.cwd, "package-lock.json"))) return "npm";
    if (existsSync(join(this.cwd, "Cargo.lock")) || existsSync(join(this.cwd, "Cargo.toml"))) return "cargo";
    if (existsSync(join(this.cwd, "uv.lock"))) return "uv";
    if (existsSync(join(this.cwd, "poetry.lock"))) return "poetry";
    if (existsSync(join(this.cwd, "go.sum")) || existsSync(join(this.cwd, "go.mod"))) return "go";
    if (existsSync(join(this.cwd, "package.json"))) return "npm";
    return undefined;
  }

  private hasFileWithExtension(...exts: string[]): boolean {
    try {
      const entries = readdirSync(this.cwd);
      return entries.some((e) => exts.some((ext) => e.endsWith(ext)));
    } catch {
      return false;
    }
  }
}
