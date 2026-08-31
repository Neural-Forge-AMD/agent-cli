/**
 * Chrome & Chromium Browser Process Launcher with CDP Debugging Port.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GlobalProcessRegistry } from "../../process-killer";

export interface BrowserLaunchOptions {
  headless?: boolean;
  port?: number;
  userDataDir?: string;
  executablePath?: string;
  args?: string[];
}

export class BrowserLauncher {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private tempUserDataDir: string | null = null;
  private wsDebuggerUrl: string | null = null;
  private port: number = 0;

  /**
   * Auto-detects Chrome, Chromium, Edge, or Brave executable in standard system paths.
   */
  static findBrowserExecutable(): string | null {
    if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
      return process.env.CHROME_PATH;
    }

    if (process.platform === "win32") {
      const candidates = [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        join(process.env.LOCALAPPDATA || "", "BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
      ];

      for (const path of candidates) {
        if (path && existsSync(path)) return path;
      }
    } else if (process.platform === "darwin") {
      const candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      ];
      for (const path of candidates) {
        if (existsSync(path)) return path;
      }
    } else {
      // Linux
      const candidates = [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/snap/bin/chromium",
        "/usr/bin/microsoft-edge",
      ];
      for (const path of candidates) {
        if (existsSync(path)) return path;
      }
    }

    return null;
  }

  async launch(options: BrowserLaunchOptions = {}): Promise<{ wsDebuggerUrl: string; port: number }> {
    const executable = options.executablePath || BrowserLauncher.findBrowserExecutable();
    if (!executable) {
      throw new Error(
        "No supported browser (Google Chrome, Chromium, MS Edge, Brave) found on this machine. Please install Chrome or specify CHROME_PATH."
      );
    }

    this.port = options.port || (9200 + Math.floor(Math.random() * 500));
    this.tempUserDataDir = options.userDataDir || join(tmpdir(), `groupy_chrome_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(this.tempUserDataDir, { recursive: true });

    const isHeadless = options.headless ?? true;

    const launchArgs = [
      executable,
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.tempUserDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-client-side-phishing-detection",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-hang-monitor",
      "--disable-ipc-flooding-protection",
      "--disable-popup-blocking",
      "--disable-prompt-on-repost",
      "--disable-renderer-backgrounding",
      "--disable-sync",
      "--force-color-profile=srgb",
      "--metrics-recording-only",
      "--mute-audio",
      "--password-store=basic",
      "--use-mock-keychain",
      ...(isHeadless ? ["--headless=new", "--hide-scrollbars"] : []),
      ...(options.args || []),
      "about:blank",
    ];

    try {
      this.proc = Bun.spawn(launchArgs, {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });

      if (this.proc.pid) {
        GlobalProcessRegistry.register(this.proc.pid, `chrome:${this.port}`, () => this.close());
      }

      // Wait for Chrome DevTools HTTP endpoint to be active
      this.wsDebuggerUrl = await this.waitForWsDebuggerUrl(this.port, 10000);
      return { wsDebuggerUrl: this.wsDebuggerUrl, port: this.port };
    } catch (err) {
      await this.close();
      throw new Error(`Failed to launch browser (${executable}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async waitForWsDebuggerUrl(port: number, timeoutMs: number): Promise<string> {
    const startTime = Date.now();
    const endpoint = `http://127.0.0.1:${port}/json/version`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await fetch(endpoint);
        if (res.ok) {
          const data = (await res.json()) as any;
          if (data && data.webSocketDebuggerUrl) {
            return data.webSocketDebuggerUrl;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }

    throw new Error(`Browser DevTools endpoint did not respond on port ${port} within ${timeoutMs}ms`);
  }

  async close(): Promise<void> {
    if (this.proc) {
      const pid = this.proc.pid;
      try {
        this.proc.kill();
      } catch {}

      if (pid) {
        GlobalProcessRegistry.killProcessTree(pid);
        GlobalProcessRegistry.unregister(pid);
      }
      this.proc = null;
    }

    if (this.tempUserDataDir && existsSync(this.tempUserDataDir)) {
      try {
        rmSync(this.tempUserDataDir, { recursive: true, force: true });
      } catch {}
      this.tempUserDataDir = null;
    }
  }
}
