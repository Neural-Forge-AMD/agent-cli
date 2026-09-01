/**
 * Automated Project Analyzer & Onboarding Engine for `/init` command.
 * Analyzes workspace repository tech stack, build/test commands, architecture, and code conventions,
 * then generates high-quality `AGENTS.md` and `CLAUDE.md` project instruction documents.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

export interface DetectedCommands {
  build?: string;
  test?: string;
  typecheck?: string;
  lint?: string;
  dev?: string;
  format?: string;
}

export interface ProjectAnalysisResult {
  projectName: string;
  description?: string;
  languages: string[];
  packageManager?: string;
  frameworks: string[];
  commands: DetectedCommands;
  directoryStructure: Record<string, string>;
  codeConventions: string[];
  hasExistingInstructions: boolean;
  existingInstructionFile?: string;
}

export class ProjectAnalyzer {
  constructor(private cwd: string = process.cwd()) {}

  /**
   * Scans and analyzes the current workspace directory.
   */
  public analyze(): ProjectAnalysisResult {
    const projectName = this.detectProjectName();
    const languages = this.detectLanguages();
    const packageManager = this.detectPackageManager();
    const frameworks: string[] = [];
    const commands: DetectedCommands = {};
    const codeConventions: string[] = [];

    let description: string | undefined;

    // 1. Node / TypeScript / JavaScript Analysis
    const pkgPath = join(this.cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.description) description = pkg.description;

        const pm = packageManager || "npm";
        const runPrefix = pm === "bun" || pm === "yarn" || pm === "pnpm" ? `${pm} run` : "npm run";
        const testPrefix = pm === "bun" ? "bun test" : pm === "pnpm" ? "pnpm test" : pm === "yarn" ? "yarn test" : "npm test";

        if (pkg.scripts) {
          if (pkg.scripts.build) commands.build = `${runPrefix} build`;
          if (pkg.scripts.test) commands.test = pkg.scripts.test === "bun test" ? "bun test" : testPrefix;
          if (pkg.scripts.typecheck) commands.typecheck = `${runPrefix} typecheck`;
          else if (pkg.scripts.check) commands.typecheck = `${runPrefix} check`;
          if (pkg.scripts.lint) commands.lint = `${runPrefix} lint`;
          if (pkg.scripts.dev) commands.dev = `${runPrefix} dev`;
          else if (pkg.scripts.start) commands.dev = `${runPrefix} start`;
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
        if (allDeps.express) frameworks.push("Express");
        if (allDeps.hono) frameworks.push("Hono");
        if (allDeps.fastify) frameworks.push("Fastify");
        if (allDeps["@nestjs/core"]) frameworks.push("NestJS");
        if (allDeps.tailwindcss) frameworks.push("TailwindCSS");
        if (allDeps.vitest) frameworks.push("Vitest");
        if (allDeps.jest) frameworks.push("Jest");
        if (allDeps.playwright || allDeps["@playwright/test"]) frameworks.push("Playwright");

        if (pkg.type === "module") {
          codeConventions.push('ES Modules enabled (`"type": "module"`)');
        } else {
          codeConventions.push("CommonJS module format");
        }
      } catch {}
    }

    // 2. TypeScript specific conventions
    const tsconfigPath = join(this.cwd, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      try {
        const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
        if (tsconfig.compilerOptions?.strict) {
          codeConventions.push("TypeScript Strict Mode enabled");
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
        const content = readFileSync(cargoPath, "utf8");
        commands.build = commands.build || "cargo build";
        commands.test = commands.test || "cargo test";
        commands.lint = commands.lint || "cargo clippy";
        commands.dev = commands.dev || "cargo run";
        if (content.includes('edition = "2021"')) {
          codeConventions.push("Rust 2021 Edition");
        }
        if (content.includes("tokio")) frameworks.push("Tokio (Async Runtime)");
        if (content.includes("axum")) frameworks.push("Axum");
        if (content.includes("actix-web")) frameworks.push("Actix-Web");
      } catch {}
    }

    // 4. Go Analysis
    const goModPath = join(this.cwd, "go.mod");
    if (existsSync(goModPath)) {
      try {
        const content = readFileSync(goModPath, "utf8");
        commands.build = commands.build || "go build ./...";
        commands.test = commands.test || "go test ./...";
        commands.lint = commands.lint || "golangci-lint run";
        commands.dev = commands.dev || "go run .";
        const goVer = content.match(/go\s+(\d+\.\d+)/);
        if (goVer?.[1]) {
          codeConventions.push(`Go ${goVer[1]}`);
        }
      } catch {}
    }

    // 5. Python Analysis
    const pyprojectPath = join(this.cwd, "pyproject.toml");
    const requirementsPath = join(this.cwd, "requirements.txt");
    if (existsSync(pyprojectPath) || existsSync(requirementsPath)) {
      commands.test = commands.test || "pytest";
      commands.lint = commands.lint || "ruff check .";
      commands.format = commands.format || "black .";
      if (existsSync(join(this.cwd, "uv.lock"))) {
        codeConventions.push("uv package & project manager");
        commands.test = "uv run pytest";
      } else if (existsSync(join(this.cwd, "poetry.lock"))) {
        codeConventions.push("Poetry dependency manager");
        commands.test = "poetry run pytest";
      }
    }

    // 6. Directory Structure Mapping
    const directoryStructure = this.scanDirectoryStructure();

    // 7. Check for existing instruction documents
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
      commands,
      directoryStructure,
      codeConventions,
      hasExistingInstructions,
      existingInstructionFile,
    };
  }

  /**
   * Generates formatted AGENTS.md / CLAUDE.md content from analysis result.
   */
  public generateAgentsMarkdown(analysis: ProjectAnalysisResult): string {
    const lines: string[] = [];

    lines.push(`# ${analysis.projectName}`);
    lines.push("");
    if (analysis.description) {
      lines.push(`> ${analysis.description}`);
      lines.push("");
    }

    // Stack Overview
    lines.push("## Tech Stack");
    lines.push("");
    if (analysis.languages.length > 0) {
      lines.push(`- **Languages**: ${analysis.languages.join(", ")}`);
    }
    if (analysis.packageManager) {
      lines.push(`- **Package Manager**: ${analysis.packageManager}`);
    }
    if (analysis.frameworks.length > 0) {
      lines.push(`- **Frameworks & Libraries**: ${analysis.frameworks.join(", ")}`);
    }
    lines.push("");

    // Development Commands
    lines.push("## Development Commands");
    lines.push("");
    if (Object.keys(analysis.commands).length > 0) {
      if (analysis.commands.build) lines.push(`- **Build**: \`${analysis.commands.build}\``);
      if (analysis.commands.test) lines.push(`- **Test**: \`${analysis.commands.test}\``);
      if (analysis.commands.typecheck) lines.push(`- **Typecheck**: \`${analysis.commands.typecheck}\``);
      if (analysis.commands.lint) lines.push(`- **Lint**: \`${analysis.commands.lint}\``);
      if (analysis.commands.dev) lines.push(`- **Dev / Run**: \`${analysis.commands.dev}\``);
      if (analysis.commands.format) lines.push(`- **Format**: \`${analysis.commands.format}\``);
    } else {
      lines.push("- *No standard build/test commands detected.*");
    }
    lines.push("");

    // Architecture & Directory Layout
    lines.push("## Architecture & Directory Structure");
    lines.push("");
    if (Object.keys(analysis.directoryStructure).length > 0) {
      for (const [dir, purpose] of Object.entries(analysis.directoryStructure)) {
        lines.push(`- \`${dir}\`: ${purpose}`);
      }
    } else {
      lines.push("- Root project workspace");
    }
    lines.push("");

    // Code Style & Conventions
    lines.push("## Code Style & Guidelines");
    lines.push("");
    if (analysis.codeConventions.length > 0) {
      for (const conv of analysis.codeConventions) {
        lines.push(`- ${conv}`);
      }
    }
    lines.push("- Keep functions focused and modular.");
    lines.push("- Maintain clean error handling and avoid unhandled exceptions.");
    lines.push("- Run automated test suite before completing major code changes.");
    lines.push("");

    return lines.join("\n");
  }

  private detectProjectName(): string {
    const pkgPath = join(this.cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg.name) {
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

  private scanDirectoryStructure(): Record<string, string> {
    const structure: Record<string, string> = {};

    const commonDirPurposes: Record<string, string> = {
      src: "Core application source code and business logic",
      lib: "Shared libraries, utilities, and helper modules",
      tests: "Automated unit and integration test suites",
      test: "Automated test suite",
      dist: "Compiled production distribution output",
      build: "Compiled build artifacts",
      docs: "Documentation and architectural specifications",
      pkg: "Reusable public Go/Rust/JS packages",
      cmd: "Main application CLI commands and entry points",
      bin: "CLI executable launcher scripts and binaries",
      templates: "Prompt and code generator templates",
      components: "Reusable UI components",
      app: "Application pages and routing handlers",
      pages: "Page views and route controllers",
      api: "Backend API endpoints and server routes",
      public: "Static public assets and web resources",
      assets: "Media assets, icons, and graphic resources",
      scripts: "Build automation, CI helpers, and deployment scripts",
      config: "Application configuration files",
      storage: "Local databases, caches, and persistent state files",
    };

    try {
      const entries = readdirSync(this.cwd);
      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules" || entry === "target") continue;
        const fullPath = join(this.cwd, entry);
        try {
          if (statSync(fullPath).isDirectory()) {
            const purpose = commonDirPurposes[entry.toLowerCase()] || `Directory for ${entry} modules`;
            structure[`${entry}/`] = purpose;
          }
        } catch {}
      }
    } catch {}

    return structure;
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
