import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Some wallet dependencies reference Node's `global`.
  define: { global: "globalThis" },
});
