import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API (server/) runs on 127.0.0.1:4000; proxying /api keeps the browser same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": process.env.FORMPILOT_API ?? "http://127.0.0.1:4000" },
  },
});
