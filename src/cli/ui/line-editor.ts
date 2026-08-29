/**
 * Interactive Raw-Mode Line Editor with Real-Time Floating Slash Commands Menu.
 * Directly replicates Codex & Claude Code TUI popup suggestions.
 */

import readline from "node:readline";
import { c, style } from "./colors";
import { AVAILABLE_SLASH_COMMANDS, type SlashCommandDef } from "../commands";

export interface LineEditorOptions {
  promptSymbol?: string;
  onInterrupt?: () => void;
}

// Global safety state for Windows Bun terminal
let keypressEventsInitialized = false;
let globalRawMode = false;

function ensureKeypressInitialized() {
  if (!keypressEventsInitialized && process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    keypressEventsInitialized = true;

    // Safety restore on unhandled exit
    process.on("exit", () => {
      if (globalRawMode && process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {}
      }
    });
  }
}

export class InteractiveLineEditor {
  private promptSymbol: string;
  private onInterrupt?: () => void;

  constructor(options: LineEditorOptions = {}) {
    this.promptSymbol = options.promptSymbol || `${c.brandBold}❯${c.reset} `;
    this.onInterrupt = options.onInterrupt;
  }

  async readLine(): Promise<string> {
    if (!process.stdin.isTTY) {
      // Fallback for non-TTY / piped environments
      return new Promise((resolve) => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(this.promptSymbol, (answer) => {
          rl.close();
          resolve(answer);
        });
      });
    }

    ensureKeypressInitialized();

    return new Promise((resolve) => {
      let buffer = "";
      let cursor = 0;
      let selectedIndex = 0;
      let renderedMenuLines = 0;
      let popupDismissed = false;

      if (!globalRawMode && process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
          globalRawMode = true;
        } catch {}
      }
      process.stdin.resume();

      const getMatchingCommands = (): SlashCommandDef[] => {
        if (!buffer.startsWith("/") || popupDismissed) return [];
        const term = buffer.toLowerCase();
        const matches = AVAILABLE_SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(term));
        return matches.length > 0 ? matches : AVAILABLE_SLASH_COMMANDS;
      };

      const clearMenu = () => {
        if (renderedMenuLines > 0) {
          // Move down and clear each menu line
          for (let i = 0; i < renderedMenuLines; i++) {
            process.stdout.write("\n\x1b[2K");
          }
          // Move back up to prompt line
          process.stdout.write(`\x1b[${renderedMenuLines}A\r`);
          renderedMenuLines = 0;
        }
      };

      const redraw = () => {
        // Clear menu first
        clearMenu();

        // Clear current line and redraw prompt + buffer
        process.stdout.write(`\r\x1b[2K${this.promptSymbol}${buffer}`);

        // If typing slash command, draw popup suggestions box
        const matches = getMatchingCommands();
        if (buffer.startsWith("/") && !popupDismissed && matches.length > 0) {
          const maxVisible = Math.min(matches.length, 8);
          if (selectedIndex >= matches.length) selectedIndex = 0;
          if (selectedIndex < 0) selectedIndex = matches.length - 1;

          const menuLines: string[] = [];
          menuLines.push(`  ${style.dim("┌──────────────────────────────────────────────────────────┐")}`);

          for (let i = 0; i < maxVisible; i++) {
            const cmd = matches[i]!;
            const isSelected = i === selectedIndex;
            const marker = isSelected ? style.brand("❯") : " ";
            const name = isSelected ? style.brandBold(cmd.name.padEnd(12)) : style.cyan(cmd.name.padEnd(12));
            const desc = isSelected ? style.bold(cmd.description.padEnd(38)) : style.dim(cmd.description.padEnd(38));

            menuLines.push(`  ${style.dim("│")} ${marker} ${name} ${desc} ${style.dim("│")}`);
          }

          if (matches.length > maxVisible) {
            const moreCount = matches.length - maxVisible;
            menuLines.push(`  ${style.dim(`│   ... and ${moreCount} more commands (use arrows to scroll)`).padEnd(68)} ${style.dim("│")}`);
          }

          menuLines.push(`  ${style.dim("└──────────────────────────────────────────────────────────┘")}`);

          // Render menu below prompt
          for (const line of menuLines) {
            process.stdout.write(`\n\x1b[2K${line}`);
          }
          renderedMenuLines = menuLines.length;

          // Move cursor back up to prompt line
          process.stdout.write(`\x1b[${renderedMenuLines}A`);
        }

        // Place physical cursor at current buffer cursor position
        const visiblePromptLength = this.promptSymbol.replace(/\x1b\[[0-9;]*m/g, "").length;
        const cursorCol = visiblePromptLength + cursor;
        if (cursorCol > 0) {
          process.stdout.write(`\r\x1b[${cursorCol}C`);
        } else {
          process.stdout.write("\r");
        }
      };

      const cleanupAndResolve = (result: string) => {
        clearMenu();
        process.stdin.removeListener("keypress", onKeypress);
        process.stdout.write("\n");
        resolve(result);
      };

      const onKeypress = (_str: string, key: readline.Key) => {
        if (!key) return;

        // Ctrl+C
        if (key.ctrl && key.name === "c") {
          if (buffer.length > 0) {
            buffer = "";
            cursor = 0;
            selectedIndex = 0;
            popupDismissed = false;
            redraw();
            return;
          }
          clearMenu();
          if (globalRawMode && process.stdin.isTTY) {
            try {
              process.stdin.setRawMode(false);
              globalRawMode = false;
            } catch {}
          }
          process.stdin.removeListener("keypress", onKeypress);
          if (this.onInterrupt) {
            this.onInterrupt();
          }
          process.stdout.write("\n");
          process.exit(0);
        }

        // Escape: dismiss popup if visible
        if (key.name === "escape") {
          if (renderedMenuLines > 0) {
            popupDismissed = true;
            clearMenu();
            redraw();
            return;
          }
        }

        // Ctrl+D (EOF)
        if (key.ctrl && key.name === "d") {
          cleanupAndResolve("/exit");
          return;
        }

        // Enter
        if (key.name === "return" || key.name === "enter") {
          const matches = getMatchingCommands();
          if (buffer.startsWith("/") && !popupDismissed && matches.length > 0 && selectedIndex >= 0 && selectedIndex < matches.length) {
            const selected = matches[selectedIndex]!;
            cleanupAndResolve(selected.name);
            return;
          }
          cleanupAndResolve(buffer);
          return;
        }

        // Tab Autocomplete
        if (key.name === "tab") {
          const matches = getMatchingCommands();
          if (matches.length > 0) {
            const match = matches[selectedIndex] || matches[0];
            if (match) {
              buffer = match.name + " ";
              cursor = buffer.length;
              selectedIndex = 0;
              popupDismissed = false;
              redraw();
            }
          }
          return;
        }

        // Up Arrow
        if (key.name === "up") {
          const matches = getMatchingCommands();
          if (matches.length > 0) {
            selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
            redraw();
            return;
          }
        }

        // Down Arrow
        if (key.name === "down") {
          const matches = getMatchingCommands();
          if (matches.length > 0) {
            selectedIndex = (selectedIndex + 1) % matches.length;
            redraw();
            return;
          }
        }

        // Left Arrow
        if (key.name === "left") {
          if (cursor > 0) {
            cursor--;
            redraw();
          }
          return;
        }

        // Right Arrow
        if (key.name === "right") {
          if (cursor < buffer.length) {
            cursor++;
            redraw();
          }
          return;
        }

        // Backspace
        if (key.name === "backspace") {
          if (cursor > 0) {
            buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
            cursor--;
            selectedIndex = 0;
            popupDismissed = false;
            redraw();
          }
          return;
        }

        // Normal typing character
        if (_str && !key.ctrl && !key.meta) {
          buffer = buffer.slice(0, cursor) + _str + buffer.slice(cursor);
          cursor += _str.length;
          selectedIndex = 0;
          popupDismissed = false;
          redraw();
        }
      };

      process.stdin.on("keypress", onKeypress);

      // Initial prompt render
      process.stdout.write(this.promptSymbol);
    });
  }
}
