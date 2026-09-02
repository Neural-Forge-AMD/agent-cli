import readline from "node:readline";

let keypressEventsInitialized = false;
export type KeypressListener = (str: string, key: readline.Key) => void;
const listeners = new Set<KeypressListener>();

/**
 * Initializes single persistent global keypress listener on process.stdin.
 * Prevents Bun Windows TTY stream buffer corruption and segmentation faults (0xA0D).
 */
export function initGlobalKeypress(): void {
  if (!keypressEventsInitialized && process.stdin.isTTY) {
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
