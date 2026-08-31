/**
 * GrokStatus React Component — Grok CLI's top status bar.
 * Features:
 * - Branch glyph () + cwd on the left
 * - Optional MCP spinner indicator (`⠴ MCP (2/3)`)
 * - Context token usage (`16K / 500K`)
 * - Optional turn progress indicator (`│ 2/3 ✓`)
 */

import * as React from "react";

const FG = "#e1e1e1";
const MUTED = "#8b8b90";
const DIM = "#808080";
const OK = "#00ff00";

export interface GrokStatusProps {
  branch?: string;
  directory?: string;
  contextUsed?: string;
  contextLimit?: string;
  turn?: number;
  turnTotal?: number;
  mcp?: number;
  mcpTotal?: number;
  className?: string;
}

export function GrokStatus({
  branch = "main",
  directory = process.cwd ? process.cwd() : "~/workspace",
  contextUsed = "16K",
  contextLimit = "500K",
  turn,
  turnTotal,
  mcp,
  mcpTotal,
  className = "",
}: GrokStatusProps) {
  const showTurn =
    typeof turn === "number" && typeof turnTotal === "number" && turnTotal > 0;
  const showMcp =
    typeof mcp === "number" && typeof mcpTotal === "number" && mcpTotal > 0;

  return (
    <div
      className={`flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-mono text-[12px] ${className}`}
      role="status"
      aria-label="Session status"
    >
      <div className="min-w-0 max-w-full truncate" style={{ color: MUTED }}>
        <span aria-hidden="true" style={{ color: FG }}>
          {" "}
        </span>
        <span style={{ color: FG }} className="font-medium">{branch}</span>
        <span style={{ color: DIM }}> </span>
        <span>{directory}</span>
      </div>

      <div
        className="flex min-w-0 flex-wrap items-baseline gap-x-2 tabular-nums"
        style={{ color: MUTED }}
      >
        {showMcp ? (
          <span style={{ color: DIM }}>
            <span aria-hidden="true">⠴ </span>
            MCP ({mcp}/{mcpTotal})
          </span>
        ) : null}
        <span>
          {contextUsed}
          <span style={{ color: DIM }}> / </span>
          {contextLimit}
        </span>
        {showTurn ? (
          <>
            <span style={{ color: DIM }}>│</span>
            <span>
              {turn}/{turnTotal}
            </span>{" "}
            <span aria-hidden="true" style={{ color: OK }}>
              ✓
            </span>
            <span className="sr-only"> steps complete</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
