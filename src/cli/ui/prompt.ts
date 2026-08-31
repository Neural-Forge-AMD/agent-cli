/**
 * Interactive Prompt & Single-Key Choice Selectors for Groupy CLI.
 * Delivers instant hotkey responses and smooth terminal interactive widgets.
 */

import readline from "node:readline";
import { c, style } from "./colors";

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
      return choices[defaultIndex]?.value ?? choices[0]!.value;
    }
    // Non-TTY / piped environment fallback
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const hint = choices.map((c) => (c.isDefault ? `[${c.key.toUpperCase()}]` : `[${c.key}]`)).join("/");
      
      let resolved = false;
      const doResolve = (val: T) => {
        if (!resolved) {
          resolved = true;
          rl.close();
          resolve(val);
        }
      };

      rl.question(`${message} ${hint}: `, (answer) => {
        const trimmed = answer.trim().toLowerCase();
        const matched = choices.find((c) => c.key.toLowerCase() === trimmed);
        doResolve(matched ? matched.value : choices[defaultIndex]!.value);
      });

      rl.on("close", () => {
        doResolve(choices[defaultIndex]!.value);
      });
    });
  }

  return new Promise((resolve) => {
    let selectedIndex = defaultIndex;
    if (selectedIndex < 0 || selectedIndex >= choices.length) selectedIndex = 0;

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    try {
      process.stdin.setRawMode(true);
    } catch {}
    process.stdin.resume();

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

    const cleanup = (confirmedChoice: ChoiceOption<T>) => {
      process.stdin.removeListener("keypress", onKeypress);
      try {
        process.stdin.setRawMode(wasRaw ?? false);
      } catch {}

      // Render finalized concise badge
      process.stdout.write(`\r\x1b[1A\r\x1b[2K  ${style.bold(message)} ${style.cyan(`[${confirmedChoice.key}] ${confirmedChoice.label}`)}\n\r\x1b[2K`);
      resolve(confirmedChoice.value);
    };

    const onKeypress = (_str: string, key: readline.Key) => {
      if (!key) return;

      // Ctrl+C -> default / reject
      if (key.ctrl && key.name === "c") {
        cleanup(choices.find((c) => c.key.toLowerCase() === "n") || choices[defaultIndex]!);
        return;
      }

      // Escape -> reject / default
      if (key.name === "escape") {
        cleanup(choices.find((c) => c.key.toLowerCase() === "n") || choices[defaultIndex]!);
        return;
      }

      // Enter -> confirm current selectedIndex
      if (key.name === "return" || key.name === "enter") {
        cleanup(choices[selectedIndex]!);
        return;
      }

      // Left Arrow
      if (key.name === "left") {
        selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        // Move up 1 line to re-render properly
        process.stdout.write("\x1b[1A");
        render();
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

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    try {
      process.stdin.setRawMode(true);
    } catch {}
    process.stdin.resume();

    const render = () => {
      renderCard(selectedIndex);
    };

    const cleanup = (val: "yes" | "no" | "always") => {
      process.stdin.removeListener("keypress", onKeypress);
      try {
        process.stdin.setRawMode(wasRaw ?? false);
      } catch {}
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

    process.stdin.on("keypress", onKeypress);
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
