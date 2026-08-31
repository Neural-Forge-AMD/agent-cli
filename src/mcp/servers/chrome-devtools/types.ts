/**
 * Chrome DevTools MCP Types & Schemas (Aligned with Google Antigravity & Chrome DevTools Protocol).
 */

export interface PageInfo {
  pageId: number;
  targetId: string;
  url: string;
  title: string;
  wsUrl: string;
}

export interface ConsoleMessageRecord {
  id: string;
  type: string;
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
  stackTrace?: Array<{ functionName: string; url: string; lineNumber: number; columnNumber: number }>;
}

export interface NetworkRequestRecord {
  requestId: string;
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  timestamp: number;
  failed?: boolean;
  errorText?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export interface AxNode {
  nodeId: string;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  description?: { value?: string };
  childIds?: string[];
  backendDOMNodeId?: number;
  disabled?: { value?: boolean };
  focused?: { value?: boolean };
}
