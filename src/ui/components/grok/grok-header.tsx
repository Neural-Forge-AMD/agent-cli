/**
 * GrokHeader React Component — Grok CLI's launch card.
 * Features:
 * - Grok's braille mark decoded to 1-bit sprite SVG with grayscale shimmer sweep
 * - Rounded box with border-[#2f2f33]
 * - Amber headline (#e0af68) and subhead
 * - Interactive action buttons with keybindings (ctrl+w, ctrl+s, ctrl+q)
 */

import * as React from "react";

const LOGO_BITS = [
  "00000000000000000000000001",
  "00000000000111110000000010",
  "00000000111111111110000100",
  "00000001111111111110001000",
  "00000011111000000000011000",
  "00000111100000000000110000",
  "00001111000000000001111000",
  "00001110000000000011111000",
  "00011100000000000110111000",
  "00011100000000001100011100",
  "00011100000000010000011100",
  "00011100000000100000011100",
  "00011100000001000000011100",
  "00011100000000000000011100",
  "00011100000000000000011000",
  "00001110000000000000111000",
  "00001110000000000001111000",
  "00001110000000000011110000",
  "00001100000000000111100000",
  "00011000011111111111000000",
  "00010000111111111110000000",
  "00100000001111111000000000",
  "01000000000000000000000000",
  "10000000000000000000000000",
];

const AMBER = "#e0af68";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function GrokLogo({
  scale = 4,
  className = "",
}: {
  scale?: number;
  className?: string;
}) {
  const uid = React.useId().replace(/[^a-z0-9]/gi, "");
  const reduced = usePrefersReducedMotion();
  const cols = LOGO_BITS[0]!.length;
  const rows = LOGO_BITS.length;

  const CELL = 10;
  const DOT = 5.2;
  const off = (CELL - DOT) / 2;
  const W = cols * CELL;
  const H = rows * CELL;
  const dots: React.ReactElement[] = [];

  LOGO_BITS.forEach((row, y) => {
    for (let x = 0; x < cols; x += 1) {
      if (row[x] === "1") {
        dots.push(
          <rect
            key={`${x}-${y}`}
            x={x * CELL + off}
            y={y * CELL + off}
            width={DOT}
            height={DOT}
            rx={0.9}
          />,
        );
      }
    }
  });

  return (
    <svg
      aria-hidden="true"
      width={cols * scale}
      height={rows * scale}
      viewBox={`0 0 ${W} ${H}`}
      className={className}
    >
      <defs>
        <mask id={`m${uid}`}>
          <g fill="#fff">{dots}</g>
        </mask>
        <linearGradient
          id={`g${uid}`}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1="0"
          x2={W * 0.42}
          y2={H * 0.18}
          spreadMethod="reflect"
        >
          <stop offset="0" stopColor="#616161" />
          <stop offset="1" stopColor="#d4d4d4" />
          {reduced ? null : (
            <animateTransform
              attributeName="gradientTransform"
              type="translate"
              from="0 0"
              to={`${W * 0.84} ${H * 0.36}`}
              dur="2.8s"
              repeatCount="indefinite"
            />
          )}
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#g${uid})`} mask={`url(#m${uid})`} />
    </svg>
  );
}

const DEFAULT_MENU: { label: string; key?: string; action?: () => void }[] = [
  { label: "New worktree", key: "ctrl+w" },
  { label: "Resume session", key: "ctrl+s" },
  { label: "Changelog" },
  { label: "Quit", key: "ctrl+q" },
];

export interface GrokHeaderProps {
  version?: string;
  headline?: string;
  subhead?: string;
  menu?: Array<{ label: string; key?: string; action?: () => void }>;
  className?: string;
}

export function GrokHeader({
  version = "0.2.93",
  headline = "Groupy is here!",
  subhead = "Groupy is now available. Try it out in the /model picker.",
  menu = DEFAULT_MENU,
  className = "",
}: GrokHeaderProps) {
  return (
    <div
      className={`min-w-0 rounded-[6px] border border-[#2f2f33] px-3 py-4 font-mono text-[13px] leading-[1.5] text-[#e8e8e8] sm:px-4 ${className}`}
    >
      <div className="flex min-w-0 items-center gap-5">
        <GrokLogo className="hidden shrink-0 sm:block" />
        <div className="min-w-0 flex-1">
          <div className="break-words">
            <span className="font-semibold">Groupy Build Beta</span>{" "}
            <span className="text-[#7a7a7a]">{version}</span>
          </div>
          <div className="mt-2 break-words font-semibold" style={{ color: AMBER }}>
            {headline}
          </div>
          <div className="truncate text-[#8b8b90]">{subhead}</div>

          <ul className="mt-2.5 min-w-0 space-y-0.5 list-none p-0 m-0">
            {menu.map((m) => (
              <li key={m.label}>
                <button
                  type="button"
                  onClick={m.action}
                  className="flex w-full min-w-0 items-center justify-between gap-4 rounded px-1 py-0.5 text-left hover:bg-white/5 bg-transparent border-0 text-[#e8e8e8] cursor-pointer"
                >
                  <span className="min-w-0 truncate">{m.label}</span>
                  {m.key ? (
                    <span className="shrink-0 text-[#6a6a6a]">{m.key}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
