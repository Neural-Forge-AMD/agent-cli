/**
 * Cloud Web Search & Live Docs MCP Subsystem Index & Server Exports.
 */

import { resolve } from "node:path";

export * from "./types";
export * from "./html-to-markdown";
export * from "./search-engine";
export * from "./doc-fetcher";
export * from "./github-search";
export * from "./tools";
export * from "./server";

export const WEB_SEARCH_MCP_SERVER_PATH = resolve(__dirname, "server.ts");
