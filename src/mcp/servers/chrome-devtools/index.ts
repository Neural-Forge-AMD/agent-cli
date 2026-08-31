/**
 * Chrome DevTools MCP Subsystem Index & Server Exports.
 */

import { resolve } from "node:path";

export * from "./types";
export * from "./launcher";
export * from "./cdp-session";
export * from "./dom-snapshot";
export * from "./controller";
export * from "./tools";
export * from "./server";

export const CHROME_DEVTOOLS_MCP_SERVER_PATH = resolve(__dirname, "server.ts");
