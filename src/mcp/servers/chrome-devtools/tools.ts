/**
 * Chrome DevTools Tool Definitions - 100% Aligned with Google Antigravity Schemas.
 */

import type { McpToolSchema } from "../../types";
import { ChromeDevToolsController } from "./controller";

export function getChromeDevToolsToolSchemas(): McpToolSchema[] {
  return [
    {
      name: "new_page",
      description: "Open a new tab and load a URL. Use project URL if not specified otherwise.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to load in a new page." },
          background: { type: "boolean", description: "Whether to open the page in the background." },
          timeout: { type: "integer", description: "Maximum wait time in milliseconds." },
        },
        required: ["url"],
      },
    },
    {
      name: "list_pages",
      description: "Get a list of pages open in the browser.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "select_page",
      description: "Select a page as a context for future tool calls.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "The ID of the page to select. Call list_pages to get available pages." },
          bringToFront: { type: "boolean", description: "Whether to focus the page and bring it to the top." },
        },
        required: ["pageId"],
      },
    },
    {
      name: "close_page",
      description: "Close the target page.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
        },
        required: ["pageId"],
      },
    },
    {
      name: "navigate_page",
      description: "Go to a URL, or back, forward, or reload. Use project URL if not specified otherwise.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          url: { type: "string", description: "Target URL (only type=url)" },
          type: { type: "string", enum: ["url", "back", "forward", "reload"], description: "Navigate type." },
          timeout: { type: "integer", description: "Maximum wait time in milliseconds." },
          ignoreCache: { type: "boolean", description: "Whether to ignore cache on reload." },
        },
        required: ["pageId"],
      },
    },
    {
      name: "take_snapshot",
      description: "Take a text snapshot of the target page based on the a11y tree with unique identifier (uid). Always use the latest snapshot. Prefer taking a snapshot over taking a screenshot.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          verbose: { type: "boolean", description: "Whether to include all possible information available in the full a11y tree." },
          filePath: { type: "string", description: "Path to save the snapshot to instead of attaching it to response." },
        },
        required: ["pageId"],
      },
    },
    {
      name: "take_screenshot",
      description: "Take a screenshot of the page or element.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          format: { type: "string", enum: ["png", "jpeg", "webp"], description: "Format of screenshot." },
          quality: { type: "number", description: "Compression quality for JPEG/WebP (0-100)." },
          fullPage: { type: "boolean", description: "If true, takes full page screenshot." },
          uid: { type: "string", description: "UID of element from snapshot to screenshot." },
          filePath: { type: "string", description: "File path to save screenshot." },
        },
        required: ["pageId"],
      },
    },
    {
      name: "click",
      description: "Clicks on the provided element.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          uid: { type: "string", description: "The uid of an element on the page from page content snapshot." },
          dblClick: { type: "boolean", description: "Set to true for double clicks." },
          includeSnapshot: { type: "boolean", description: "Whether to include a snapshot in the response." },
        },
        required: ["pageId", "uid"],
      },
    },
    {
      name: "hover",
      description: "Hover over the provided element.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          uid: { type: "string", description: "The uid of an element on the page." },
        },
        required: ["pageId", "uid"],
      },
    },
    {
      name: "type_text",
      description: "Type text using keyboard into a previously focused input.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          text: { type: "string", description: "The text to type." },
          submitKey: { type: "string", description: "Optional key to press after typing (e.g. Enter, Tab)." },
        },
        required: ["pageId", "text"],
      },
    },
    {
      name: "fill",
      description: "Fill out a single form field with text or boolean value.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          uid: { type: "string", description: "The uid of the element to fill out." },
          value: { type: "string", description: "Value to set." },
        },
        required: ["pageId", "uid", "value"],
      },
    },
    {
      name: "fill_form",
      description: "Fill out multiple form elements (inputs, selects, checkboxes, radios) at once. ALWAYS prefer this tool over multiple individual 'fill' or 'click' calls when interacting with forms.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          elements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                uid: { type: "string", description: "UID of element" },
                value: { type: "string", description: "Value to fill" },
              },
              required: ["uid", "value"],
            },
          },
          includeSnapshot: { type: "boolean", description: "Whether to include snapshot in response." },
        },
        required: ["pageId", "elements"],
      },
    },
    {
      name: "press_key",
      description: "Press a keyboard key on the active page.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          key: { type: "string", description: "Name of the key (e.g. Enter, Escape, ArrowDown)." },
        },
        required: ["pageId", "key"],
      },
    },
    {
      name: "wait_for",
      description: "Wait for the specified text to appear on the selected page.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          text: { type: "array", items: { type: "string" }, description: "Non-empty list of texts to wait for." },
          timeout: { type: "integer", description: "Maximum wait time in milliseconds." },
        },
        required: ["pageId", "text"],
      },
    },
    {
      name: "evaluate_script",
      description: "Evaluate a JavaScript function inside the target page.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          function: { type: "string", description: "A JavaScript function declaration to execute." },
          args: { type: "array", items: { type: "string" }, description: "Optional list of arguments." },
          filePath: { type: "string", description: "Optional file path to save output." },
        },
        required: ["pageId", "function"],
      },
    },
    {
      name: "resize_page",
      description: "Resize the target page viewport.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          width: { type: "integer", description: "Viewport width." },
          height: { type: "integer", description: "Viewport height." },
        },
        required: ["pageId", "width", "height"],
      },
    },
    {
      name: "list_console_messages",
      description: "List all console messages for the target page since the last navigation.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          types: { type: "array", items: { type: "string" }, description: "Filter message types (log, error, warn, info)." },
        },
        required: ["pageId"],
      },
    },
    {
      name: "list_network_requests",
      description: "Lists the most recent requests for the target page since the last navigation.",
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "number", description: "Targets a specific page by ID." },
          resourceTypes: { type: "array", items: { type: "string" }, description: "Filter resource types (fetch, xhr, document)." },
        },
        required: ["pageId"],
      },
    },
  ];
}

export async function executeChromeDevToolsTool(
  controller: ChromeDevToolsController,
  name: string,
  args: Record<string, any>
): Promise<any> {
  const pageId = Number(args.pageId || 1);

  switch (name) {
    case "new_page":
      return controller.newPage({ url: String(args.url), background: Boolean(args.background), timeout: args.timeout });
    case "list_pages":
      return controller.listPages();
    case "select_page":
      return controller.selectPage({ pageId, bringToFront: Boolean(args.bringToFront) });
    case "close_page":
      return controller.closePage({ pageId });
    case "navigate_page":
      return controller.navigatePage({
        pageId,
        url: args.url,
        type: args.type,
        timeout: args.timeout,
        ignoreCache: args.ignoreCache,
      });
    case "take_snapshot":
      return controller.takeSnapshot({ pageId, verbose: Boolean(args.verbose), filePath: args.filePath });
    case "take_screenshot":
      return controller.takeScreenshot({
        pageId,
        format: args.format,
        quality: args.quality,
        fullPage: args.fullPage,
        uid: args.uid,
        filePath: args.filePath,
      });
    case "click":
      return controller.click({
        pageId,
        uid: String(args.uid),
        dblClick: Boolean(args.dblClick),
        includeSnapshot: Boolean(args.includeSnapshot),
      });
    case "hover":
      return controller.hover({ pageId, uid: String(args.uid) });
    case "type_text":
      return controller.typeText({ pageId, text: String(args.text), submitKey: args.submitKey });
    case "fill":
      return controller.fill({ pageId, uid: String(args.uid), value: String(args.value) });
    case "fill_form":
      return controller.fillForm({
        pageId,
        elements: args.elements || [],
        includeSnapshot: Boolean(args.includeSnapshot),
      });
    case "press_key":
      return controller.pressKey({ pageId, key: String(args.key) });
    case "wait_for":
      return controller.waitFor({
        pageId,
        text: Array.isArray(args.text) ? args.text : [String(args.text)],
        timeout: args.timeout,
      });
    case "evaluate_script":
      return controller.evaluateScript({
        pageId,
        function: String(args.function),
        args: args.args,
        filePath: args.filePath,
      });
    case "resize_page":
      return controller.resizePage({ pageId, width: Number(args.width), height: Number(args.height) });
    case "list_console_messages":
      return controller.listConsoleMessages({ pageId, types: args.types });
    case "list_network_requests":
      return controller.listNetworkRequests({ pageId, resourceTypes: args.resourceTypes });
    default:
      throw new Error(`Unknown Chrome DevTools tool: ${name}`);
  }
}
