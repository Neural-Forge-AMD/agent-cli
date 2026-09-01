/**
 * Command Handler for `/init` slash command and `pikaa init` CLI subcommand.
 * Scans workspace codebase, extracts commands & tech stack, and generates AGENTS.md.
 */

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectAnalyzer, type ProjectAnalysisResult } from "./project-analyzer";
import { style } from "../cli/ui/colors";

export interface InitCommandOptions {
  cwd?: string;
  force?: boolean;
  filename?: string;
}

export interface InitCommandResult {
  success: boolean;
  filePath: string;
  analysis: ProjectAnalysisResult;
  content: string;
  overwritten: boolean;
}

export function runProjectInit(options: InitCommandOptions = {}): InitCommandResult {
  const cwd = options.cwd || process.cwd();
  const filename = options.filename || "AGENTS.md";
  const targetPath = join(cwd, filename);

  const analyzer = new ProjectAnalyzer(cwd);
  const analysis = analyzer.analyze();
  const content = analyzer.generateAgentsMarkdown(analysis);

  const alreadyExists = existsSync(targetPath);
  writeFileSync(targetPath, content, "utf8");

  return {
    success: true,
    filePath: targetPath,
    analysis,
    content,
    overwritten: alreadyExists,
  };
}

export function printInitSummary(result: InitCommandResult): void {
  const BOLD = "\x1b[1m";
  const GREEN = "\x1b[38;2;120;220;140m";
  const BRAND = "\x1b[38;2;217;119;87m";
  const CYAN = "\x1b[38;2;125;207;255m";
  const GRAY = "\x1b[38;2;148;148;148m";
  const WHITE = "\x1b[38;2;240;240;245m";
  const RESET = "\x1b[0m";

  const { analysis, filePath, overwritten } = result;

  console.log("");
  console.log(`  ${GREEN}✓${RESET} ${BOLD}${WHITE}${overwritten ? "Updated" : "Created"} Project Instructions Document${RESET}`);
  console.log(`  ${GRAY}Path: ${CYAN}${filePath}${RESET}`);
  console.log("");

  console.log(`  ${BRAND}┌─ ${BOLD}Project Overview${RESET} ${BRAND}─────────────────────────────────────────┐${RESET}`);
  console.log(`  ${BRAND}│${RESET}  ${BOLD}Project:${RESET} ${WHITE}${analysis.projectName}${RESET}`);
  if (analysis.languages.length > 0) {
    console.log(`  ${BRAND}│${RESET}  ${BOLD}Languages:${RESET} ${analysis.languages.join(", ")}`);
  }
  if (analysis.packageManager) {
    console.log(`  ${BRAND}│${RESET}  ${BOLD}Package Manager:${RESET} ${analysis.packageManager}`);
  }
  if (analysis.frameworks.length > 0) {
    console.log(`  ${BRAND}│${RESET}  ${BOLD}Frameworks:${RESET} ${analysis.frameworks.join(", ")}`);
  }

  console.log(`  ${BRAND}│${RESET}`);
  console.log(`  ${BRAND}│${RESET}  ${BOLD}Detected Commands:${RESET}`);
  if (analysis.commands.build) {
    console.log(`  ${BRAND}│${RESET}    • Build:     ${CYAN}${analysis.commands.build}${RESET}`);
  }
  if (analysis.commands.test) {
    console.log(`  ${BRAND}│${RESET}    • Test:      ${GREEN}${analysis.commands.test}${RESET}`);
  }
  if (analysis.commands.typecheck) {
    console.log(`  ${BRAND}│${RESET}    • Typecheck: ${CYAN}${analysis.commands.typecheck}${RESET}`);
  }
  if (analysis.commands.lint) {
    console.log(`  ${BRAND}│${RESET}    • Lint:      ${CYAN}${analysis.commands.lint}${RESET}`);
  }
  if (analysis.commands.dev) {
    console.log(`  ${BRAND}│${RESET}    • Dev:       ${CYAN}${analysis.commands.dev}${RESET}`);
  }
  if (Object.keys(analysis.commands).length === 0) {
    console.log(`  ${BRAND}│${RESET}    • ${GRAY}(No standard commands detected)${RESET}`);
  }

  console.log(`  ${BRAND}│${RESET}`);
  console.log(`  ${BRAND}│${RESET}  ${GRAY}AI agents will now automatically load AGENTS.md on every session.${RESET}`);
  console.log(`  ${BRAND}└─────────────────────────────────────────────────────────────┘${RESET}`);
  console.log("");
}
