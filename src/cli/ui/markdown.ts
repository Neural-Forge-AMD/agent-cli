/**
 * High-Performance Zero-Dependency Streaming Markdown & Code Syntax Highlighter for Groupy CLI.
 * Delivers Codex & Claude Code quality terminal typography and color palette.
 */

import { c, style } from "./colors";
import { parsePatch, renderDiff } from "./diff";

export class MarkdownHighlighter {
  private inCodeBlock = false;
  private currentLanguage = "";
  private diffBuffer: string[] = [];
  private inDiffBlock = false;
  private lineBuffer = "";

  /**
   * Highlights a complete multi-line markdown string.
   */
  static highlight(markdown: string): string {
    const highlighter = new MarkdownHighlighter();
    const lines = markdown.split("\n");
    return lines.map((line) => highlighter.highlightLine(line)).join("\n");
  }

  /**
   * Feeds a streaming text chunk and returns formatted ANSI output.
   */
  feed(chunk: string): string {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split("\n");
    this.lineBuffer = lines.pop() || "";

    if (lines.length === 0) return "";
    return lines.map((l) => this.highlightLine(l)).join("\n") + "\n";
  }

  /**
   * Flushes any remaining line buffer at the end of a stream.
   */
  flush(): string {
    if (!this.lineBuffer) return "";
    const remaining = this.highlightLine(this.lineBuffer);
    this.lineBuffer = "";
    this.inCodeBlock = false;
    return remaining;
  }

  /**
   * Highlights an individual line.
   */
  highlightLine(line: string): string {
    // 1. Code Block Fence check
    const fenceMatch = line.match(/^```(\w+)?/);
    if (fenceMatch) {
      if (!this.inCodeBlock) {
        this.inCodeBlock = true;
        this.currentLanguage = fenceMatch[1] || "";
        // Diff blocks are buffered and rendered at close
        if (this.currentLanguage.toLowerCase() === "diff") {
          this.inDiffBlock = true;
          this.diffBuffer = [];
          return "";
        }
        const langBadge = this.currentLanguage ? ` ${style.brandBold(this.currentLanguage.toUpperCase())} ` : "";
        return `\n  ${style.dim("┌──")}${langBadge}${style.dim("─".repeat(Math.max(10, 60 - (this.currentLanguage.length + 6))))}`;
      } else {
        this.inCodeBlock = false;
        this.currentLanguage = "";
        if (this.inDiffBlock) {
          this.inDiffBlock = false;
          const raw = this.diffBuffer.join("\n");
          this.diffBuffer = [];
          // Parse unified diff format (lines starting with +/-/ )
          const oldLines: string[] = [];
          const newLines: string[] = [];
          for (const l of raw.split("\n")) {
            if (l.startsWith("-")) { oldLines.push(l.slice(1)); newLines.push(""); }
            else if (l.startsWith("+")) { oldLines.push(""); newLines.push(l.slice(1)); }
            else { oldLines.push(l.startsWith(" ") ? l.slice(1) : l); newLines.push(l.startsWith(" ") ? l.slice(1) : l); }
          }
          const diffLines = parsePatch(oldLines.join("\n"), newLines.join("\n"), 3);
          return "\n" + renderDiff(diffLines) + "\n";
        }
        return `  ${style.dim("└" + "─".repeat(60))}\n`;
      }
    }

    // 2. Inside Code Block -> Apply language-specific or general syntax highlighting
    if (this.inCodeBlock) {
      if (this.inDiffBlock) {
        this.diffBuffer.push(line);
        return ""; // buffered; rendered at closing fence
      }
      const highlightedCode = this.highlightCode(line, this.currentLanguage);
      return `  ${style.dim("│")} ${highlightedCode}`;
    }

    // 3. Normal Markdown Line Formatting
    return this.formatMarkdownText(line);
  }

  private formatMarkdownText(line: string): string {
    let text = line;

    // Headings
    if (/^#\s+/.test(text)) {
      return `\n${style.brandBold(text.replace(/^#\s+/, "▌ "))}${c.reset}`;
    }
    if (/^##\s+/.test(text)) {
      return `\n${style.bold(c.brightCyan + text.replace(/^##\s+/, "■ "))}${c.reset}`;
    }
    if (/^###\s+/.test(text)) {
      return `${style.bold(text.replace(/^###\s+/, "▲ "))}${c.reset}`;
    }

    // Blockquote
    if (/^>\s*/.test(text)) {
      return `  ${style.brand("│")} ${style.italic(style.dim(text.replace(/^>\s*/, "")))}`;
    }

    // Bullet Lists (- or *)
    if (/^\s*[-*]\s+/.test(text)) {
      text = text.replace(/^(\s*)([-*])\s+/, `$1${style.brand("•")} `);
    }

    // Numbered Lists (1. 2.)
    if (/^\s*\d+\.\s+/.test(text)) {
      text = text.replace(/^(\s*)(\d+)\.\s+/, `$1${c.cyan}$2.${c.reset} `);
    }

    // Diff additions & deletions in markdown
    if (/^\+\s+/.test(text)) {
      return `${c.green}${text}${c.reset}`;
    }
    if (/^-\s+/.test(text)) {
      return `${c.red}${text}${c.reset}`;
    }

    // Inline bold: **bold** or __bold__
    text = text.replace(/\*\*(.*?)\*\*/g, `${c.bold}$1${c.reset}`);
    text = text.replace(/__(.*?)__/g, `${c.bold}$1${c.reset}`);

    // Inline code: `code`
    text = text.replace(/`([^`]+)`/g, `${c.bgDarkGray || c.dim}${c.cyan} $1 ${c.reset}`);

    // URLs / Markdown links: [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${c.underline}${c.cyan}$1${c.reset} ${style.dim(`($2)`)}`);

    return text;
  }

  private highlightCode(codeLine: string, lang: string): string {
    let line = codeLine;
    const l = lang.toLowerCase();

    // Comments
    if (line.trim().startsWith("//") || line.trim().startsWith("#") || line.trim().startsWith("--")) {
      return style.dim(line);
    }

    // Strings: "..." or '...' or `...`
    line = line.replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, (match) => `${c.green}${match}${c.reset}`);

    // Numbers
    line = line.replace(/\b(\d+(\.\d+)?)\b/g, `${c.brightYellow}$1${c.reset}`);

    // Language keywords
    const tsKeywords = [
      "const", "let", "var", "function", "return", "if", "else", "for", "while",
      "import", "from", "export", "default", "class", "interface", "type", "extends",
      "implements", "new", "this", "async", "await", "try", "catch", "throw", "typeof",
      "instanceof", "switch", "case", "break", "continue", "true", "false", "null", "undefined"
    ];

    const pyKeywords = [
      "def", "class", "return", "if", "elif", "else", "for", "while", "import",
      "from", "as", "try", "except", "finally", "raise", "with", "lambda", "yield",
      "True", "False", "None", "and", "or", "not", "is", "in", "self", "async", "await"
    ];

    const rustKeywords = [
      "fn", "let", "mut", "pub", "struct", "enum", "impl", "trait", "for", "in",
      "if", "else", "match", "return", "use", "mod", "crate", "self", "super",
      "async", "await", "loop", "while", "break", "continue", "type", "const", "static"
    ];

    const keywords = l.includes("py") ? pyKeywords : l.includes("rs") ? rustKeywords : tsKeywords;
    const regex = new RegExp(`\\b(${keywords.join("|")})\\b`, "g");
    line = line.replace(regex, `${c.magenta}${c.bold}$1${c.reset}`);

    // Types / Classes (PascalCase words)
    line = line.replace(/\b([A-Z][a-zA-Z0-9_]+)\b/g, `${c.cyan}$1${c.reset}`);

    return line;
  }
}
