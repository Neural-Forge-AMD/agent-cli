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
 * Interactive Approval Card & Prompt.
 * Displays clean tool execution details and returns "yes" | "no" | "always".
 */
export async function promptToolApproval(params: {
  toolName: string;
  description: string;
  command?: string;
}): Promise<"yes" | "no" | "always"> {
  const boxWidth = Math.min(process.stdout.columns ?? 80, 70);
  const border = "─".repeat(Math.max(10, boxWidth - 24));

  console.log(`\n  ${style.yellow("┌──")} ${style.bold("Approval Required")} ${style.yellow(border)}`);
  console.log(`  ${style.yellow("│")}  ${style.dim("Tool:")}    ${style.bold(params.toolName)}`);
  if (params.command) {
    console.log(`  ${style.yellow("│")}  ${style.dim("Command:")} ${style.cyan(params.command)}`);
  }
  console.log(`  ${style.yellow("│")}  ${style.dim("Reason:")}  ${style.dim(params.description)}`);
  console.log(`  ${style.yellow("└" + "─".repeat(Math.max(10, boxWidth - 4)))}\n`);

  const decision = await promptChoice<"yes" | "no" | "always">({
    message: "Allow execution?",
    choices: [
      { key: "y", label: "Yes", value: "yes", isDefault: true },
      { key: "n", label: "No", value: "no" },
      { key: "a", label: "Always allow this session", value: "always" },
    ],
    defaultIndex: 0,
  });

  return decision;
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
