/**
 * ClaudeDiff React Component — Claude Code's inline edit hunk.
 * Renders ⏺ Update (file) + ⎿ summary with tinted +/- line numbers and accessible labels.
 */

import * as React from "react";

export type DiffLineType = "add" | "del" | "ctx";

export interface ClaudeDiffLine {
  type: DiffLineType;
  n?: number;
  text: string;
}

const GREEN = "#4ea96f";
const RED = "#f7768e";
const MUTED = "#565f89";
const TEXT_COLOR = "#c0caf5";
const DIM_TEXT = "#8b8fa3";

export interface ClaudeDiffProps {
  file: string;
  summary?: string;
  lines: ClaudeDiffLine[];
  className?: string;
}

export function ClaudeDiff({
  file,
  summary,
  lines,
  className = "",
}: ClaudeDiffProps) {
  return (
    <div className={`min-w-0 font-mono text-[13px] leading-[1.55] ${className}`}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span aria-hidden="true" className="shrink-0 font-bold" style={{ color: GREEN }}>
          ⏺
        </span>
        <span className="text-[#c0caf5] font-semibold">Update</span>
        <span className="min-w-0 break-all">
          <span className="text-[#565f89]">(</span>
          <span className="text-[#7dcfff]">{file}</span>
          <span className="text-[#565f89]">)</span>
        </span>
      </div>
      {summary ? (
        <div className="flex min-w-0 items-baseline gap-2 text-[#8b8fa3]">
          {/* invisible status glyph spacer: aligns ⎿ under Update */}
          <span aria-hidden="true" className="invisible shrink-0">
            ⏺
          </span>
          <span aria-hidden="true" className="shrink-0" style={{ color: MUTED }}>
            ⎿
          </span>
          <span className="min-w-0 break-words">{summary}</span>
        </div>
      ) : null}

      <pre className="mt-1 min-w-0 overflow-x-auto rounded-none border border-[#202022] bg-[#101010] py-1.5 pl-2 pr-3 font-mono text-[12.5px]">
        {lines.map((l, i) => {
          const bg =
            l.type === "add"
              ? "rgba(78, 169, 111, 0.10)"
              : l.type === "del"
                ? "rgba(247, 118, 142, 0.12)"
                : "transparent";
          const mark = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
          const markColor =
            l.type === "add" ? GREEN : l.type === "del" ? RED : MUTED;
          return (
            <div key={i} className="flex min-w-0" style={{ background: bg }}>
              <span
                className="w-9 shrink-0 select-none pr-2 text-right font-mono"
                style={{ color: "#3b3f52" }}
              >
                {l.n ?? ""}
              </span>
              <span className="w-3 shrink-0 select-none font-bold" style={{ color: markColor }}>
                {mark}
              </span>
              <span
                className="min-w-0 break-all"
                style={{
                  color: l.type === "ctx" ? DIM_TEXT : TEXT_COLOR,
                }}
              >
                {l.type !== "ctx" ? (
                  <span className="sr-only">
                    {l.type === "add" ? "added: " : "removed: "}
                  </span>
                ) : null}
                {l.text}
              </span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
