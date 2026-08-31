/**
 * GrokPermission React Component — Grok CLI's left-border approval card.
 * Features: ┃ gutter, title + command, numbered (●)/(○) radios, and 1/3:select hint bar.
 */

import * as React from "react";

const BORDER = "#808080"; // 38;5;8
const FG = "#e1e1e1";
const MUTED = "#8b8b90";
const DIM = "#6c6c6c";

const DEFAULT_OPTIONS = [
  "Yes, and don't ask again for anything (always-approve mode)",
  "Yes, proceed",
  "No, reject (type to add feedback)",
];

export interface GrokPermissionProps {
  title?: string;
  command?: string;
  options?: string[];
  defaultSelected?: number;
  onChoose?: (index: number) => void;
  className?: string;
}

export function GrokPermission({
  title = "Tool Execution Approval",
  command = "echo permission-probe-ok > probe-out.txt",
  options = DEFAULT_OPTIONS,
  defaultSelected = 1,
  onChoose,
  className = "",
}: GrokPermissionProps) {
  const [sel, setSel] = React.useState(defaultSelected);

  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        e.key === "ArrowDown"
          ? (i + 1) % options.length
          : (i - 1 + options.length) % options.length;
      setSel(next);
      (e.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSel(i);
      onChoose?.(i);
    }
  }

  return (
    <div className={`font-mono text-[13px] leading-[1.55] ${className}`}>
      <div
        className="border-l-2 pl-3"
        style={{ borderColor: BORDER }}
        role="group"
        aria-label={title}
      >
        <div className="mb-1 font-medium" style={{ color: FG }}>
          {title}
        </div>
        <div className="mb-2 break-all" style={{ color: MUTED }}>
          {command}
        </div>

        <div role="radiogroup" aria-label={title} className="space-y-1">
          {options.map((opt, i) => {
            const active = sel === i;
            return (
              <div
                key={i}
                role="radio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onKeyDown={(e) => onKey(e, i)}
                onClick={() => {
                  setSel(i);
                  onChoose?.(i);
                }}
                className={`flex cursor-pointer items-baseline gap-2 outline-none focus-visible:ring-1 focus-visible:ring-white/30 ${
                  active ? "font-semibold" : ""
                }`}
                style={{ color: active ? FG : MUTED }}
              >
                <span aria-hidden="true" className="shrink-0 tabular-nums">
                  {i + 1}{" "}
                  <span style={{ color: active ? FG : DIM }}>
                    {active ? "(●)" : "(○)"}
                  </span>
                </span>
                <span>{opt}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-x-2 text-[12px]"
        style={{ color: DIM }}
      >
        <span>
          <span className="font-semibold" style={{ color: FG }}>
            {sel + 1}/{options.length}
          </span>
          :select
        </span>
        <span aria-hidden="true">│</span>
        <span>
          <span className="font-semibold" style={{ color: FG }}>
            Ctrl+o
          </span>
          :yolo
        </span>
        <span aria-hidden="true">│</span>
        <span>
          <span className="font-semibold" style={{ color: FG }}>
            Ctrl+c
          </span>
          :cancel
        </span>
      </div>
    </div>
  );
}
