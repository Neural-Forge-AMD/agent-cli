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
