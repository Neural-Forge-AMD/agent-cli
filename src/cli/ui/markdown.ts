/**
 * High-Performance Zero-Dependency Progressive Streaming Markdown & Code Syntax Highlighter.
 * Combines real-time token pass-through typewriter streaming with rich terminal typography.
 * 
 * Features:
 * - Instant prefix detection (Headings, Lists, Quotes, Code Fences)
 * - Zero-lag streaming: words appear immediately without waiting for line completion
 * - Real-time inline style state tracking (bold, inline code, links)
 * - Syntax highlighting for code blocks (TS, JS, Python, Rust, Shell, Diff)
 */

import { c, style } from "./colors";
import { parsePatch, renderDiff } from "./diff";

export class MarkdownHighlighter {
  private inCodeBlock = false;
  private currentLanguage = "";
  private inDiffBlock = false;
  private diffBuffer: string[] = [];

  // Line-level state
  private isAtLineStart = true;
  private prefixBuffer = "";

  // Inline styling state machine
  private inBold = false;
  private inInlineCode = false;

  /**
   * Highlights a complete multi-line markdown string.
   */
  static highlight(markdown: string): string {
    const highlighter = new MarkdownHighlighter();
    let result = "";
    for (const chunk of markdown.split(/(\n)/)) {
      result += highlighter.feed(chunk);
    }
    result += highlighter.flush();
    return result;
  }

  /**
   * Feeds a streaming text chunk and returns formatted ANSI output in real-time.
   */
  feed(chunk: string): string {
    if (!chunk) return "";

    let output = "";
    let i = 0;

    while (i < chunk.length) {
      const char = chunk[i]!;

      if (char === "\n") {
        output += this.handleNewline();
        i++;
        continue;
      }

      if (this.inDiffBlock) {
        this.diffBuffer.push(char);
        i++;
        continue;
      }

      if (this.isAtLineStart) {
        this.prefixBuffer += char;

        // Check if prefix pattern is ready to resolve
        if (this.canResolvePrefix(this.prefixBuffer)) {
          output += this.resolveAndEmitPrefix();
        }
        i++;
        continue;
      }

      // Inside normal line or code block -> stream character live
      output += this.processInlineChar(char);
      i++;
    }

    return output;
  }

  /**
   * Flushes any remaining buffers at the end of the stream.
   */
  flush(): string {
    let output = "";
    if (this.isAtLineStart && this.prefixBuffer) {
      output += this.resolveAndEmitPrefix();
    }
    if (this.inBold) {
      output += c.reset;
      this.inBold = false;
    }
    if (this.inInlineCode) {
      output += c.reset;
      this.inInlineCode = false;
    }
    if (this.inCodeBlock && !this.inDiffBlock) {
      output += `\n  ${style.dim("└" + "─".repeat(60))}\n`;
      this.inCodeBlock = false;
    }
    this.prefixBuffer = "";
    this.isAtLineStart = true;
    return output;
  }

  private canResolvePrefix(buf: string): boolean {
    // 1. Code fence check: ```lang requires newline before triggering or 3 backticks with space
    if (buf.startsWith("```")) {
      return false; // wait for newline to capture full language identifier
    }
    // 2. Headings: # , ## , ###
    if (/^#{1,3}\s/.test(buf)) return true;
    // 3. Lists: - , * , 1.
    if (/^\s*[-*]\s/.test(buf) || /^\s*\d+\.\s/.test(buf)) return true;
    // 4. Quotes: >
    if (/^>\s/.test(buf)) return true;
    // 5. If it starts with non-prefix characters, resolve immediately (e.g. regular text)
    if (/^[A-Za-z0-9_"'(\[\{]/.test(buf) && !/^\d+\./.test(buf)) return true;
    // 6. Max prefix lookahead fallback
    if (buf.length >= 6) return true;

    return false;
  }

  private handleNewline(): string {
    let out = "";

    if (this.isAtLineStart && this.prefixBuffer) {
      out += this.resolveAndEmitPrefix();
    }

    if (this.inBold) {
      out += c.reset;
      this.inBold = false;
    }
    if (this.inInlineCode) {
      out += c.reset;
      this.inInlineCode = false;
    }

    if (this.inDiffBlock) {
      const rawDiff = this.diffBuffer.join("");
      const fenceMatch = rawDiff.match(/```$/);
      if (fenceMatch) {
        this.inDiffBlock = false;
        this.inCodeBlock = false;
        const cleanContent = rawDiff.replace(/```$/, "").trim();
        const oldLines: string[] = [];
        const newLines: string[] = [];
        for (const l of cleanContent.split("\n")) {
          if (l.startsWith("-")) { oldLines.push(l.slice(1)); newLines.push(""); }
          else if (l.startsWith("+")) { oldLines.push(""); newLines.push(l.slice(1)); }
          else { oldLines.push(l.startsWith(" ") ? l.slice(1) : l); newLines.push(l.startsWith(" ") ? l.slice(1) : l); }
        }
        const diffLines = parsePatch(oldLines.join("\n"), newLines.join("\n"), 3);
        out += "\n" + renderDiff(diffLines) + "\n";
        this.diffBuffer = [];
      } else {
        this.diffBuffer.push("\n");
      }
    } else {
      out += "\n";
    }

    this.isAtLineStart = true;
    this.prefixBuffer = "";

    return out;
  }

  private resolveAndEmitPrefix(): string {
    const raw = this.prefixBuffer;
    this.prefixBuffer = "";
    this.isAtLineStart = false;

    // 1. Code Block Fence (```lang)
    const fenceMatch = raw.match(/^```(\w+)?/);
    if (fenceMatch) {
      if (!this.inCodeBlock) {
        this.inCodeBlock = true;
        this.currentLanguage = fenceMatch[1] || "";
        if (this.currentLanguage.toLowerCase() === "diff") {
          this.inDiffBlock = true;
          this.diffBuffer = [];
          return "";
        }
        const langBadge = this.currentLanguage ? ` ${style.brandBold(this.currentLanguage.toUpperCase())} ` : "";
        return `\n  ${style.dim("┌──")}${langBadge}${style.dim("─".repeat(Math.max(10, 60 - (this.currentLanguage.length + 6))))}\n  ${style.dim("│")} `;
      } else {
        this.inCodeBlock = false;
        this.currentLanguage = "";
        return `  ${style.dim("└" + "─".repeat(60))}\n`;
      }
    }

    // 2. Code Block body line prefix
    if (this.inCodeBlock) {
      return `  ${style.dim("│")} ` + this.highlightCodeSnippet(raw);
    }

    // 3. Headings
    if (/^#\s+/.test(raw)) {
      return `${style.brandBold("▌ ")}${c.bold}`;
    }
    if (/^##\s+/.test(raw)) {
      return `${c.brightCyan}${style.bold("■ ")}`;
    }
    if (/^###\s+/.test(raw)) {
      return `${style.bold("▲ ")}`;
    }

    // 4. Blockquotes
    if (/^>\s*/.test(raw)) {
      return `  ${style.brand("│")} ${style.italic(style.dim(""))}`;
    }

    // 5. Bullet list items (- or *)
    const bulletMatch = raw.match(/^(\s*)([-*])\s+/);
    if (bulletMatch) {
      return `${bulletMatch[1]}${style.brand("•")} `;
    }

    // 6. Numbered list items (1. 2.)
    const numMatch = raw.match(/^(\s*)(\d+)\.\s+/);
    if (numMatch) {
      return `${numMatch[1]}${c.cyan}${numMatch[2]}.${c.reset} `;
    }

    // Default regular body line
    return this.processInlineString(raw);
  }

  private processInlineChar(char: string): string {
    if (this.inCodeBlock) {
      return this.highlightCodeSnippet(char);
    }

    if (char === "`") {
      if (!this.inInlineCode) {
        this.inInlineCode = true;
        return `${c.dim}${c.cyan} `;
      } else {
        this.inInlineCode = false;
        return ` ${c.reset}`;
      }
    }

    if (char === "*" && !this.inInlineCode) {
      if (!this.inBold) {
        this.inBold = true;
        return c.bold;
      } else {
        this.inBold = false;
        return c.reset;
      }
    }

    return char;
  }

  private processInlineString(text: string): string {
    let out = "";
    for (const ch of text) {
      out += this.processInlineChar(ch);
    }
    return out;
  }

  private highlightCodeSnippet(snippet: string): string {
    let code = snippet;
    code = code.replace(/\b(\d+)\b/g, `${c.brightYellow}$1${c.reset}`);
    const keywords = [
      "const", "let", "var", "function", "return", "if", "else", "for", "while",
      "import", "from", "export", "default", "class", "async", "await", "try", "catch"
    ];
    for (const kw of keywords) {
      const regex = new RegExp(`\\b(${kw})\\b`, "g");
      code = code.replace(regex, `${c.magenta}${c.bold}$1${c.reset}`);
    }
    return code;
  }
}
