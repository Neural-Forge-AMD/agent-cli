/**
 * Live GitHub Issue & Error Troubleshooting Search Engine.
 */

import type { GitHubIssueResult } from "./types";

export class GitHubIssueSearcher {
  /**
   * Searches issues in a target GitHub repository (e.g. 'vercel/next.js', 'facebook/react', 'oven-sh/bun')
   */
  static async searchIssues(params: {
    repo: string;
    query: string;
    state?: "open" | "closed" | "all";
    limit?: number;
  }): Promise<{ repo: string; query: string; issues: GitHubIssueResult[] }> {
    const limit = params.limit || 5;
    const cleanRepo = params.repo.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").trim();
    const stateFilter = params.state && params.state !== "all" ? `+state:${params.state}` : "";
    const searchUrl = `https://api.github.com/search/issues?q=repo:${encodeURIComponent(cleanRepo)}+${encodeURIComponent(params.query)}${stateFilter}&per_page=${limit}`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "groupy-pikaa-cli",
    };

    if (process.env.GITHUB_TOKEN || process.env.GH_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN || process.env.GH_TOKEN}`;
    }

    try {
      const res = await fetch(searchUrl, { headers });
      if (!res.ok) {
        throw new Error(`GitHub API returned status ${res.status}`);
      }

      const data = (await res.json()) as any;
      const issues: GitHubIssueResult[] = (data.items || []).map((item: any) => ({
        repo: cleanRepo,
        issueNumber: item.number,
        title: item.title || "",
        state: item.state || "open",
        url: item.html_url || "",
        author: item.user?.login || "anonymous",
        createdAt: item.created_at || "",
        body: (item.body || "").slice(0, 3000),
        commentsCount: item.comments || 0,
        labels: (item.labels || []).map((l: any) => (typeof l === "string" ? l : l.name)),
      }));

      return {
        repo: cleanRepo,
        query: params.query,
        issues,
      };
    } catch (err) {
      return {
        repo: cleanRepo,
        query: params.query,
        issues: [],
      };
    }
  }
}
