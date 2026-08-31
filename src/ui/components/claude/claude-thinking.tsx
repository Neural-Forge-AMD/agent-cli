/**
 * ClaudeThinking React Component — Claude Code's "working" line.
 * Accessible live region with pulsing sparkle, rotating verbs, and terracotta shimmer.
 */

import * as React from "react";

export const CLAUDE_GLYPHS = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];
export const CLAUDE_VERBS = [
  "Thinking",
  "Levitating",
  "Schlepping",
  "Herding",
  "Percolating",
  "Noodling",
  "Conjuring",
];

const CLAUDE_COLOR = "#cd694a"; // terracotta base
const HILITE_COLOR = "#e79475"; // wave highlight
const DIM_COLOR = "#7d7d7d";

export interface ClaudeThinkingProps {
  running?: boolean;
  verbs?: string[];
  showTokens?: boolean;
  className?: string;
}

export function ClaudeThinking({
  running = true,
  verbs = CLAUDE_VERBS,
  showTokens = true,
  className = "",
}: ClaudeThinkingProps) {
  const [glyph, setGlyph] = React.useState(0);
  const [verbIdx, setVerbIdx] = React.useState(0);
  const [secs, setSecs] = React.useState(0);

  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setGlyph((g) => (g + 1) % CLAUDE_GLYPHS.length), 110);
    return () => clearInterval(id);
  }, [running]);

  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  React.useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setVerbIdx((v) => (v + 1) % verbs.length), 5200);
    return () => clearInterval(id);
  }, [running, verbs.length]);

  if (!running) return null;

  const currentVerb = verbs[verbIdx % verbs.length] || "Thinking";
  const tokens = showTokens ? ` · ↑ ${Math.max(0, secs * 137)} tokens` : "";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 font-mono text-[13px] leading-normal ${className}`}
      style={{
        fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
      }}
    >
      <style>{`
        .cw-verb {
          background-image: linear-gradient(100deg, ${CLAUDE_COLOR} 43%, ${HILITE_COLOR} 50%, ${CLAUDE_COLOR} 57%);
          background-size: 200% 100%;
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          -webkit-text-fill-color: transparent;
          animation: cw-shine 2.8s linear infinite;
        }
        @keyframes cw-shine {
          from { background-position: 100% 0; }
          to   { background-position: -100% 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cw-verb {
            animation: none;
            background-image: none;
            color: ${CLAUDE_COLOR};
            -webkit-text-fill-color: ${CLAUDE_COLOR};
          }
        }
      `}</style>
      <span aria-hidden="true" style={{ color: CLAUDE_COLOR, width: "1ch", display: "inline-block" }}>
        {CLAUDE_GLYPHS[glyph]}
      </span>
      <span className="cw-verb font-medium">{currentVerb}…</span>
      <span style={{ color: DIM_COLOR }}>
        ({secs}s{tokens} · esc to interrupt)
      </span>
    </div>
  );
}
