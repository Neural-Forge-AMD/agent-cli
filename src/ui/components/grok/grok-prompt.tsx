/**
 * GrokPrompt React Component — Grok CLI's rounded composer box.
 * Features: Rounded border around text input, model · mode legend punched into bottom border, shortcut hints.
 */

import * as React from "react";

export type GrokMode =
  | "normal"
  | "plan"
  | "auto"
  | "always-approve"
  | "plan-approval";

const BORDER = "#505058";
const FG = "#e1e1e1";
const MUTED = "#6c6c6c";
const SEP = "#585858";
const PLAN = "#ffff00"; // 38;5;11 — plan caret only
const SURFACE = "#1a1a1a"; // matches background

const MODE_LABEL: Record<GrokMode, string | null> = {
  normal: null,
  plan: "plan",
  auto: "auto",
  "always-approve": "always-approve",
  "plan-approval": "plan approval",
};

export interface GrokPromptProps {
  value?: string;
  defaultValue?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  mode?: GrokMode;
  model?: string;
  showShortcuts?: boolean;
  busy?: boolean;
  className?: string;
  inputClassName?: string;
}

export function GrokPrompt({
  value,
  defaultValue = "",
  onChange,
  onKeyDown,
  placeholder = "",
  mode = "always-approve",
  model = "Groupy 4.5 (xhigh)",
  showShortcuts = true,
  busy = false,
  className = "",
  inputClassName = "",
}: GrokPromptProps) {
  const controlled = value !== undefined;
  const modeLabel = MODE_LABEL[mode];
  const caretColor = mode === "plan" || mode === "plan-approval" ? PLAN : FG;
  const legend = modeLabel ? `${model} · ${modeLabel}` : model;

  return (
    <div className={`min-w-0 font-mono text-[13px] leading-[1.5] ${className}`}>
      <div
        className="relative min-w-0 rounded-sm border px-2 py-1.5"
        style={{ borderColor: BORDER, background: SURFACE }}
      >
        <div className="flex min-w-0 items-center gap-0">
          <span
            aria-hidden="true"
            className="shrink-0"
            style={{ color: caretColor }}
          >
            ❯
          </span>
          <input
            type="text"
            aria-label="Prompt"
            placeholder={placeholder}
            onKeyDown={onKeyDown}
            {...(controlled
              ? { value, onChange }
              : { defaultValue, onChange })}
            className={`min-w-0 flex-1 bg-transparent py-0.5 pl-[1ch] outline-none placeholder:text-[#6c6c6c] ${inputClassName}`}
            style={{
              color: FG,
              caretColor,
            }}
          />
        </div>

        {/* Legend punched into the bottom border */}
        <span
          className="absolute -bottom-2.5 right-2 max-w-[calc(100%-1rem)] truncate px-1 text-[12px] sm:right-3"
          style={{ background: SURFACE, color: MUTED }}
          title={legend}
        >
          <span>{model}</span>
          {modeLabel ? (
            <>
              <span style={{ color: SEP }}> · </span>
              <span>{modeLabel}</span>
            </>
          ) : null}
        </span>
      </div>

      {showShortcuts ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: MUTED }}>
          <span>
            <span className="font-semibold" style={{ color: FG }}>
              Shift+Tab
            </span>
            :mode
          </span>
          {busy ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block h-3 w-px"
                style={{ background: SEP }}
              />
              <span>
                <span className="font-semibold" style={{ color: FG }}>
                  Ctrl+c
                </span>
                :cancel
              </span>
            </>
          ) : null}
          <span
            aria-hidden="true"
            className="inline-block h-3 w-px"
            style={{ background: SEP }}
          />
          <span>
            <span className="font-semibold" style={{ color: FG }}>
              Ctrl+x
            </span>
            :shortcuts
          </span>
        </div>
      ) : null}
    </div>
  );
}
