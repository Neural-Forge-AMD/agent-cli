/**
 * Intra-Line Diff Renderer for Groupy CLI.
 * Renders unified diffs with word-level highlights and full-terminal-width
 * TrueColor ANSI backgrounds, mirroring Claude Code / modern IDE aesthetics.
 */

const ESC = "\x1b[";
const R = `${ESC}0m`; // reset

// ── TrueColor palette ──────────────────────────────────────────────────────
const fg = {
  lineNum:   `${ESC}38;2;120;120;130m`,
  gutterDel: `${ESC}38;2;210;90;90m`,
  gutterAdd: `${ESC}38;2;80;200;120m`,
  textDel:   `${ESC}38;2;235;150;150m`,
  textAdd:   `${ESC}38;2;140;230;160m`,
  ctx:       `${ESC}38;2;180;180;195m`,
};

const bg = {
  del:      `${ESC}48;2;60;20;25m`,   // full-width row background for removed lines
  add:      `${ESC}48;2;18;55;28m`,   // full-width row background for added lines
  wordDel:  `${ESC}48;2;135;40;45m`,  // word-level highlight for removed tokens
  wordAdd:  `${ESC}48;2;30;115;50m`,  // word-level highlight for added tokens
};

// ── Types ──────────────────────────────────────────────────────────────────

export interface DiffLine {
  kind: "del" | "add" | "ctx";
  oldLine?: number;
  newLine?: number;
  text: string;
}

// ── LCS-based word tokenizer ───────────────────────────────────────────────

/** Split line into tokens: words, spaces, and punctuation clusters. */
function tokenize(line: string): string[] {
  return line.match(/\w+|\s+|[^\w\s]+/g) ?? [];
}

/**
 * LCS diff between two token arrays.
 * Returns ops where null means "only on that side".
 */
function lcsTokenDiff(
  oldTokens: string[],
  newTokens: string[],
): Array<{ del?: string; add?: string; same?: string }> {
  const m = oldTokens.length;
  const n = newTokens.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = oldTokens[i - 1] === newTokens[j - 1]
        ? dp[i - 1]![j - 1]! + 1
        : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  const ops: Array<{ del?: string; add?: string; same?: string }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      ops.push({ same: oldTokens[i - 1]! });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ add: newTokens[j - 1]! });
      j--;
    } else {
      ops.push({ del: oldTokens[i - 1]! });
      i--;
    }
  }
  return ops.reverse();
}

// ── ANSI-aware visible length ──────────────────────────────────────────────

function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

// ── Padding helper ─────────────────────────────────────────────────────────

function padToWidth(rendered: string, bgColor: string, termWidth: number): string {
  const pad = Math.max(0, termWidth - visibleLen(rendered));
  return rendered + bgColor + " ".repeat(pad) + R;
}

// ── Row renderers ─────────────────────────────────────────────────────────

function gutterWidth(maxLine: number): number {
  return Math.max(1, String(maxLine).length);
}

function renderCtxRow(text: string, oldLine: number, newLine: number, numWidth: number, termWidth: number): string {
  const oldNum = String(oldLine).padStart(numWidth);
  const newNum = String(newLine).padStart(numWidth);
  const gutter = `${fg.lineNum}${oldNum}${R} ${fg.lineNum}${newNum}${R}   `;
  const body = `${fg.ctx}${text}${R}`;
  const raw = gutter + body;
  const pad = Math.max(0, termWidth - visibleLen(raw));
  return raw + " ".repeat(pad);
}

function renderDelRow(
  text: string,
  oldLine: number,
  numWidth: number,
  pairText: string | undefined,
  termWidth: number,
): string {
  const num = String(oldLine).padStart(numWidth);
  const gutter = `${bg.del}${fg.lineNum}${num}${R}${bg.del}${fg.gutterDel} - ${R}`;

  let body: string;
  if (pairText !== undefined) {
    const ops = lcsTokenDiff(tokenize(text), tokenize(pairText));
    body = ops.map(op => {
      if (op.same) return `${bg.del}${fg.textDel}${op.same}`;
      if (op.del)  return `${bg.wordDel}${fg.textDel}${op.del}`;
      return "";
    }).join("") + R;
  } else {
    body = `${bg.del}${fg.textDel}${text}${R}`;
  }

  return padToWidth(gutter + body, bg.del, termWidth);
}

function renderAddRow(
  text: string,
  newLine: number,
  numWidth: number,
  pairText: string | undefined,
  termWidth: number,
): string {
  const num = String(newLine).padStart(numWidth);
  const gutter = `${bg.add}${fg.lineNum}${num}${R}${bg.add}${fg.gutterAdd} + ${R}`;

  let body: string;
  if (pairText !== undefined) {
    const ops = lcsTokenDiff(tokenize(pairText), tokenize(text));
    body = ops.map(op => {
      if (op.same) return `${bg.add}${fg.textAdd}${op.same}`;
      if (op.add)  return `${bg.wordAdd}${fg.textAdd}${op.add}`;
      return "";
    }).join("") + R;
  } else {
    body = `${bg.add}${fg.textAdd}${text}${R}`;
  }

  return padToWidth(gutter + body, bg.add, termWidth);
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface RenderDiffOptions {
  /** File path shown in the header bar. */
  filePath?: string;
  /** Terminal width; defaults to process.stdout.columns ?? 80. */
  termWidth?: number;
}

/**
 * Render a list of DiffLines as a full-width terminal diff block.
 *
 * @example
 * ```ts
 * const lines = parsePatch(oldSrc, newSrc);
 * console.log(renderDiff(lines, { filePath: "src/foo.ts" }));
 * ```
 */
export function renderDiff(lines: DiffLine[], opts: RenderDiffOptions = {}): string {
  const termWidth = opts.termWidth ?? process.stdout.columns ?? 80;
  const maxLineNum = lines.reduce((m, l) => Math.max(m, l.oldLine ?? 0, l.newLine ?? 0), 0);
  const numWidth = gutterWidth(maxLineNum);

  const out: string[] = [];

  // Header bar
  if (opts.filePath) {
    const headerText = `  ${opts.filePath}`;
    const padded = headerText.padEnd(termWidth);
    out.push(`${ESC}48;2;36;36;42m${ESC}38;2;230;230;235m${ESC}1m${padded}${R}`);
  }

  // Pair consecutive del/add runs for word-level diff
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.kind === "ctx") {
      if (line.oldLine === undefined) {
        // Hunk separator
        const sep = "  ⋯".padEnd(termWidth);
        out.push(`${ESC}38;2;100;100;120m${sep}${R}`);
      } else {
        out.push(renderCtxRow(line.text, line.oldLine, line.newLine!, numWidth, termWidth));
      }
      i++;
      continue;
    }

    // Collect contiguous del then add lines
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i]!.kind === "del") dels.push(lines[i++]!);
    while (i < lines.length && lines[i]!.kind === "add") adds.push(lines[i++]!);

    const pairCount = Math.min(dels.length, adds.length);

    for (let p = 0; p < pairCount; p++) {
      out.push(renderDelRow(dels[p]!.text, dels[p]!.oldLine!, numWidth, adds[p]!.text, termWidth));
      out.push(renderAddRow(adds[p]!.text, adds[p]!.newLine!, numWidth, dels[p]!.text, termWidth));
    }
    for (let p = pairCount; p < dels.length; p++) {
      out.push(renderDelRow(dels[p]!.text, dels[p]!.oldLine!, numWidth, undefined, termWidth));
    }
    for (let p = pairCount; p < adds.length; p++) {
      out.push(renderAddRow(adds[p]!.text, adds[p]!.newLine!, numWidth, undefined, termWidth));
    }
  }

  return out.join("\n");
}

/**
 * Diff `oldSrc` vs `newSrc` at the line level using LCS and return DiffLines
 * with surrounding `contextLines` of context rows on each side.
 */
export function parsePatch(
  oldSrc: string,
  newSrc: string,
  contextLines = 3,
): DiffLine[] {
  const oldLines = oldSrc.split("\n");
  const newLines = newSrc.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  // LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1]![j - 1]! + 1
        : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  type Op =
    | { kind: "same"; oi: number; ni: number }
    | { kind: "del"; oi: number }
    | { kind: "add"; ni: number };

  const ops: Op[] = [];
  let oi = m, ni = n;
  while (oi > 0 || ni > 0) {
    if (oi > 0 && ni > 0 && oldLines[oi - 1] === newLines[ni - 1]) {
      ops.push({ kind: "same", oi: oi - 1, ni: ni - 1 });
      oi--; ni--;
    } else if (ni > 0 && (oi === 0 || dp[oi]![ni - 1]! >= dp[oi - 1]![ni]!)) {
      ops.push({ kind: "add", ni: ni - 1 });
      ni--;
    } else {
      ops.push({ kind: "del", oi: oi - 1 });
      oi--;
    }
  }
  ops.reverse();

  // Which ops are in visible range (changed ± contextLines)
  const changed = new Set<number>();
  ops.forEach((op, idx) => { if (op.kind !== "same") changed.add(idx); });
  const visible = new Set<number>();
  changed.forEach(idx => {
    for (let k = Math.max(0, idx - contextLines); k <= Math.min(ops.length - 1, idx + contextLines); k++) {
      visible.add(k);
    }
  });

  const result: DiffLine[] = [];
  let prevVisible = -2;

  for (let idx = 0; idx < ops.length; idx++) {
    if (!visible.has(idx)) continue;

    if (prevVisible !== -2 && idx > prevVisible + 1) {
      // Gap separator between hunks
      result.push({ kind: "ctx", text: "⋯", oldLine: undefined, newLine: undefined } as DiffLine);
    }
    prevVisible = idx;

    const op = ops[idx]!;
    if (op.kind === "same") {
      result.push({ kind: "ctx", oldLine: op.oi + 1, newLine: op.ni + 1, text: oldLines[op.oi]! });
    } else if (op.kind === "del") {
      result.push({ kind: "del", oldLine: op.oi + 1, text: oldLines[op.oi]! });
    } else {
      result.push({ kind: "add", newLine: op.ni + 1, text: newLines[op.ni]! });
    }
  }

  return result;
}
