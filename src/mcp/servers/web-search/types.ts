/**
 * Types & Data Contracts for Cloud Web Search & Live Docs MCP Subsystem.
 */

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  sourceDomain: string;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResultItem[];
  totalResults: number;
}

export interface FetchedPageContent {
  url: string;
  title: string;
  markdown: string;
  characterCount: number;
  extractedAt: number;
}

export interface PackageDocsResult {
  packageName: string;
  ecosystem: "npm" | "pypi" | "crates" | "golang";
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  readmeMarkdown: string;
}

export interface GitHubIssueResult {
  repo: string;
  issueNumber: number;
  title: string;
  state: "open" | "closed";
  url: string;
  author: string;
  createdAt: string;
  body: string;
  commentsCount: number;
  labels: string[];
}
