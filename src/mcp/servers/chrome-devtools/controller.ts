/**
 * Chrome DevTools Controller - High-level automation coordinator for Chrome instance.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BrowserLauncher } from "./launcher";
import { CdpSession } from "./cdp-session";
import { DomSnapshotEngine } from "./dom-snapshot";
import type { PageInfo } from "./types";

export class ChromeDevToolsController {
  private launcher = new BrowserLauncher();
  private sessions = new Map<number, { info: PageInfo; cdp: CdpSession }>();
  private activePageId = 1;
  private nextPageId = 1;
  private browserPort = 0;
  private isInitialized = false;

  async init(options?: { headless?: boolean; port?: number }): Promise<void> {
    if (this.isInitialized) return;

    const { port } = await this.launcher.launch({
      headless: options?.headless ?? true,
      port: options?.port,
    });
    this.browserPort = port;
    this.isInitialized = true;

    // Connect to initial about:blank page
    await this.discoverPages();
  }

  private async discoverPages(): Promise<PageInfo[]> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.browserPort}/json/list`);
      if (!res.ok) return [];
      const targets = (await res.json()) as any[];

      const pageTargets = targets.filter((t) => t.type === "page");

      for (const t of pageTargets) {
        // Find existing or assign new
        let existingId: number | null = null;
        for (const [id, entry] of this.sessions) {
          if (entry.info.targetId === t.id) {
            existingId = id;
            entry.info.title = t.title || "";
            entry.info.url = t.url || "";
            break;
          }
        }

        if (existingId === null && t.webSocketDebuggerUrl) {
          const id = this.nextPageId++;
          const cdp = new CdpSession(t.webSocketDebuggerUrl);
          await cdp.connect();

          const info: PageInfo = {
            pageId: id,
            targetId: t.id,
            url: t.url || "about:blank",
            title: t.title || "",
            wsUrl: t.webSocketDebuggerUrl,
          };

          this.sessions.set(id, { info, cdp });
          if (this.sessions.size === 1) {
            this.activePageId = id;
          }
        }
      }

      return Array.from(this.sessions.values()).map((s) => s.info);
    } catch {
      return [];
    }
  }

  getSession(pageId?: number): { info: PageInfo; cdp: CdpSession } {
    const id = pageId || this.activePageId;
    const entry = this.sessions.get(id);
    if (!entry) {
      const available = Array.from(this.sessions.keys()).join(", ");
      throw new Error(`Page with ID ${id} not found. Available page IDs: [${available || "none"}]`);
    }
    return entry;
  }

  // --- 1. Page Lifecycle Tools ---

  async newPage(params: { url: string; background?: boolean; timeout?: number }): Promise<PageInfo> {
    await this.init();

    const res = await fetch(`http://127.0.0.1:${this.browserPort}/json/new?${encodeURIComponent(params.url)}`, {
      method: "PUT",
    });
    const target = (await res.json()) as any;

    const id = this.nextPageId++;
    const cdp = new CdpSession(target.webSocketDebuggerUrl);
    await cdp.connect();

    const info: PageInfo = {
      pageId: id,
      targetId: target.id,
      url: params.url,
      title: target.title || "",
      wsUrl: target.webSocketDebuggerUrl,
    };

    this.sessions.set(id, { info, cdp });
    if (!params.background) {
      this.activePageId = id;
    }

    if (params.url && params.url !== "about:blank") {
      await this.navigatePage({ pageId: id, url: params.url, timeout: params.timeout });
    }

    return info;
  }

  async listPages(): Promise<PageInfo[]> {
    await this.init();
    await this.discoverPages();
    return Array.from(this.sessions.values()).map((s) => s.info);
  }

  async selectPage(params: { pageId: number; bringToFront?: boolean }): Promise<PageInfo> {
    const { info, cdp } = this.getSession(params.pageId);
    this.activePageId = params.pageId;
    if (params.bringToFront) {
      await cdp.send("Page.bringToFront").catch(() => {});
    }
    return info;
  }

  async closePage(params: { pageId: number }): Promise<{ success: boolean }> {
    const { info, cdp } = this.getSession(params.pageId);
    await cdp.close();
    this.sessions.delete(params.pageId);

    try {
      await fetch(`http://127.0.0.1:${this.browserPort}/json/close/${info.targetId}`);
    } catch {}

    if (this.activePageId === params.pageId) {
      const remaining = Array.from(this.sessions.keys());
      this.activePageId = remaining.length > 0 && remaining[0] !== undefined ? remaining[0] : 0;
    }

    return { success: true };
  }

  async navigatePage(params: {
    pageId: number;
    url?: string;
    type?: "url" | "back" | "forward" | "reload";
    timeout?: number;
    ignoreCache?: boolean;
  }): Promise<{ url: string; title: string }> {
    const { info, cdp } = this.getSession(params.pageId);
    const navType = params.type || "url";

    if (navType === "url") {
      if (!params.url) throw new Error("Parameter 'url' is required when type='url'");
      await cdp.send("Page.navigate", { url: params.url });
    } else if (navType === "reload") {
      await cdp.send("Page.reload", { ignoreCache: params.ignoreCache });
    }

    // Wait for load event with timeout
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, params.timeout || 3000);
      const unsub = cdp.on("Page.loadEventFired", () => {
        clearTimeout(timer);
        unsub();
        resolve();
      });
    });

    const evalRes = await cdp.send("Runtime.evaluate", {
      expression: "({ url: window.location.href, title: document.title })",
      returnByValue: true,
    });

    const current = evalRes.result?.value || {};
    info.url = current.url || info.url;
    info.title = current.title || info.title;

    return { url: info.url, title: info.title };
  }

  // --- 2. Inspection Tools ---

  async takeSnapshot(params: { pageId: number; verbose?: boolean; filePath?: string }): Promise<string> {
    const { cdp } = this.getSession(params.pageId);
    const snapshot = await DomSnapshotEngine.captureSnapshot(cdp, params.verbose);

    if (params.filePath) {
      const fullPath = resolve(params.filePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, snapshot.textSnapshot, "utf8");
      return `Snapshot saved to ${params.filePath} (${snapshot.elementsCount} indexed elements)`;
    }

    return snapshot.textSnapshot;
  }

  async takeScreenshot(params: {
    pageId: number;
    format?: "png" | "jpeg" | "webp";
    quality?: number;
    fullPage?: boolean;
    uid?: string;
    filePath?: string;
  }): Promise<{ format: string; base64?: string; filePath?: string }> {
    const { cdp } = this.getSession(params.pageId);
    const format = params.format || "png";

    let clip: any = undefined;
    if (params.uid) {
      const bounds = await DomSnapshotEngine.getElementCenter(cdp, params.uid);
      clip = {
        x: bounds.x - 50,
        y: bounds.y - 50,
        width: 100,
        height: 100,
        scale: 1,
      };
    }

    const res = await cdp.send("Page.captureScreenshot", {
      format,
      quality: format !== "png" ? params.quality || 80 : undefined,
      captureBeyondViewport: params.fullPage ?? false,
      clip,
    });

    const base64Data = res.data;

    if (params.filePath) {
      const fullPath = resolve(params.filePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, Buffer.from(base64Data, "base64"));
      return { format, filePath: params.filePath };
    }

    return { format, base64: base64Data };
  }

  // --- 3. Interaction Tools ---

  async click(params: { pageId: number; uid: string; dblClick?: boolean; includeSnapshot?: boolean }): Promise<any> {
    const { cdp } = this.getSession(params.pageId);
    const center = await DomSnapshotEngine.getElementCenter(cdp, params.uid);

    // Mouse move & press
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: center.x,
      y: center.y,
    });

    const clickCount = params.dblClick ? 2 : 1;
    for (let i = 0; i < clickCount; i++) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: center.x,
        y: center.y,
        button: "left",
        clickCount: i + 1,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: center.x,
        y: center.y,
        button: "left",
        clickCount: i + 1,
      });
    }

    // Give 100ms for UI / state update
    await new Promise((r) => setTimeout(r, 100));

    if (params.includeSnapshot) {
      const snapshot = await DomSnapshotEngine.captureSnapshot(cdp);
      return { success: true, clicked: params.uid, snapshot: snapshot.textSnapshot };
    }

    return { success: true, clicked: params.uid };
  }

  async hover(params: { pageId: number; uid: string }): Promise<{ success: boolean }> {
    const { cdp } = this.getSession(params.pageId);
    const center = await DomSnapshotEngine.getElementCenter(cdp, params.uid);

    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: center.x,
      y: center.y,
    });

    return { success: true };
  }

  async typeText(params: { pageId: number; text: string; submitKey?: string }): Promise<{ success: boolean }> {
    const { cdp } = this.getSession(params.pageId);

    for (const char of params.text) {
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        text: char,
        unmodifiedText: char,
      });
      await cdp.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        text: char,
        unmodifiedText: char,
      });
    }

    if (params.submitKey) {
      await this.pressKey({ pageId: params.pageId, key: params.submitKey });
    }

    return { success: true };
  }

  async fill(params: { pageId: number; uid: string; value: string }): Promise<{ success: boolean }> {
    const { cdp } = this.getSession(params.pageId);

    const script = `
      (() => {
        const el = document.querySelector(\`[data-groupy-mcp-uid="\${${JSON.stringify(params.uid)}}"]\`);
        if (!el) return false;
        el.focus();
        if (el.tagName.toLowerCase() === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
          el.checked = ${params.value === "true"};
        } else {
          el.value = ${JSON.stringify(params.value)};
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `;

    const res = await cdp.send("Runtime.evaluate", { expression: script, returnByValue: true });
    if (!res.result?.value) {
      throw new Error(`Failed to fill element with UID '${params.uid}'`);
    }

    return { success: true };
  }

  async fillForm(params: {
    pageId: number;
    elements: Array<{ uid: string; value: string }>;
    includeSnapshot?: boolean;
  }): Promise<any> {
    for (const el of params.elements) {
      await this.fill({ pageId: params.pageId, uid: el.uid, value: el.value });
    }

    if (params.includeSnapshot) {
      const { cdp } = this.getSession(params.pageId);
      const snapshot = await DomSnapshotEngine.captureSnapshot(cdp);
      return { success: true, elementsFilled: params.elements.length, snapshot: snapshot.textSnapshot };
    }

    return { success: true, elementsFilled: params.elements.length };
  }

  async pressKey(params: { pageId: number; key: string }): Promise<{ success: boolean }> {
    const { cdp } = this.getSession(params.pageId);
    const key = params.key;

    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: key,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: key,
    });

    return { success: true };
  }

  async waitFor(params: { pageId: number; text: string[]; timeout?: number }): Promise<{ matchedText: string }> {
    const { cdp } = this.getSession(params.pageId);
    const timeoutMs = params.timeout || 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const snapshot = await DomSnapshotEngine.captureSnapshot(cdp);
      for (const target of params.text) {
        if (snapshot.textSnapshot.toLowerCase().includes(target.toLowerCase())) {
          return { matchedText: target };
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    throw new Error(`None of the target texts [${params.text.join(", ")}] appeared within ${timeoutMs}ms`);
  }

  async evaluateScript(params: {
    pageId: number;
    function: string;
    args?: string[];
    filePath?: string;
  }): Promise<any> {
    const { cdp } = this.getSession(params.pageId);

    const fnExpression = `(${params.function})()`;
    const res = await cdp.send("Runtime.evaluate", {
      expression: fnExpression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (res.exceptionDetails) {
      throw new Error(`Script evaluation failed: ${res.exceptionDetails.text || res.exceptionDetails.exception?.description}`);
    }

    const value = res.result?.value;

    if (params.filePath) {
      const fullPath = resolve(params.filePath);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, JSON.stringify(value, null, 2), "utf8");
      return `Script output saved to ${params.filePath}`;
    }

    return value;
  }

  async resizePage(params: { pageId: number; width: number; height: number }): Promise<{ success: boolean }> {
    const { cdp } = this.getSession(params.pageId);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: params.width,
      height: params.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    return { success: true };
  }

  async listConsoleMessages(params: { pageId: number; types?: string[] }): Promise<any[]> {
    const { cdp } = this.getSession(params.pageId);
    if (!params.types || params.types.length === 0) {
      return cdp.consoleMessages;
    }
    const typeSet = new Set(params.types);
    return cdp.consoleMessages.filter((m) => typeSet.has(m.type));
  }

  async listNetworkRequests(params: { pageId: number; resourceTypes?: string[] }): Promise<any[]> {
    const { cdp } = this.getSession(params.pageId);
    const all = Array.from(cdp.networkRequests.values());
    if (!params.resourceTypes || params.resourceTypes.length === 0) {
      return all;
    }
    const typeSet = new Set(params.resourceTypes);
    return all.filter((r) => typeSet.has(r.resourceType));
  }

  async close(): Promise<void> {
    for (const entry of this.sessions.values()) {
      try {
        await entry.cdp.close();
      } catch {}
    }
    this.sessions.clear();
    await this.launcher.close();
    this.isInitialized = false;
  }
}
