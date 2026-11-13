import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The proof records live in the repo root (shared with npm run verify).
  server: { fs: { allow: [".."] } },
});
