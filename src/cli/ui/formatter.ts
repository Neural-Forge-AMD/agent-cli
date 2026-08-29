/**
 * CLI Formatter: High-fidelity ANSI rendering of the Groupy Emblem and clean typography.
 */

import { c, style } from "./colors";

export function renderGroupyBanner(info: { model: string; cwd: string; role: string }): void {
  CliFormatter.printBanner(info);
}

export function formatToolCard(toolName: string, args: Record<string, unknown>, output?: string, isError = false): void {
  CliFormatter.formatToolCall(toolName, args);
  if (output !== undefined) {
    CliFormatter.formatToolOutput(output, isError);
  }
}

export class CliFormatter {
  static printBanner(info: { model: string; cwd: string; role: string }): void {
    const b = c.brandBold;
    const r = c.reset;
    const g = c.dim;
    const t = c.bold;

    console.log();
    console.log(`  ${b}       ▄▄████████▄▄${r}`);
    console.log(`  ${b}    ▄███▀▀      ▀▀███▄${r}`);
    console.log(`  ${b}  ▄██▀              ▀██▄${r}           ${t}PIKAA AGENT${r}`);
    console.log(`  ${b} ███    ▄▄████▄▄      ███${r}          ${g}Autonomous Coding Engine${r}`);
    console.log(`  ${b}███   ▄██▀    ▀██▄     ▀▀${r}          ${style.dim("Model:")} ${style.brand(info.model)}`);
    console.log(`  ${b}███   ██▌  ██  ▐██████████████▄${r}    ${style.dim("Role:")}  ${style.yellow(info.role)}`);
    console.log(`  ${b}███   ██▌  ██  ▐██    ██  ██ ▀${r}     ${style.dim("Dir:")}   ${style.dim(info.cwd)}`);
    console.log(`  ${b}███   ▀██▄    ▄██▀     ▄▄${r}`);
    console.log(`  ${b} ███    ▀▀████▀▀      ███${r}`);
    console.log(`  ${b}  ▀██▄              ▄██▀${r}`);
    console.log(`  ${b}    ▀███▄▄      ▄▄███▀${r}`);
    console.log(`  ${b}       ▀▀████████▀▀${r}`);
    console.log();
    console.log(`  ${style.dim("Type /help for slash commands or /exit to quit.")}`);
    console.log();
  }

  static formatToolCall(toolName: string, args: Record<string, unknown>): void {
    const argsSummary = Object.entries(args)
      .map(([k, v]) => {
        const valStr = typeof v === "string" ? `"${v.length > 40 ? v.slice(0, 37) + "..." : v}"` : JSON.stringify(v);
        return `${style.dim(k)}=${style.cyan(valStr)}`;
      })
      .join(" ");

    console.log(`  ${style.brand("◆")} ${style.bold("tool:")} ${style.cyan(toolName)} ${argsSummary}`);
  }

  static formatToolOutput(output: string, isError = false): void {
    const prefix = isError ? style.red("  ✗ error:") : style.dim("  ↳ output:");
    const lines = output.trim().split("\n");
    const preview = lines.slice(0, 6).map((l) => `${style.dim("    ")}${l}`).join("\n");
    const more = lines.length > 6 ? `\n    ${style.dim(`... (${lines.length - 6} more lines)`)}` : "";

    console.log(`${prefix}\n${preview}${more}`);
  }

  static formatMarkdownLine(chunk: string): string {
    // Highlight markdown bold **text**
    let formatted = chunk.replace(/\*\*(.*?)\*\*/g, `${c.bold}$1${c.reset}`);
    // Highlight inline code `text`
    formatted = formatted.replace(/`([^`]+)`/g, `${c.cyan}$1${c.reset}`);
    // Highlight markdown headings # Header
    formatted = formatted.replace(/^(#{1,3})\s+(.*)$/gm, `${c.bold}${c.brand}$1 $2${c.reset}`);
    return formatted;
  }
}
