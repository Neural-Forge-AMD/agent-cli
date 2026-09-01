import readline from "node:readline";
import { c, style } from "./colors";
import { AVAILABLE_SLASH_COMMANDS, type SlashCommandDef } from "../commands";
import { FileSearchEngine } from "../../search/engine";
import { CliFormatter } from "./formatter";

export type ClaudeMode = "auto" | "manual" | "accept-edits" | "plan";

export interface LineEditorOptions {
  promptSymbol?: string;
  cwd?: string;
  initialMode?: ClaudeMode;
  onInterrupt?: () => void;
  onModeChange?: (mode: ClaudeMode) => void;
}

// Global safety state for Windows Bun terminal
let keypressEventsInitialized = false;

function ensureKeypressInitialized() {
  if (!keypressEventsInitialized && process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    keypressEventsInitialized = true;

    // Safety restore on unhandled exit
    process.on("exit", () => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {}
      }
    });
  }
}

export class InteractiveLineEditor {
  private promptSymbol: string;
  private cwd: string;
  private mode: ClaudeMode;
  private onInterrupt?: () => void;
  private onModeChange?: (mode: ClaudeMode) => void;
  private searchEngine = new FileSearchEngine();

  constructor(options: LineEditorOptions = {}) {
    this.promptSymbol = options.promptSymbol || "  \x1b[38;2;192;202;245m❯\x1b[0m ";
    this.cwd = options.cwd || process.cwd();
    this.mode = options.initialMode || "auto";
    this.onInterrupt = options.onInterrupt;
    this.onModeChange = options.onModeChange;
  }

  public getMode(): ClaudeMode {
    return this.mode;
  }

  public setMode(mode: ClaudeMode): void {
    this.mode = mode;
    this.onModeChange?.(mode);
  }

  public cycleMode(): ClaudeMode {
    const modes: ClaudeMode[] = ["auto", "manual", "accept-edits", "plan"];
    const nextIdx = (modes.indexOf(this.mode) + 1) % modes.length;
    const next = modes[nextIdx]!;
    this.setMode(next);
    return next;
  }

  public cycleModeReverse(): ClaudeMode {
    const modes: ClaudeMode[] = ["auto", "manual", "accept-edits", "plan"];
    const nextIdx = (modes.indexOf(this.mode) - 1 + modes.length) % modes.length;
    const next = modes[nextIdx]!;
    this.setMode(next);
    return next;
  }

  private getModeLine(): string {
    switch (this.mode) {
      case "auto":
        return `  \x1b[38;2;255;215;0m⏵⏵ auto mode on\x1b[0m \x1b[38;2;148;148;148m(shift+tab to cycle) · ⇠ for agents\x1b[0m`;
      case "manual":
        return `  \x1b[38;2;148;148;148m⏸ manual mode on · ? for shortcuts · ⇠ for agents\x1b[0m`;
      case "accept-edits":
        return `  \x1b[38;2;175;175;215m⏵⏵ accept edits on\x1b[0m \x1b[38;2;148;148;148m(shift+tab to cycle) · ⇠ for agents\x1b[0m`;
      case "plan":
        return `  \x1b[38;2;95;175;175m⏸ plan mode on\x1b[0m \x1b[38;2;148;148;148m(shift+tab to cycle) · ⇠ for agents\x1b[0m`;
    }
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
      let scrollTop = 0;
      let renderedMenuLines = 0;
      let popupDismissed = false;

      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(true);
        } catch {}
      }
      process.stdin.resume();

      const getMatchingCommands = (): SlashCommandDef[] => {
        if (!buffer.startsWith("/") || popupDismissed) return [];
        const term = buffer.toLowerCase();
        const matches = AVAILABLE_SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(term));
        return matches.length > 0 ? matches : AVAILABLE_SLASH_COMMANDS;
      };

      const getActiveFileQuery = (): { query: string; atIndex: number } | null => {
        if (popupDismissed) return null;
        const beforeCursor = buffer.slice(0, cursor);
        const match = beforeCursor.match(/(?:^|\s)@([^\s]*)$/);
        if (!match) return null;
        const query = match[1] ?? "";
        const atIndex = beforeCursor.lastIndexOf("@");
        return { query, atIndex };
      };

      const getMatchingFiles = (fileQuery: string): string[] => {
        try {
          return this.searchEngine.findFiles(this.cwd, {
            pattern: fileQuery,
            maxResults: 30,
          });
        } catch {
          return [];
        }
      };

      const getRule = () => {
        const cols = typeof process.stdout?.columns === "number" ? process.stdout.columns : 80;
        const ruleLen = Math.min(cols - 4, 70);
        return "─".repeat(Math.max(10, ruleLen));
      };

      const ensureVisible = (totalItems: number, visibleRows: number) => {
        if (totalItems === 0 || visibleRows === 0) {
          scrollTop = 0;
          return;
        }
        if (selectedIndex < 0) selectedIndex = 0;
        if (selectedIndex >= totalItems) selectedIndex = totalItems - 1;

        if (selectedIndex < scrollTop) {
          scrollTop = selectedIndex;
        } else if (selectedIndex >= scrollTop + visibleRows) {
          scrollTop = selectedIndex + 1 - visibleRows;
        }
        if (scrollTop < 0) scrollTop = 0;
        const maxScroll = Math.max(0, totalItems - visibleRows);
        if (scrollTop > maxScroll) scrollTop = maxScroll;
      };

      const clearMenu = () => {
        if (renderedMenuLines > 0) {
          process.stdout.write("\x1b[J");
          renderedMenuLines = 0;
        }
      };

      const redraw = () => {
        // Clear anything below current prompt line
        process.stdout.write("\x1b[J");

        // Render input prompt + buffer
        process.stdout.write(`\r\x1b[2K${this.promptSymbol}${buffer}`);

        const slashMatches = getMatchingCommands();
        const activeFile = getActiveFileQuery();
        const fileMatches = activeFile ? getMatchingFiles(activeFile.query) : [];

        if (buffer.startsWith("/") && !popupDismissed && slashMatches.length > 0) {
          // 1. Slash commands popup
          const BOX_WIDTH = 70;
          const maxVisible = Math.min(slashMatches.length, 7);

          ensureVisible(slashMatches.length, maxVisible);
          const visibleMatches = slashMatches.slice(scrollTop, scrollTop + maxVisible);

          const menuLines: string[] = [];
          const rule = "─".repeat(Math.min(BOX_WIDTH, 68));
          const RULE_COLOR = "\x1b[38;2;80;80;88m";
          const ACTIVE_COLOR = "\x1b[38;2;225;225;225m";
          const INACTIVE_COLOR = "\x1b[38;2;139;139;144m";
          const RESET = "\x1b[0m";

          menuLines.push(`  ${RULE_COLOR}${rule}${RESET}`);

          for (let i = 0; i < visibleMatches.length; i++) {
            const cmd = visibleMatches[i]!;
            const actualIdx = scrollTop + i;
            const isSelected = actualIdx === selectedIndex;
            const marker = isSelected ? `${ACTIVE_COLOR}❯${RESET}` : " ";

            const rawName = cmd.name.padEnd(16).slice(0, 16);
            const rawDesc = cmd.description.length > 48
              ? cmd.description.slice(0, 45) + "..."
              : cmd.description;

            if (isSelected) {
              menuLines.push(`  ${marker} \x1b[1m${ACTIVE_COLOR}${rawName}${RESET}  \x1b[1m${ACTIVE_COLOR}${rawDesc}${RESET}`);
            } else {
              menuLines.push(`  ${marker} ${INACTIVE_COLOR}${rawName}${RESET}  ${INACTIVE_COLOR}${rawDesc}${RESET}`);
            }
          }

          menuLines.push(`  ${RULE_COLOR}${rule}${RESET}`);

          for (const line of menuLines) {
            process.stdout.write(`\n\x1b[2K${line}`);
          }
          renderedMenuLines = menuLines.length;
          process.stdout.write(`\x1b[${renderedMenuLines}A`);
        } else if (activeFile && !popupDismissed && fileMatches.length > 0) {
          // 2. @file Autocomplete popup
          const BOX_WIDTH = 70;
          const maxVisible = Math.min(fileMatches.length, 7);

          ensureVisible(fileMatches.length, maxVisible);
          const visibleMatches = fileMatches.slice(scrollTop, scrollTop + maxVisible);

          const menuLines: string[] = [];
          menuLines.push(`  ${style.dim("┌──")} ${style.brandBold("Files")} ${style.dim("─".repeat(Math.max(10, BOX_WIDTH - 9)) + "┐")}`);

          for (let i = 0; i < visibleMatches.length; i++) {
            const filePath = visibleMatches[i]!;
            const actualIdx = scrollTop + i;
            const isSelected = actualIdx === selectedIndex;
            const marker = isSelected ? style.brand("❯") : " ";

            const rawPath = filePath.length > 62 ? "..." + filePath.slice(filePath.length - 59) : filePath.padEnd(62);
            const coloredPath = isSelected ? style.brandBold(rawPath) : style.cyan(rawPath);

            menuLines.push(`  ${style.dim("│")} ${marker} ${coloredPath} ${style.dim("│")}`);
          }

          let footerMsg = "";
          const moreAbove = scrollTop;
          const moreBelow = Math.max(0, fileMatches.length - (scrollTop + visibleMatches.length));

          if (moreAbove > 0 && moreBelow > 0) {
            footerMsg = `  ... ${moreAbove} more above, ${moreBelow} more below (↑/↓ to scroll)`;
          } else if (moreBelow > 0) {
            footerMsg = `  ... and ${moreBelow} more files (use arrows • Tab to insert)`;
          } else if (moreAbove > 0) {
            footerMsg = `  ... and ${moreAbove} more files above (use arrows • Tab to insert)`;
          } else {
            footerMsg = `  ${fileMatches.length} files (↑/↓ to navigate • Tab to insert)`;
          }

          const footerPadded = footerMsg.padEnd(BOX_WIDTH).slice(0, BOX_WIDTH);
          menuLines.push(`  ${style.dim("│")}${style.dim(footerPadded)}${style.dim("│")}`);
          menuLines.push(`  ${style.dim("└" + "─".repeat(BOX_WIDTH) + "┘")}`);

          for (const line of menuLines) {
            process.stdout.write(`\n\x1b[2K${line}`);
          }
          renderedMenuLines = menuLines.length;
          process.stdout.write(`\x1b[${renderedMenuLines}A`);
        } else {
          // 3. Brainless Dual-rule Bottom Bar & Mode Status Line
          const RULE_COLOR = "\x1b[38;2;60;60;68m";
          const bottomRule = `  ${RULE_COLOR}${getRule()}\x1b[0m`;
          const modeLine = this.getModeLine();

          process.stdout.write(`\n\x1b[2K${bottomRule}\n\x1b[2K${modeLine}`);
          renderedMenuLines = 2;
          process.stdout.write(`\x1b[2A`);
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
        if (process.stdin.isTTY) {
          try {
            process.stdin.setRawMode(false);
          } catch {}
        }
        if (result.trim().length > 0 && !result.startsWith("/")) {
          process.stdout.write(`\r\x1b[2K${CliFormatter.formatClaudeUserPrompt(result)}\n\n`);
        } else {
          process.stdout.write("\n");
        }
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
            scrollTop = 0;
            popupDismissed = false;
            redraw();
            return;
          }
          clearMenu();
          if (process.stdin.isTTY) {
            try {
              process.stdin.setRawMode(false);
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

        const slashMatches = getMatchingCommands();
        const activeFile = getActiveFileQuery();
        const fileMatches = activeFile ? getMatchingFiles(activeFile.query) : [];

        // Enter
        if (key.name === "return" || key.name === "enter") {
          // If @file popup is active, insert selected file into buffer
          if (activeFile && !popupDismissed && fileMatches.length > 0) {
            const chosen = fileMatches[selectedIndex] || fileMatches[0]!;
            const beforeAt = buffer.slice(0, activeFile.atIndex);
            const afterCursor = buffer.slice(cursor);
            buffer = `${beforeAt}@${chosen} ${afterCursor}`;
            cursor = beforeAt.length + chosen.length + 2;
            selectedIndex = 0;
            scrollTop = 0;
            popupDismissed = false;
            redraw();
            return;
          }

          // If slash commands popup is active, execute selected command
          if (buffer.startsWith("/") && !popupDismissed && slashMatches.length > 0 && selectedIndex >= 0 && selectedIndex < slashMatches.length) {
            const selected = slashMatches[selectedIndex]!;
            cleanupAndResolve(selected.name);
            return;
          }

          cleanupAndResolve(buffer);
          return;
        }

        // Shift+Tab -> Cycle Permission Mode (auto -> manual -> accept-edits -> plan)
        const isShiftTab =
          (key.name === "tab" && Boolean(key.shift)) ||
          key.name === "backtab" ||
          key.sequence === "\x1b[Z" ||
          _str === "\x1b[Z";

        if (isShiftTab) {
          this.cycleMode();
          redraw();
          return;
        }

        // Tab Autocomplete (for files or slash commands, or fallback to cycle mode when buffer is empty)
        if (key.name === "tab") {
          if (activeFile && !popupDismissed && fileMatches.length > 0) {
            const chosen = fileMatches[selectedIndex] || fileMatches[0]!;
            const beforeAt = buffer.slice(0, activeFile.atIndex);
            const afterCursor = buffer.slice(cursor);
            buffer = `${beforeAt}@${chosen} ${afterCursor}`;
            cursor = beforeAt.length + chosen.length + 2;
            selectedIndex = 0;
            scrollTop = 0;
            popupDismissed = false;
            redraw();
            return;
          }

          if (slashMatches.length > 0) {
            const match = slashMatches[selectedIndex] || slashMatches[0];
            if (match) {
              buffer = match.name + " ";
              cursor = buffer.length;
              selectedIndex = 0;
              scrollTop = 0;
              popupDismissed = false;
              redraw();
              return;
            }
          }

          if (buffer.trim().length === 0) {
            this.cycleMode();
            redraw();
            return;
          }
          return;
        }

        // Up Arrow
        if (key.name === "up") {
          if (activeFile && fileMatches.length > 0) {
            selectedIndex = (selectedIndex - 1 + fileMatches.length) % fileMatches.length;
            redraw();
            return;
          }
          if (slashMatches.length > 0) {
            selectedIndex = (selectedIndex - 1 + slashMatches.length) % slashMatches.length;
            redraw();
            return;
          }
        }

        // Down Arrow
        if (key.name === "down") {
          if (activeFile && fileMatches.length > 0) {
            selectedIndex = (selectedIndex + 1) % fileMatches.length;
            redraw();
            return;
          }
          if (slashMatches.length > 0) {
            selectedIndex = (selectedIndex + 1) % slashMatches.length;
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
            scrollTop = 0;
            popupDismissed = false;
            redraw();
          }
          return;
        }

        // Normal typing character
        const char = _str || key.sequence || (key.name && key.name.length === 1 ? key.name : "");
        if (char && !key.ctrl && !key.meta && char !== "\r" && char !== "\n") {
          buffer = buffer.slice(0, cursor) + char + buffer.slice(cursor);
          cursor += char.length;
          selectedIndex = 0;
          scrollTop = 0;
          popupDismissed = false;
          redraw();
        }
      };

      process.stdin.on("keypress", onKeypress);

      // Initial prompt render with top-rule
      const RULE_COLOR = "\x1b[38;2;60;60;68m";
      process.stdout.write(`\n  ${RULE_COLOR}${getRule()}\x1b[0m\n`);
      redraw();
    });
  }
}
