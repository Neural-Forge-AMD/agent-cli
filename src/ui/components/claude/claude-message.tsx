/**
 * Claude UI React Components - Rebuilt as accessible React components with Tailwind / inline CSS.
 * Compatible with brainless.swerdlow.dev component registry.
 */

import * as React from "react";

export interface ClaudeMessageProps {
  role?: "user" | "assistant";
  className?: string;
  children: React.ReactNode;
}

/**
 * ClaudeMessage — a conversation turn.
 * User turns render as Claude Code's full-width prompt row (`❯` + one cell of space, dark background across the row, white text);
 * Assistant turns render as plain monospace text.
 */
export function ClaudeMessage({
  role = "assistant",
  className = "",
  children,
}: ClaudeMessageProps) {
  if (role === "user") {
    return (
      <div
        className={`flex w-full min-w-0 items-baseline font-mono text-[13px] leading-[1.55] px-2 py-1 rounded-sm ${className}`}
        style={{ background: "#3a3a3a" }}
      >
        <span aria-hidden="true" className="shrink-0 font-bold select-none" style={{ color: "#8a8a8a" }}>
          ❯
        </span>
        {/* one terminal cell between caret and text */}
        <span aria-hidden="true" className="shrink-0" style={{ display: "inline-block", width: "1ch" }} />
        <span className="min-w-0 flex-1 break-words font-medium" style={{ color: "#ffffff" }}>
          {children}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`font-mono text-[13px] leading-[1.6] text-[#c0caf5] ${className}`}
    >
      {children}
    </div>
  );
}
