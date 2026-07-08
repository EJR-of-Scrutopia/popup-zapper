import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildHeader } from "./src/userscript-header.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/popup-zapper.bundle.js",
  legalComments: "none",
});

const body = readFileSync("dist/popup-zapper.bundle.js", "utf8");
writeFileSync("dist/popup-zapper.user.js", buildHeader(pkg.version) + "\n" + body);
console.log(`Built dist/popup-zapper.user.js (v${pkg.version})`);