// Bundles the extension into dist/ (load it via chrome://extensions → Load unpacked → extension/dist).
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
cpSync("static", "dist", { recursive: true });

const options = {
  entryPoints: { background: "src/background.ts", content: "src/content.ts", panel: "src/panel/main.tsx" },
  outdir: "dist",
  bundle: true,
  format: "iife", // content scripts injected with chrome.scripting cannot be ES modules
  target: "chrome120",
  jsx: "automatic",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  logLevel: "info",
};

if (watch) await (await context(options)).watch();
else await build(options);
