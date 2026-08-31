/**
 * ClaudeToolCall React Component — Claude Code's collapsed tool/result line.
 * Rebuilt as accessible <details> disclosure with ⏺ / ⎿ visual grammar.
 */

import * as React from "react";

export type ToolStatus = "success" | "error" | "pending";

const STATUS_COLOR: Record<ToolStatus, string> = {
  success: "#4ea96f",
  error: "#f7768e",
  pending: "#e0af68",
};

export interface ClaudeToolCallProps {
  tool: string;
  arg?: string;
  result: string;
  status?: ToolStatus;
  defaultOpen?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function ClaudeToolCall({
  tool,
  arg,
  result,
  status = "success",
  defaultOpen = false,
  className = "",
  children,
}: ClaudeToolCallProps) {
  const expandable = Boolean(children);

  return (
    <details
      open={defaultOpen}
      className={`group font-mono text-[13px] leading-[1.55] [&_summary::-webkit-details-marker]:hidden ${className}`}
    >
      <summary
        className={`list-none ${expandable ? "cursor-pointer" : "cursor-default"} rounded-none outline-none focus-visible:ring-1 focus-visible:ring-[#7dcfff]/60`}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span aria-hidden="true" className="shrink-0" style={{ color: STATUS_COLOR[status] }}>
            ⏺
          </span>
          <span className="min-w-0 break-words">
            <span className="text-[#c0caf5] font-semibold">{tool}</span>
            {arg !== undefined ? (
              <>
                <span className="text-[#565f89]"> (</span>
                <span className="text-[#7dcfff]">{arg}</span>
                <span className="text-[#565f89]">)</span>
              </>
            ) : null}
          </span>
        </span>
        <span className="flex min-w-0 items-baseline gap-2 text-[#8b8fa3]">
          {/* invisible status glyph spacer: aligns ⎿ under the tool name */}
          <span aria-hidden="true" className="invisible shrink-0">
            ⏺
          </span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span aria-hidden="true" className="shrink-0 text-[#565f89]">
              ⎿
            </span>
            <span className="min-w-0 break-words">
              {result}
              {expandable ? (
                <span className="ml-2 text-[#565f89] group-open:hidden">
                  (ctrl+o to expand)
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </summary>

      {expandable ? (
        <div className="mt-1 whitespace-pre-wrap pl-[32px] text-[#8b8fa3] border-l border-[#565f89]/30 ml-2">
          {children}
        </div>
      ) : null}
    </details>
  );
}
