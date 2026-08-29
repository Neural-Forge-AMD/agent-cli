/**
 * Live Terminal Spinner with smooth async animation.
 */

import { c, style } from "./colors";

export class LiveSpinner {
  private frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private currentMessage = "";
  private isSpinning = false;

  start(message = "Thinking..."): void {
    if (this.isSpinning) {
      this.update(message);
      return;
    }

    this.isSpinning = true;
    this.currentMessage = message;
    this.frameIndex = 0;

    // Render immediately
    this.render();

    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, 80);
  }

  update(message: string): void {
    this.currentMessage = message;
    if (this.isSpinning) {
      this.render();
    }
  }

  setText(message: string): void {
    this.update(message);
  }

  private render(): void {
    const frame = this.frames[this.frameIndex];
    const output = `\r\x1b[K${c.cyan}${frame}${c.reset} ${c.dim}${this.currentMessage}${c.reset}`;
    process.stdout.write(output);
  }

  stop(finalMessage?: string, success = true): void {
    if (!this.isSpinning) return;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isSpinning = false;

    // Clear the current line
    process.stdout.write("\r\x1b[K");

    if (finalMessage) {
      const icon = success ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
      console.log(`${icon} ${finalMessage}`);
    }
  }

  clear(): void {
    if (this.isSpinning) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.isSpinning = false;
      process.stdout.write("\r\x1b[K");
    }
  }

  isActive(): boolean {
    return this.isSpinning;
  }
}
