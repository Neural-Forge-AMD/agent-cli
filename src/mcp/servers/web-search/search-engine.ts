/**
 * Live Web Search Engine - Multi-Provider with Zero-API-Key DDG Fallback.
 */

import { HtmlToMarkdownConverter } from "./html-to-markdown";
import type { WebSearchResultItem, WebSearchResponse } from "./types";

export class WebSearchEngine {
  /**
   * Performs real-time web search across search engines.
   */
  static async search(query: string, options: { domain?: string; maxResults?: number } = {}): Promise<WebSearchResponse> {
    const limit = options.maxResults || 8;
    const finalQuery = options.domain ? `site:${options.domain} ${query}` : query;

    // 1. If Tavily API Key is configured, use Tavily
    if (process.env.TAVILY_API_KEY) {
      try {
        const tavilyRes = await WebSearchEngine.searchTavily(finalQuery, limit);
        if (tavilyRes.results.length > 0) return tavilyRes;
      } catch {}
    }

    // 2. If Brave Search API Key is configured, use Brave
    if (process.env.BRAVE_API_KEY) {
      try {
        const braveRes = await WebSearchEngine.searchBrave(finalQuery, limit);
        if (braveRes.results.length > 0) return braveRes;
      } catch {}
    }

    // 3. Fallback: Fast Zero-API-Key DuckDuckGo HTML Search
    return WebSearchEngine.searchDuckDuckGo(finalQuery, limit);
  }

  /**
   * DuckDuckGo HTML Search Scraper (Fast & Zero API Key required)
   */
  private static async searchDuckDuckGo(query: string, limit: number): Promise<WebSearchResponse> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
      });

      if (!res.ok) {
        throw new Error(`DuckDuckGo returned HTTP status ${res.status}`);
      }

      const html = await res.text();
      const results: WebSearchResultItem[] = [];

      // Extract results from DDG HTML markup
      const resultBlocks = html.split(/<div class="[^"]*result\s+results_links[^"]*"[^>]*>/gi);

      for (let i = 1; i < resultBlocks.length && results.length < limit; i++) {
        const block = resultBlocks[i];
        if (!block) continue;

        // Title and URL
        const titleMatch = block.match(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
          block.match(/<a class="result__snippet"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
          block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);

        if (!titleMatch || !titleMatch[1] || !titleMatch[2]) continue;

        let rawUrl = titleMatch[1];
        // Handle DDG redirect URLs (/l/?kh=-1&uddg=https%3A%2F%2F...)
        if (rawUrl.includes("uddg=")) {
          const matched = rawUrl.match(/uddg=([^&]+)/);
          if (matched && matched[1]) {
            rawUrl = decodeURIComponent(matched[1]);
          }
        }

        const title = HtmlToMarkdownConverter.decodeEntities(titleMatch[2].replace(/<[^>]+>/g, "").trim());

        // Snippet
        const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ||
          block.match(/<div class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
        const snippet = snippetMatch && snippetMatch[1]
          ? HtmlToMarkdownConverter.decodeEntities(snippetMatch[1].replace(/<[^>]+>/g, "").trim())
          : "";

        let sourceDomain = "";
        try {
          sourceDomain = new URL(rawUrl).hostname;
        } catch {
          sourceDomain = "web";
        }

        if (title && rawUrl && rawUrl.startsWith("http")) {
          results.push({
            title,
            url: rawUrl,
            snippet,
            sourceDomain,
          });
        }
      }

      return {
        query,
        results,
        totalResults: results.length,
      };
    } catch (err) {
      return {
        query,
        results: [],
        totalResults: 0,
      };
    }
  }

  private static async searchTavily(query: string, limit: number): Promise<WebSearchResponse> {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: limit,
      }),
    });

    if (!res.ok) throw new Error(`Tavily API failed: ${res.status}`);
    const data = (await res.json()) as any;

    const results: WebSearchResultItem[] = (data.results || []).map((r: any) => ({
      title: r.title || "No Title",
      url: r.url || "",
      snippet: r.content || "",
      sourceDomain: new URL(r.url).hostname || "",
    }));

    return { query, results, totalResults: results.length };
  }

  private static async searchBrave(query: string, limit: number): Promise<WebSearchResponse> {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": process.env.BRAVE_API_KEY || "",
      },
    });

    if (!res.ok) throw new Error(`Brave API failed: ${res.status}`);
    const data = (await res.json()) as any;

    const results: WebSearchResultItem[] = (data.web?.results || []).map((r: any) => ({
      title: r.title || "No Title",
      url: r.url || "",
      snippet: r.description || "",
      sourceDomain: new URL(r.url).hostname || "",
    }));

    return { query, results, totalResults: results.length };
  }
}
