import { render } from "preact";
import { App } from "./App";
import "./styles.css";
import { applySavedTheme } from "./theme";

applySavedTheme();

if ("__TAURI_INTERNALS__" in window) {
  document.documentElement.classList.add("tauri");
  // The webview's own right-click menu (Reload, Inspect…) has no place in the app. Text
  // fields keep theirs for Copy and Paste, and entries show their own menu.
  window.addEventListener("contextmenu", (e) => {
    if (!(e.target as Element).closest?.("input, textarea")) e.preventDefault();
  });
}

render(<App />, document.getElementById("app")!);
