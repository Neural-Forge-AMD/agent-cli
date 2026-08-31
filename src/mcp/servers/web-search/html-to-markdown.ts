/**
 * Lightweight & Fast HTML to Clean Markdown Converter.
 * Strips boilerplate noise, ads, scripts, navbars, and converts semantic HTML.
 */

export class HtmlToMarkdownConverter {
  static convert(html: string, options: { baseUrl?: string; maxLength?: number } = {}): string {
    if (!html) return "";

    let cleaned = html;

    // 1. Remove comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

    // 2. Remove script, style, noscript, svg, canvas, iframe, head tags
    cleaned = cleaned.replace(/<(script|style|noscript|svg|canvas|iframe|head|style)[\s\S]*?<\/\1>/gi, "");

    // 3. Remove header, footer, nav, aside elements that usually contain irrelevant site chrome
    cleaned = cleaned.replace(/<(nav|footer|header|aside|menu)[\s\S]*?<\/\1>/gi, "");

    // 4. Remove cookie banners / modal classes
    cleaned = cleaned.replace(/<div[^>]*(cookie|consent|modal|popup|banner)[^>]*>[\s\S]*?<\/div>/gi, "");

    // 5. Convert Preformatted & Code Blocks (<pre><code class="language-js">...</code></pre>)
    cleaned = cleaned.replace(/<pre[^>]*><code[^>]*class=["'](?:language-)?([a-z0-9_-]+)["'][^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, lang, code) => {
      const decoded = HtmlToMarkdownConverter.decodeEntities(code.trim());
      return `\n\`\`\`${lang}\n${decoded}\n\`\`\`\n`;
    });

    cleaned = cleaned.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
      const decoded = HtmlToMarkdownConverter.decodeEntities(code.trim());
      return `\n\`\`\`\n${decoded}\n\`\`\`\n`;
    });

    cleaned = cleaned.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => {
      const decoded = HtmlToMarkdownConverter.decodeEntities(code.trim());
      return ` \`${decoded}\` `;
    });

    // 6. Convert Headings (h1 - h6)
    cleaned = cleaned.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n\n# ${HtmlToMarkdownConverter.cleanInline(text)}\n\n`);
    cleaned = cleaned.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n\n## ${HtmlToMarkdownConverter.cleanInline(text)}\n\n`);
    cleaned = cleaned.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n\n### ${HtmlToMarkdownConverter.cleanInline(text)}\n\n`);
    cleaned = cleaned.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, text) => `\n\n#### ${HtmlToMarkdownConverter.cleanInline(text)}\n\n`);
    cleaned = cleaned.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, text) => `\n\n##### ${HtmlToMarkdownConverter.cleanInline(text)}\n\n`);
    cleaned = cleaned.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, text) => `\n\n###### ${HtmlToMarkdownConverter.cleanInline(text)}\n\n`);

    // 7. Convert Links (<a href="...">...</a>)
    cleaned = cleaned.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const linkText = HtmlToMarkdownConverter.cleanInline(text).trim();
      if (!linkText) return "";
      let finalHref = href.trim();
      if (options.baseUrl && finalHref.startsWith("/")) {
        try {
          finalHref = new URL(finalHref, options.baseUrl).toString();
        } catch {}
      }
      return `[${linkText}](${finalHref})`;
    });

    // 8. Convert Bold / Italic / Strikethrough
    cleaned = cleaned.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, text) => `**${HtmlToMarkdownConverter.cleanInline(text)}**`);
    cleaned = cleaned.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, text) => `*${HtmlToMarkdownConverter.cleanInline(text)}*`);
    cleaned = cleaned.replace(/<(del|s|strike)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, text) => `~~${HtmlToMarkdownConverter.cleanInline(text)}~~`);

    // 9. Convert Lists (ul, ol, li)
    cleaned = cleaned.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${HtmlToMarkdownConverter.cleanInline(text)}`);
    cleaned = cleaned.replace(/<\/(ul|ol)>/gi, "\n\n");

    // 10. Convert Blockquotes & Paragraphs
    cleaned = cleaned.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => {
      const lines = HtmlToMarkdownConverter.cleanInline(text).split("\n");
      return "\n" + lines.map((l) => `> ${l}`).join("\n") + "\n\n";
    });

    cleaned = cleaned.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `\n\n${HtmlToMarkdownConverter.cleanInline(text)}\n\n`);
    cleaned = cleaned.replace(/<br\s*\/?>/gi, "\n");
    cleaned = cleaned.replace(/<hr\s*\/?>/gi, "\n\n---\n\n");

    // 11. Strip remaining HTML tags
    cleaned = cleaned.replace(/<[^>]+>/g, " ");

    // 12. Decode HTML Entities
    cleaned = HtmlToMarkdownConverter.decodeEntities(cleaned);

    // 13. Collapse multiple whitespace and newlines
    cleaned = cleaned
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .trim();

    if (options.maxLength && cleaned.length > options.maxLength) {
      cleaned = cleaned.slice(0, options.maxLength) + `\n\n... [Content truncated, total length: ${cleaned.length} characters]`;
    }

    return cleaned;
  }

  private static cleanInline(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }

  static decodeEntities(str: string): string {
    const entityMap: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
      "&apos;": "'",
      "&nbsp;": " ",
      "&copy;": "©",
      "&reg;": "®",
      "&trade;": "™",
      "&mdash;": "—",
      "&ndash;": "–",
      "&hellip;": "…",
    };

    return str
      .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|copy|reg|trade|mdash|ndash|hellip);/g, (match) => entityMap[match] || match)
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}
