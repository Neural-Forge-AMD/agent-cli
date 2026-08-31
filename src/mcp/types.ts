/**
 * Model Context Protocol (MCP) Types & JSON-RPC 2.0 Definitions.
 * Aligned with MCP Specification (2024-11-05).
 */

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// --- MCP Protocol Types ---

export interface McpClientInfo {
  name: string;
  version: string;
}

export interface McpInitializeParams {
  protocolVersion: string;
  capabilities: {
    roots?: { listChanged?: boolean };
    sampling?: Record<string, unknown>;
  };
  clientInfo: McpClientInfo;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
  };
  serverInfo: {
    name: string;
    version?: string;
  };
}

// --- Tools ---

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface McpListToolsResult {
  tools: McpToolSchema[];
  nextCursor?: string;
}

export interface McpContentItem {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface McpCallToolResult {
  content: McpContentItem[];
  isError?: boolean;
}

// --- Resources ---

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpListResourcesResult {
  resources: McpResource[];
  nextCursor?: string;
}

export interface McpReadResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

// --- Prompts ---

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface McpListPromptsResult {
  prompts: McpPrompt[];
  nextCursor?: string;
}

export interface McpGetPromptResult {
  description?: string;
  messages: Array<{
    role: "user" | "assistant";
    content: McpContentItem;
  }>;
}

// --- Server Configuration ---

export type McpServerConfig =
  | {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
      lazy?: boolean;
    }
  | {
      type: "sse";
      url: string;
      headers?: Record<string, string>;
      lazy?: boolean;
    };

export interface McpServersConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}
