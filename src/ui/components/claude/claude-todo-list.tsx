/**
 * ClaudeTodoList React Component — Claude Code's task list (TaskCreate / TaskUpdate).
 * Renders task list with ⎿ ✔ / ◼ / ◻ visual alignment and accessible state labels.
 */

import * as React from "react";

export type TodoStatus = "done" | "active" | "todo";

export interface TodoItem {
  label: string;
  status: TodoStatus;
}

const DONE_COLOR = "#87d787"; // 38;5;114
const ACTIVE_COLOR = "#d78787"; // 38;5;174 — Claude terracotta
const DIM_COLOR = "#949494"; // 38;5;246

const ICON_MAP: Record<TodoStatus, string> = {
  done: "✔",
  active: "◼",
  todo: "◻",
};

export interface ClaudeTodoListProps {
  todos: TodoItem[];
  className?: string;
}

export function ClaudeTodoList({
  todos,
  className = "",
}: ClaudeTodoListProps) {
  return (
    <ol className={`font-mono text-[13px] leading-[1.6] list-none p-0 m-0 ${className}`}>
      {todos.map((t, i) => {
        const iconColor =
          t.status === "done"
            ? DONE_COLOR
            : t.status === "active"
              ? ACTIVE_COLOR
              : undefined;

        return (
          <li key={i} className="whitespace-pre">
            {/*
              First row: "  ⎿ " then icon. Later rows: four spaces so the
              icon column lines up under ✔.
            */}
            <span aria-hidden="true" style={{ color: DIM_COLOR }}>
              {i === 0 ? "  ⎿ " : "    "}
            </span>
            <span aria-hidden="true" style={{ color: iconColor }}>
              {ICON_MAP[t.status]}{" "}
            </span>
            <span
              className={`${t.status === "done" ? "line-through" : ""} ${t.status === "active" ? "font-semibold" : ""}`}
              style={{
                color: t.status === "done" ? DIM_COLOR : undefined,
              }}
            >
              {t.label}
              <span className="sr-only">
                {" "}
                ({t.status === "done"
                  ? "completed"
                  : t.status === "active"
                    ? "in progress"
                    : "pending"})
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
