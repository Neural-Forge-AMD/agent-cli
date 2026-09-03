/**
 * Interactive Prompt & Single-Key Choice Selectors for Groupy CLI.
 * Delivers instant hotkey responses and smooth terminal interactive widgets.
 */

import readline from "node:readline";
import { c, style } from "./colors";
import { addGlobalKeypressListener, ensureRawMode } from "./keypress";

export interface ChoiceOption<T> {
  key: string;       // Hotkey, e.g. "y", "n", "a"
  label: string;     // Display label, e.g. "Yes", "No", "Always allow this session"
  value: T;
  isDefault?: boolean;
}

export interface PromptChoiceConfig<T> {
  message: string;
  choices: ChoiceOption<T>[];
  defaultIndex?: number;
}

/**
 * Prompts the user with a single-key choice selector.
 * Responds INSTANTLY to hotkey keypresses (no Enter required)
 * and also supports Left/Right arrow navigation with Enter confirmation.
 */
export async function promptChoice<T>(config: PromptChoiceConfig<T>): Promise<T> {
  const { message, choices, defaultIndex = 0 } = config;

  if (!process.stdin.isTTY) {
    if (process.env.NODE_ENV === "test" || !process.stdin.readable) {
      const def = choices[defaultIndex] || choices[0];
      return def ? def.value : ("" as unknown as T);
    }
    // Fallback for non-TTY / piped input
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const promptText = `  ${message} (${choices.map((c) => `[${c.key}] ${c.label}`).join(", ")}): `;
      rl.question(promptText, (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        const match = choices.find((c) => c.key.toLowerCase() === trimmed);
        if (match) {
          resolve(match.value);
        } else {
          const def = choices[defaultIndex] || choices[0];
          resolve(def ? def.value : ("" as unknown as T));
        }
      });
    });
  }

  return new Promise((resolve) => {
    let selectedIndex = defaultIndex;
    if (selectedIndex < 0 || selectedIndex >= choices.length) selectedIndex = 0;

    const wasRaw = process.stdin.isRaw ?? false;
    ensureRawMode(true);

    const render = () => {
      const parts = choices.map((choice, idx) => {
        const isSelected = idx === selectedIndex;
        const keyTag = `[${choice.key}]`;
        if (isSelected) {
          return `${c.bgBrand}${c.white}${c.bold} ❯ ${keyTag} ${choice.label} ${c.reset}`;
        }
        return `${style.dim(`  ${keyTag} ${choice.label}`)}`;
      });

      // Clear line and render choices
      process.stdout.write(`\r\x1b[2K  ${style.bold(message)}\n\r\x1b[2K${parts.join("  ")}`);
    };

    let unsubscribe: (() => void) | null = null;

    const cleanup = (confirmedChoice: ChoiceOption<T>) => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      ensureRawMode(wasRaw);

      // Render finalized concise badge
      process.stdout.write(`\r\x1b[1A\r\x1b[2K  ${style.bold(message)} ${style.cyan(`[${confirmedChoice.key}] ${confirmedChoice.label}`)}\n\r\x1b[2K`);
      resolve(confirmedChoice.value);
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;

      // Ctrl+C -> default / reject
      if (key.ctrl && key.name === "c") {
        const def = choices[defaultIndex] || choices[0];
        cleanup(def!);
        return;
      }

      // Left / Up -> previous
      if (key.name === "left" || key.name === "up" || key.name === "h" || key.name === "k") {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        return;
      }

      // Right Arrow
      if (key.name === "right" || key.name === "tab") {
        selectedIndex = (selectedIndex + 1) % choices.length;
        process.stdout.write("\x1b[1A");
        render();
        return;
      }

      // Single-key hotkey match
      const char = _str ? _str.toLowerCase() : key.name ? key.name.toLowerCase() : "";
      if (char) {
        const directMatch = choices.find((c) => c.key.toLowerCase() === char);
        if (directMatch) {
          cleanup(directMatch);
          return;
        }
      }
    };

    process.stdin.on("keypress", onKeypress);
    render();
  });
}

/**
 * Grok-style Interactive Approval Card & Prompt.
 * Displays left-border │ gutter, title + command, numbered (●)/(○) radios, and
 * footer hint: 1/3:select │ Ctrl+o:yolo │ Ctrl+c:cancel.
 */
export async function promptToolApproval(params: {
  toolName: string;
  description: string;
  command?: string;
}): Promise<"yes" | "no" | "always"> {
  const options = [
    { key: "a", label: "Yes, and don't ask again for anything (always-approve mode)", value: "always" as const },
    { key: "y", label: "Yes, proceed", value: "yes" as const, isDefault: true },
    { key: "n", label: "No, reject (type to add feedback)", value: "no" as const },
  ];

  const title = params.description || `Tool Execution: ${params.toolName}`;
  const command = params.command || params.toolName;

  const BORDER = "\x1b[38;5;8m│\x1b[0m"; // gray gutter
  const FG = "\x1b[38;2;225;225;225m";
  const MUTED = "\x1b[38;2;139;139;144m";
  const DIM = "\x1b[38;2;108;108;108m";
  const RESET = "\x1b[0m";

  console.log();
  console.log(`  ${BORDER} ${FG}${title}${RESET}`);
  console.log(`  ${BORDER} ${MUTED}${command}${RESET}`);
  console.log(`  ${BORDER}`);

  const renderCard = (selected: number) => {
    for (let i = 0; i < options.length; i++) {
      const opt = options[i]!;
      const active = i === selected;
      const radio = active ? `${FG}(●)${RESET}` : `${DIM}(○)${RESET}`;
      const num = `${FG}${i + 1}${RESET}`;
      const label = active ? `\x1b[1m${FG}${opt.label}${RESET}` : `${MUTED}${opt.label}${RESET}`;
      console.log(`  ${BORDER} ${num} ${radio} ${label}`);
    }
    console.log(`  ${BORDER}`);
    console.log(`  ${FG}${selected + 1}/${options.length}${RESET}${DIM}:select │ ${FG}Ctrl+o${RESET}${DIM}:yolo │ ${FG}Ctrl+c${RESET}${DIM}:cancel${RESET}`);
  };

  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    renderCard(1);
    return "yes";
  }

  return new Promise<"yes" | "no" | "always">((resolve) => {
    let selectedIndex = 1; // default to "Yes, proceed"

    const wasRaw = process.stdin.isRaw ?? false;
    ensureRawMode(true);

    const render = () => {
      renderCard(selectedIndex);
    };

    let unsubscribe: (() => void) | null = null;

    const cleanup = (val: "yes" | "no" | "always") => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      ensureRawMode(wasRaw);
      console.log();
      resolve(val);
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;

      if (key.ctrl && key.name === "c") {
        cleanup("no");
        return;
      }
      if (key.ctrl && key.name === "o") {
        cleanup("always");
        return;
      }

      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        process.stdout.write(`\x1b[5A`);
        render();
        return;
      }
      if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % options.length;
        process.stdout.write(`\x1b[5A`);
        render();
        return;
      }

      if (key.name === "return" || key.name === "enter" || _str === " ") {
        cleanup(options[selectedIndex]!.value);
        return;
      }

      if (_str === "1") { cleanup(options[0]!.value); return; }
      if (_str === "2") { cleanup(options[1]!.value); return; }
      if (_str === "3") { cleanup(options[2]!.value); return; }
      if (_str?.toLowerCase() === "y") { cleanup("yes"); return; }
      if (_str?.toLowerCase() === "n") { cleanup("no"); return; }
      if (_str?.toLowerCase() === "a") { cleanup("always"); return; }
    };

    unsubscribe = addGlobalKeypressListener(onKeypress);
    render();
  });
}

export interface PromptQuestionParams {
  question: string;
  options?: string[];
}

/**
 * Interactive Question & Choice Selector for Agent Elicitation / Clarifications.
 * Displays questions, numbered choices with (Recommended) highlights, and free-text write-in.
 */
export async function promptUserQuestion(params: PromptQuestionParams): Promise<string> {
  const { question, options = [] } = params;
  const boxWidth = Math.min(process.stdout.columns ?? 80, 75);
  const border = "─".repeat(Math.max(10, boxWidth - 20));

  console.log(`\n  ${style.cyan("┌──")} ${style.bold("AI Question")} ${style.cyan(border)}`);

  const qLines = question.split("\n");
  for (const line of qLines) {
    console.log(`  ${style.cyan("│")}  ${style.bold(line)}`);
  }

  if (options.length > 0) {
    console.log(`  ${style.cyan("│")}`);
    options.forEach((opt, idx) => {
      const numTag = style.cyan(`[${idx + 1}]`);
      const isRec = opt.includes("(Recommended)") || opt.includes("(recommended)");
      const optText = isRec
        ? opt.replace(/\(Recommended\)/i, style.green("(Recommended)"))
        : opt;
      console.log(`  ${style.cyan("│")}  ${numTag} ${optText}`);
    });
  }
  console.log(`  ${style.cyan("└" + "─".repeat(Math.max(10, boxWidth - 4)))}\n`);

  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    return options[0] || "yes";
  }

  return new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const promptLabel = options.length > 0
      ? `Select [1-${options.length}] or type custom response: `
      : `Your response: `;

    rl.question(`  ${style.bold(promptLabel)}`, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!trimmed) {
        const fallback = options[0] || "";
        console.log(style.dim(`  ↳ Default: ${fallback || "(empty)"}\n`));
        resolve(fallback);
        return;
      }

      // 1. Check numeric choice
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        const picked = options[num - 1]!;
        console.log(style.green(`  ✔ Selected: ${picked}\n`));
        resolve(picked);
        return;
      }

      // 2. Check y/yes / n/no shorthand if options length is 2 (e.g. Yes/No)
      if (options.length === 2) {
        if (/^(y|yes)$/i.test(trimmed)) {
          console.log(style.green(`  ✔ Selected: ${options[0]}\n`));
          resolve(options[0]!);
          return;
        }
        if (/^(n|no)$/i.test(trimmed)) {
          console.log(style.green(`  ✔ Selected: ${options[1]}\n`));
          resolve(options[1]!);
          return;
        }
      }

      // 3. Custom write-in response
      console.log(style.green(`  ✔ Answer: ${trimmed}\n`));
      resolve(trimmed);
    });
  });
}

export interface InteractiveListItem {
  id: string;
  label: string;
  description?: string;
  badge?: string;
  checked?: boolean;
  disabled?: boolean;
}

export interface InteractiveListConfig {
  title: string;
  items: InteractiveListItem[];
  mode?: "select" | "toggle";
  defaultIndex?: number;
  maxVisible?: number;
  emptyMessage?: string;
  onToggle?: (item: InteractiveListItem, index: number) => void | Promise<void>;
  onAction?: (keyName: string, item: InteractiveListItem, index: number) => boolean | Promise<boolean>;
  customKeyHints?: string;
}

export interface InteractiveListResult {
  selectedIndex: number;
  selectedItem?: InteractiveListItem;
  action: "select" | "toggle" | "close" | "custom";
  keyName?: string;
}

/**
 * Interactive full-screen / scrollable list selector and toggle manager.
 * Supports ↑/↓ navigation, Space to toggle, Enter to confirm, and custom hotkeys.
 */
export async function promptInteractiveList(config: InteractiveListConfig): Promise<InteractiveListResult> {
  const {
    title,
    items,
    mode = "select",
    defaultIndex = 0,
    maxVisible = 8,
    emptyMessage = "No items available.",
    onToggle,
    onAction,
    customKeyHints,
  } = config;

  if (!process.stdin.isTTY || process.env.NODE_ENV === "test" || !process.stdin.readable) {
    return {
      selectedIndex: defaultIndex,
      selectedItem: items[defaultIndex] || items[0],
      action: "select",
    };
  }

  if (items.length === 0) {
    console.log(`\n  ${style.dim(emptyMessage)}\n`);
    return { selectedIndex: -1, action: "close" };
  }

  return new Promise<InteractiveListResult>((resolve) => {
    let selectedIndex = Math.max(0, Math.min(defaultIndex, items.length - 1));
    let scrollTop = 0;
    let renderedLines = 0;

    const wasRaw = process.stdin.isRaw ?? false;
    ensureRawMode(true);

    // Hide cursor during interactive menu navigation to prevent cursor jump flicker
    process.stdout.write("\x1b[?25l");

    const BOX_WIDTH = Math.min(process.stdout.columns ?? 80, 76);

    const ensureVisible = () => {
      const visibleCount = Math.min(items.length, maxVisible);
      if (selectedIndex < scrollTop) {
        scrollTop = selectedIndex;
      } else if (selectedIndex >= scrollTop + visibleCount) {
        scrollTop = selectedIndex + 1 - visibleCount;
      }
      if (scrollTop < 0) scrollTop = 0;
      const maxScroll = Math.max(0, items.length - visibleCount);
      if (scrollTop > maxScroll) scrollTop = maxScroll;
    };

    const render = () => {
      ensureVisible();

      const visibleCount = Math.min(items.length, maxVisible);
      const visibleItems = items.slice(scrollTop, scrollTop + visibleCount);
      const lines: string[] = [];

      // 1. Header
      const headerBorder = "─".repeat(Math.max(10, BOX_WIDTH - title.length - 8));
      lines.push(`  \x1b[38;2;140;140;150m┌──\x1b[0m ${style.bold(title)} \x1b[38;2;140;140;150m${headerBorder}┐\x1b[0m`);

      // 2. Items
      for (let i = 0; i < visibleItems.length; i++) {
        const item = visibleItems[i]!;
        const actualIdx = scrollTop + i;
        const isCurrent = actualIdx === selectedIndex;
        const marker = isCurrent ? "\x1b[38;2;217;119;87m❯\x1b[0m" : " ";

        let checkSymbol = "";
        if (mode === "toggle") {
          checkSymbol = item.checked
            ? "\x1b[38;2;78;169;111m[✔ ENABLED]\x1b[0m "
            : "\x1b[38;2;120;120;125m[○ DISABLED]\x1b[0m";
        } else if (item.checked !== undefined) {
          checkSymbol = item.checked
            ? "\x1b[38;2;78;169;111m(●)\x1b[0m "
            : "\x1b[38;2;120;120;125m(○)\x1b[0m ";
        }

        const badgeStr = item.badge ? ` ${style.dim(`(${item.badge})`)}` : "";
        const labelStr = isCurrent ? style.bold(item.label) : item.label;

        lines.push(`  \x1b[38;2;140;140;150m│\x1b[0m ${marker} ${checkSymbol} ${labelStr}${badgeStr}`);
        if (item.description) {
          const descIndent = " ".repeat(mode === "toggle" ? 17 : 7);
          const maxDescLen = BOX_WIDTH - descIndent.length - 6;
          const trimmedDesc = item.description.length > maxDescLen
            ? item.description.slice(0, maxDescLen - 3) + "..."
            : item.description;
          lines.push(`  \x1b[38;2;140;140;150m│\x1b[0m ${descIndent}${style.dim(trimmedDesc)}`);
        }
      }

      // 3. Scroll indicator / footer
      const moreAbove = scrollTop;
      const moreBelow = Math.max(0, items.length - (scrollTop + visibleCount));
      let scrollInfo = "";
      if (moreAbove > 0 && moreBelow > 0) {
        scrollInfo = `[↑ ${moreAbove} more · ↓ ${moreBelow} more]`;
      } else if (moreBelow > 0) {
        scrollInfo = `[↓ ${moreBelow} more below]`;
      } else if (moreAbove > 0) {
        scrollInfo = `[↑ ${moreAbove} more above]`;
      }

      const defaultHints = mode === "toggle"
        ? "↑/↓: navigate · Space: toggle · a: all · d: none · Enter/Esc: done"
        : "↑/↓: navigate · Enter: select · Esc: cancel";
      const hintText = customKeyHints || (scrollInfo ? `${scrollInfo} ${defaultHints}` : defaultHints);

      lines.push(`  \x1b[38;2;140;140;150m│\x1b[0m`);
      lines.push(`  \x1b[38;2;140;140;150m│\x1b[0m  ${style.dim(hintText)}`);
      lines.push(`  \x1b[38;2;140;140;150m└──${"─".repeat(Math.max(10, BOX_WIDTH - 6))}┘\x1b[0m`);

      // Atomic overwrite to eliminate terminal tearing / flicker
      let buffer = "";
      if (renderedLines > 0) {
        buffer += `\x1b[${renderedLines}A\r`;
      }
      buffer += lines.map((l) => `\x1b[2K${l}`).join("\n") + "\n";
      if (renderedLines > lines.length) {
        buffer += "\x1b[J";
      }

      process.stdout.write(buffer);
      renderedLines = lines.length;
    };

    let unsubscribe: (() => void) | null = null;

    const cleanup = (res: InteractiveListResult) => {
      // Clear menu box and restore cursor
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A\r\x1b[J\x1b[?25h`);
        renderedLines = 0;
      } else {
        process.stdout.write("\x1b[?25h");
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      ensureRawMode(wasRaw);
      resolve(res);
    };

    const onKeypress = async (_str: string, key: readline.Key) => {
      if (!key) return;

      // Ctrl+C / Escape / q
      if ((key.ctrl && key.name === "c") || key.name === "escape" || _str === "q" || _str === "Q") {
        cleanup({
          selectedIndex,
          selectedItem: items[selectedIndex],
          action: "close",
        });
        return;
      }

      // Up Arrow / k
      if (key.name === "up" || _str === "k") {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
        render();
        return;
      }

      // Down Arrow / j
      if (key.name === "down" || _str === "j") {
        selectedIndex = (selectedIndex + 1) % items.length;
        render();
        return;
      }

      // Space / t -> Toggle
      if (_str === " " || _str === "t" || _str === "T") {
        const item = items[selectedIndex];
        if (item) {
          item.checked = !item.checked;
          if (onToggle) {
            await onToggle(item, selectedIndex);
          }
        }
        render();
        return;
      }

      // Enter
      if (key.name === "return" || key.name === "enter") {
        if (mode === "toggle") {
          cleanup({
            selectedIndex,
            selectedItem: items[selectedIndex],
            action: "close",
          });
        } else {
          cleanup({
            selectedIndex,
            selectedItem: items[selectedIndex],
            action: "select",
          });
        }
        return;
      }

      // Custom action handler (e.g. 'd' for delete, 'a' for enable-all, etc.)
      if (_str && onAction) {
        const item = items[selectedIndex]!;
        const shouldExit = await onAction(_str.toLowerCase(), item, selectedIndex);
        if (shouldExit) {
          cleanup({
            selectedIndex,
            selectedItem: item,
            action: "custom",
            keyName: _str.toLowerCase(),
          });
          return;
        }
        render();
      }
    };

    unsubscribe = addGlobalKeypressListener(onKeypress);
    render();
  });
}

