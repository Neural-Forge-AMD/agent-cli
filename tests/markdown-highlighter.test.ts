import { describe, it, expect } from "bun:test";
import { MarkdownHighlighter } from "../src/cli/ui/markdown";

describe("Progressive Real-Time Streaming Markdown Highlighter", () => {
  it("should stream tokens progressively without waiting for trailing newline", () => {
    const highlighter = new MarkdownHighlighter();
    
    // Feed partial words of a normal sentence
    const chunk1 = highlighter.feed("Multi-agent ");
    // Body lines now have 2-space left margin
    expect(chunk1).toBe("  Multi-agent ");

    const chunk2 = highlighter.feed("orchestration engine");
    expect(chunk2).toBe("orchestration engine");

    const chunk3 = highlighter.feed("\n");
    expect(chunk3).toBe("\n");
  });

  it("should detect and format bullet lists in real-time", () => {
    const highlighter = new MarkdownHighlighter();
    
    const chunk1 = highlighter.feed("- First");
    expect(chunk1).toContain("•");
    expect(chunk1).toContain("First");

    const chunk2 = highlighter.feed(" item\n");
    expect(chunk2).toContain("item");
  });

  it("should detect and format headings in real-time", () => {
    const highlighter = new MarkdownHighlighter();
    
    const chunk1 = highlighter.feed("## Structure");
    expect(chunk1).toContain("■");
    expect(chunk1).toContain("Structure");
  });

  it("should format inline code and bold spans", () => {
    const highlighter = new MarkdownHighlighter();
    
    const output = highlighter.feed("Use `bun test` for **fast** checks.\n");
    expect(output).toContain("bun test");
    expect(output).toContain("fast");
  });

  it("should format code block fences and closing boxes", () => {
    const highlighter = new MarkdownHighlighter();
    
    const chunk1 = highlighter.feed("```typescript\n");
    expect(chunk1).toContain("TYPESCRIPT");
    expect(chunk1).toContain("┌──");

    const chunk2 = highlighter.feed("const x = 10;\n");
    expect(chunk2).toContain("│");
    expect(chunk2).toContain("const");

    const chunk3 = highlighter.feed("```\n");
    expect(chunk3).toContain("└");
  });

  it("should support MarkdownHighlighter.highlight static method", () => {
    const doc = "# Title\n\n- Point 1\n- Point 2\n\n```js\nconsole.log(1);\n```";
    const formatted = MarkdownHighlighter.highlight(doc);
    expect(formatted).toContain("Title");
    expect(formatted).toContain("Point 1");
    expect(formatted).toContain("JS");
  });
});
