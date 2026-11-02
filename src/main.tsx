import { render } from "preact";
import { App } from "./App";
import "./styles.css";

if ("__TAURI_INTERNALS__" in window) document.documentElement.classList.add("tauri");

render(<App />, document.getElementById("app")!);
