import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "preact/hooks";

/**
 * Runs `handler` whenever the Rust side emits `event` (native menu items, mostly). In a plain browser
 * (`npm run dev`) there is no native menu, so dispatching `new Event("menu:" + event)` on `window` stands in for it.
 */
export function useTauriEvent(event: string, handler: () => void) {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      if (!import.meta.env.DEV) return;
      const name = `menu:${event}`;
      const run = () => latest.current();
      window.addEventListener(name, run);
      return () => window.removeEventListener(name, run);
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    listen(event, () => latest.current()).then((off) => (disposed ? off() : (unlisten = off)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [event]);
}
