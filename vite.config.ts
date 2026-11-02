import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// Tauri expects a fixed port and must see compile errors, so don't clear the screen.
export default defineConfig({
  plugins: [preact()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  build: { target: "safari15", outDir: "dist" },
});
