import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"));

const externals = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.optionalDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
  "fs","path","url","zlib","http","https","stream","buffer","crypto",
  "events","os","util","tty","net","tls","dns","cluster","module"
];

const outdir = "dist";
if (fs.existsSync(outdir)) fs.rmSync(outdir, { recursive: true, force: true });

console.log("Externalizing dependencies:", externals.join(", ") || "(none)");

await build({
  entryPoints: ["server/index.ts"],
  platform: "node",
  target: "node20",
  format: "esm",
  bundle: true,
  outdir,
  sourcemap: false,
  legalComments: "none",
  external: externals,
  banner: {
    js: `import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);`
  }
});

console.log("✓ Build complete — deps externalized. Output: dist/index.js");
