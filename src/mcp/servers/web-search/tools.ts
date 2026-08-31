/**
 * Web Search & Live Docs Tool Definitions & Execution Dispatcher.
 */

import type { McpToolSchema } from "../../types";
import { WebSearchEngine } from "./search-engine";
import { LiveDocFetcher } from "./doc-fetcher";
import { GitHubIssueSearcher } from "./github-search";

export function getWebSearchToolSchemas(): McpToolSchema[] {
  return [
    {
      name: "search_web",
      description: "Performs a live web search for a given query. Returns a structured list of relevant results with titles, URLs, and summaries.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search terms or question to query." },
          domain: { type: "string", description: "Optional specific domain to prioritize or filter by (e.g. 'nextjs.org', 'tailwindcss.com', 'bun.sh')." },
          maxResults: { type: "integer", description: "Maximum number of search results to return (default: 8)." },
        },
        required: ["query"],
      },
    },
    {
      name: "read_url_content",
      description: "Fetch live content from a URL via HTTP request and converts it to clean, readable Markdown (stripping navbars, scripts, ads, and boilerplate).",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Target webpage URL to fetch and read." },
          maxLength: { type: "integer", description: "Maximum character length of returned markdown (default: 25000)." },
        },
        required: ["url"],
      },
    },
    {
      name: "search_package_docs",
      description: "Fetches official package documentation, latest release version, and README directly from package registries (npm, pypi, crates.io, golang).",
      inputSchema: {
        type: "object",
        properties: {
          packageName: { type: "string", description: "Name of the library or package (e.g. 'zod', 'fastapi', 'tokio', 'gin-gonic')." },
          ecosystem: {
            type: "string",
            enum: ["npm", "pypi", "crates", "golang"],
            description: "Package registry ecosystem (default: 'npm').",
          },
        },
        required: ["packageName"],
      },
    },
    {
      name: "search_github_issues",
      description: "Search issues and troubleshooting discussions in a GitHub repository to find known bugs, workarounds, or breaking changes.",
      inputSchema: {
        type: "object",
        properties: {
          repo: { type: "string", description: "GitHub repository in 'owner/repo' format (e.g. 'vercel/next.js', 'oven-sh/bun')." },
          query: { type: "string", description: "Search query or error message." },
          state: { type: "string", enum: ["open", "closed", "all"], description: "Issue state filter (default: 'all')." },
          limit: { type: "integer", description: "Maximum number of issues to return (default: 5)." },
        },
        required: ["repo", "query"],
      },
    },
  ];
}

export async function executeWebSearchTool(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
    case "search_web":
    case "web_search":
      return WebSearchEngine.search(String(args.query || ""), {
        domain: args.domain ? String(args.domain) : undefined,
        maxResults: args.maxResults ? Number(args.maxResults) : undefined,
      });

    case "read_url_content":
    case "fetch_page_content":
      return LiveDocFetcher.fetchPageContent(String(args.url || args.Url || ""), {
        maxLength: args.maxLength ? Number(args.maxLength) : undefined,
      });

    case "search_package_docs":
      return LiveDocFetcher.fetchPackageDocs(
        String(args.packageName || ""),
        (args.ecosystem as any) || "npm"
      );

    case "search_github_issues":
      return GitHubIssueSearcher.searchIssues({
        repo: String(args.repo || ""),
        query: String(args.query || ""),
        state: args.state || "all",
        limit: args.limit ? Number(args.limit) : undefined,
      });

    default:
      throw new Error(`Unknown Web Search tool: ${name}`);
  }
}
