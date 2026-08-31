/**
 * High-Performance Progressive Streaming Markdown & Code Syntax Highlighter.
 * Features:
 * - Real-time zero-lag typewriter streaming
 * - Instant prefix detection (Headings, Lists, Quotes, Code Fences)
 * - Real-time inline style state tracking (bold, inline code)
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

    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i]!;

      if (char === "\n") {
        output += this.handleNewline();
        continue;
      }

      if (this.inDiffBlock) {
        this.diffBuffer.push(char);
        continue;
      }

      if (this.isAtLineStart) {
        this.prefixBuffer += char;

        // Check if prefix pattern is ready to resolve
        if (this.canResolvePrefix(this.prefixBuffer)) {
          output += this.resolveAndEmitPrefix();
        }
        continue;
      }

      if (this.inCodeBlock) {
        output += this.highlightCodeSnippet(char);
        continue;
      }

      // Inside normal line -> stream character live
      output += this.processInlineChar(char);
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
      output += `\n  \x1b[38;2;86;95;137m└${"─".repeat(56)}\x1b[0m\n`;
      this.inCodeBlock = false;
    }
    this.prefixBuffer = "";
    this.isAtLineStart = true;
    return output;
  }

  private canResolvePrefix(buf: string): boolean {
    if (buf.startsWith("```")) {
      return false; // wait for newline to capture full language identifier or close
    }
    if (this.inCodeBlock) {
      if (!buf.startsWith("`")) return true;
      return false;
    }
    if (/^#{1,3}\s/.test(buf)) return true;
    if (/^\s*[-*]\s/.test(buf) || /^\s*\d+\.\s/.test(buf)) return true;
    if (/^>\s/.test(buf)) return true;
    if (/^[A-Za-z0-9_"'(\[\{]/.test(buf) && !/^\d+\./.test(buf)) return true;
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
      if (!out.endsWith("\n")) {
        out += "\n";
      }
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
        const langBadge = this.currentLanguage ? ` \x1b[1m\x1b[38;2;224;175;104m${this.currentLanguage.toUpperCase()}\x1b[0m ` : "";
        return `\n  \x1b[38;2;86;95;137m┌──${langBadge}${"─".repeat(Math.max(8, 54 - (this.currentLanguage.length + 6)))}\x1b[0m\n`;
      } else {
        this.inCodeBlock = false;
        this.currentLanguage = "";
        return `  \x1b[38;2;86;95;137m└${"─".repeat(56)}\x1b[0m\n`;
      }
    }

    // Inside code block (and not closing fence)
    if (this.inCodeBlock) {
      return `  \x1b[38;2;86;95;137m│\x1b[0m ` + this.highlightCodeSnippet(raw);
    }

    // 2. Headings
    if (/^#\s+/.test(raw)) {
      return `  \x1b[1m\x1b[38;2;122;162;247m▌ ${c.bold}`;
    }
    if (/^##\s+/.test(raw)) {
      return `  \x1b[1m\x1b[38;2;122;162;247m■ ${c.bold}`;
    }
    if (/^###\s+/.test(raw)) {
      return `  \x1b[1m\x1b[38;2;122;162;247m▲ ${c.bold}`;
    }

    // 3. Blockquotes
    if (/^>\s*/.test(raw)) {
      return `  \x1b[38;2;205;105;74m│\x1b[0m \x1b[3m\x1b[38;2;139;139;144m`;
    }

    // 4. Bullet list items (- or *)
    const bulletMatch = raw.match(/^(\s*)([-*])\s+/);
    if (bulletMatch) {
      const indent = bulletMatch[1] || "";
      return `  ${indent}\x1b[38;2;205;105;74m•\x1b[0m `;
    }

    // 5. Numbered list items (1. 2.)
    const numMatch = raw.match(/^(\s*)(\d+)\.\s+/);
    if (numMatch) {
      const indent = numMatch[1] || "";
      return `  ${indent}\x1b[38;2;122;162;247m${numMatch[2]}.\x1b[0m `;
    }

    // Default regular body line — always 2-space left margin
    return "  " + this.processInlineString(raw);
  }

  private processInlineChar(char: string): string {
    if (this.inCodeBlock) {
      return this.highlightCodeSnippet(char);
    }

    if (char === "`") {
      if (!this.inInlineCode) {
        this.inInlineCode = true;
        return `\x1b[48;2;40;40;45m\x1b[38;2;115;218;202m `;
      } else {
        this.inInlineCode = false;
        return ` \x1b[0m`;
      }
    }

    if (char === "*" && !this.inInlineCode) {
      if (!this.inBold) {
        this.inBold = true;
        return `\x1b[1m\x1b[38;2;255;255;255m`;
      } else {
        this.inBold = false;
        return `\x1b[0m`;
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
    code = code.replace(/\b(\d+)\b/g, `\x1b[38;2;255;158;100m$1\x1b[0m`);
    const keywords = [
      "const", "let", "var", "function", "return", "if", "else", "for", "while",
      "import", "from", "export", "default", "class", "async", "await", "try", "catch",
      "type", "interface", "public", "private", "readonly"
    ];
    for (const kw of keywords) {
      const regex = new RegExp(`\\b(${kw})\\b`, "g");
      code = code.replace(regex, `\x1b[1m\x1b[38;2;187;154;247m$1\x1b[0m`);
    }
    return code;
  }
}
