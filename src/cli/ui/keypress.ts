import readline from "node:readline";

let keypressEventsInitialized = false;
export type KeypressListener = (str: string, key: readline.Key) => void;
const listeners = new Set<KeypressListener>();

let rawModeState: boolean | null = null;

/**
 * Safely sets raw mode on stdin only when the desired state differs from current state.
 * Debounces redundant Windows console handle mode switches that trigger Bun segfaults.
 */
export function ensureRawMode(active: boolean): void {
  if (!process.stdin.isTTY) return;
  if (rawModeState === active) return;
  try {
    process.stdin.setRawMode(active);
    rawModeState = active;
    if (active) {
      process.stdin.resume();
    }
  } catch {}
}

/**
 * Initializes single persistent global keypress listener on process.stdin.
 * Prevents Bun Windows TTY stream buffer corruption and segmentation faults (0xA0D).
 */
export function initGlobalKeypress(): void {
  if (!keypressEventsInitialized && process.stdin.isTTY) {
    try {
      process.stdin.on("error", () => {});
    } catch {}

    readline.emitKeypressEvents(process.stdin);
    keypressEventsInitialized = true;

    process.stdin.on("keypress", (str: string, key: readline.Key) => {
      for (const listener of Array.from(listeners)) {
        try {
          listener(str, key);
        } catch {}
      }
    });

    // Safety restore on exit
    process.on("exit", () => {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
        } catch {}
      }
    });
  }
}

/**
 * Subscribes to global keypress events safely without touching native C++ stream bindings.
 * Returns an unsubscribe callback.
 */
export function addGlobalKeypressListener(listener: KeypressListener): () => void {
  initGlobalKeypress();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

