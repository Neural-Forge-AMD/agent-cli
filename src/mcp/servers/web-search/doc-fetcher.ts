/**
 * Live Documentation & Web Page Content Extractor.
 */

import { HtmlToMarkdownConverter } from "./html-to-markdown";
import type { FetchedPageContent, PackageDocsResult } from "./types";

export class LiveDocFetcher {
  /**
   * Fetches any URL via HTTP and returns structured Clean Markdown.
   */
  static async fetchPageContent(url: string, options: { maxLength?: number; timeoutMs?: number } = {}): Promise<FetchedPageContent> {
    const timeoutMs = options.timeoutMs || 15000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain,*/*;q=0.8",
        },
      });

      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP fetch failed with status ${res.status}: ${res.statusText}`);
      }

      const html = await res.text();

      // Extract title
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = titleMatch && titleMatch[1] ? HtmlToMarkdownConverter.decodeEntities(titleMatch[1].trim()) : "Untitled Web Page";

      const markdown = HtmlToMarkdownConverter.convert(html, {
        baseUrl: url,
        maxLength: options.maxLength || 25000,
      });

      return {
        url,
        title,
        markdown,
        characterCount: markdown.length,
        extractedAt: Date.now(),
      };
    } catch (err) {
      clearTimeout(timer);
      throw new Error(`Failed to fetch page (${url}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Fetches real-time package documentation and README directly from package registries.
   */
  static async fetchPackageDocs(
    packageName: string,
    ecosystem: "npm" | "pypi" | "crates" | "golang" = "npm"
  ): Promise<PackageDocsResult> {
    switch (ecosystem) {
      case "npm":
        return LiveDocFetcher.fetchNpmDocs(packageName);
      case "pypi":
        return LiveDocFetcher.fetchPypiDocs(packageName);
      case "crates":
        return LiveDocFetcher.fetchCratesDocs(packageName);
      case "golang":
        return LiveDocFetcher.fetchGoDocs(packageName);
      default:
        return LiveDocFetcher.fetchNpmDocs(packageName);
    }
  }

  private static async fetchNpmDocs(packageName: string): Promise<PackageDocsResult> {
    const cleanPkg = packageName.trim().toLowerCase();
    const url = `https://registry.npmjs.org/${encodeURIComponent(cleanPkg)}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`NPM package '${packageName}' not found (HTTP ${res.status})`);
    }

    const data = (await res.json()) as any;
    const latestVersion = data["dist-tags"]?.latest || Object.keys(data.versions || {}).pop() || "unknown";
    const versionData = data.versions?.[latestVersion] || {};

    const readme = data.readme || versionData.readme || `# ${packageName}\n\n${data.description || "No description provided."}`;

    return {
      packageName,
      ecosystem: "npm",
      version: latestVersion,
      description: data.description || "",
      homepage: data.homepage || versionData.homepage,
      repository: typeof data.repository === "string" ? data.repository : data.repository?.url,
      readmeMarkdown: readme.slice(0, 30000),
    };
  }

  private static async fetchPypiDocs(packageName: string): Promise<PackageDocsResult> {
    const url = `https://pypi.org/pypi/${encodeURIComponent(packageName.trim())}/json`;
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`PyPI package '${packageName}' not found (HTTP ${res.status})`);
    }

    const data = (await res.json()) as any;
    const info = data.info || {};

    return {
      packageName,
      ecosystem: "pypi",
      version: info.version || "unknown",
      description: info.summary || "",
      homepage: info.home_page || info.project_url,
      repository: info.project_urls?.Source || info.project_urls?.Repository || info.project_urls?.Homepage,
      readmeMarkdown: (info.description || `# ${packageName}\n\n${info.summary}`).slice(0, 30000),
    };
  }

  private static async fetchCratesDocs(packageName: string): Promise<PackageDocsResult> {
    const url = `https://crates.io/api/v1/crates/${encodeURIComponent(packageName.trim())}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "groupy-pikaa-cli (https://github.com/Neural-Forge-AMD/agent-cli)" },
    });

    if (!res.ok) {
      throw new Error(`Rust crate '${packageName}' not found on Crates.io (HTTP ${res.status})`);
    }

    const data = (await res.json()) as any;
    const crate = data.crate || {};

    return {
      packageName,
      ecosystem: "crates",
      version: crate.max_version || crate.newest_version || "unknown",
      description: crate.description || "",
      homepage: crate.homepage || crate.documentation,
      repository: crate.repository,
      readmeMarkdown: `# ${packageName}\n\n${crate.description}\n\nDocumentation: ${crate.documentation || `https://docs.rs/${packageName}`}`,
    };
  }

  private static async fetchGoDocs(packageName: string): Promise<PackageDocsResult> {
    const cleanPkg = packageName.replace(/^https?:\/\//, "").trim();
    const docUrl = `https://pkg.go.dev/${cleanPkg}`;
    const fetched = await LiveDocFetcher.fetchPageContent(docUrl, { maxLength: 25000 });

    return {
      packageName,
      ecosystem: "golang",
      version: "latest",
      description: `Go package documentation for ${cleanPkg}`,
      homepage: docUrl,
      readmeMarkdown: fetched.markdown,
    };
  }
}
