/**
 * GrokSlashMenu React Component — Grok CLI's slash-command palette.
 * Overlay above the composer: ❯ active row, type after / to filter, arrow keys to navigate.
 */

import * as React from "react";
import { GrokPrompt, type GrokMode } from "./grok-prompt";

export interface GrokSlashCommand {
  name: string;
  description: string;
}

const DEFAULT_COMMANDS: GrokSlashCommand[] = [
  { name: "/quit", description: "Quit the application" },
  { name: "/help", description: "Browse commands and keyboard shortcuts" },
  { name: "/docs", description: "Open How-to Guides or online Build docs" },
  { name: "/home", description: "Return to the welcome screen" },
  { name: "/new", description: "Start a new session" },
  { name: "/fork", description: "Branch the current session into a peer agent" },
  { name: "/mode", description: "Cycle permission modes (auto / normal / yolo)" },
  { name: "/mcp", description: "Inspect and manage Model Context Protocol servers" },
  { name: "/diff", description: "Inspect git diff hunks and pending changes" },
  { name: "/spawn", description: "Spawn a specialized autonomous sub-agent" },
];

const ACTIVE_COLOR = "#e1e1e1";
const INACTIVE_COLOR = "#8b8b90";
const RULE_COLOR = "#505058";
const NAME_COLS = 16;

export interface GrokSlashMenuProps {
  commands?: GrokSlashCommand[];
  mode?: GrokMode;
  model?: string;
  onSelect?: (command: GrokSlashCommand) => void;
  className?: string;
}

export function GrokSlashMenu({
  commands = DEFAULT_COMMANDS,
  mode = "always-approve",
  model = "Groupy 4.5",
  onSelect,
  className = "",
}: GrokSlashMenuProps) {
  const [value, setValue] = React.useState("/");
  const [active, setActive] = React.useState(0);

  const query = value.startsWith("/") ? value.slice(1) : value;
  const list = commands.filter((c) =>
    c.name.slice(1).toLowerCase().startsWith(query.toLowerCase()),
  );
  const clampedActive = list.length ? Math.min(active, list.length - 1) : 0;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!list.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % list.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + list.length) % list.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      const selected = list[clampedActive];
      if (selected) {
        e.preventDefault();
        onSelect?.(selected);
        setValue(selected.name + " ");
      }
    }
  }

  return (
    <div className={`font-mono text-[13px] leading-[1.55] ${className}`}>
      <div
        className="mb-2 border-y py-1.5"
        style={{ borderColor: RULE_COLOR }}
        role="listbox"
        aria-label="Slash commands"
        aria-activedescendant={
          list.length ? `grok-slash-${clampedActive}` : undefined
        }
      >
        <ul className="space-y-0.5 list-none p-0 m-0">
          {list.map((c, i) => {
            const activeRow = i === clampedActive;
            return (
              <li
                key={c.name}
                id={`grok-slash-${i}`}
                role="option"
                aria-selected={activeRow}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onSelect?.(c);
                  setValue(c.name + " ");
                }}
                className="flex cursor-pointer items-baseline gap-2 truncate px-1"
                style={{ color: activeRow ? ACTIVE_COLOR : INACTIVE_COLOR }}
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-[2ch] shrink-0"
                  style={{ color: activeRow ? ACTIVE_COLOR : "transparent" }}
                >
                  ❯
                </span>
                <span
                  className="inline-block shrink-0 font-medium"
                  style={{ width: `${NAME_COLS}ch` }}
                >
                  {c.name}
                </span>
                <span className="min-w-0 truncate">{c.description}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <GrokPrompt
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        mode={mode}
        model={model}
        showShortcuts={false}
      />
    </div>
  );
}
