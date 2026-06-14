import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HEADER } from "./src/userscript-header.js";

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
writeFileSync("dist/popup-zapper.user.js", HEADER + "\n" + body);
console.log("Built dist/popup-zapper.user.js");