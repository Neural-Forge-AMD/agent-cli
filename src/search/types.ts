/**
 * File Search & Grep Subsystem Types & Schemas.
 * Directly mirrors codex-rs/file-search.
 */

export interface GrepMatch {
  file: string;
  lineNumber: number;
  lineContent: string;
}

export interface GrepOptions {
  query: string;
  path?: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  includePattern?: string;
  maxResults?: number;
}

export interface GrepResult {
  matches: GrepMatch[];
  totalMatches: number;
  truncated: boolean;
}

export interface FindFilesOptions {
  pattern: string;
  path?: string;
  maxResults?: number;
}
