import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const markdownRoot = path.dirname(
  require.resolve("react-native-markdown-display/package.json"),
);
const fitImagePath = require.resolve("react-native-fit-image");
await mkdir(path.join(root, "client/generated"), { recursive: true });
await mkdir(path.join(root, "server/generated"), { recursive: true });

// Adapt Paseo's Apache-2.0 stable-key patch at c43df5d4c398571f62584b4ad5a629b5fd3b4599.
// Apply in memory to the pinned dependency, never mutate the user's node_modules.
function replaceExact(source, from, to) {
  if (!source.includes(from))
    throw new Error("Pinned Markdown source changed; review stable-key patch");
  return source.replace(from, to);
}
await build({
  stdin: {
    contents:
      'export { default } from "react-native-markdown-display"; export { default as MarkdownIt } from "markdown-it"; export { markdownMath, hasMath } from "./shared/markdown-math.ts";',
    resolveDir: root,
    loader: "ts",
  },
  outfile: path.join(root, "client/generated/markdown.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  mainFields: ["module", "main"],
  alias: {
    "markdown-it": path.dirname(require.resolve("markdown-it/package.json")),
  },
  target: "es2020",
  define: { "process.env.NODE_ENV": '"production"' },
  jsx: "automatic",
  loader: { ".js": "jsx" },
  external: ["react", "react/jsx-runtime", "react-native"],
  legalComments: "eof",
  plugins: [
    {
      name: "stable-markdown-keys",
      setup(context) {
        context.onLoad(
          { filter: /FitImage\.js$/ },
          async ({ path: filename }) => {
            if (filename !== fitImagePath) return;
            let source = await readFile(filename, "utf8");
            // This legacy CommonJS module receives Metro's React namespace on
            // Android, where the actual React object is under `default`.
            source = replaceExact(
              source,
              'var React = require("react");\nvar react_1 = require("react");',
              'var ReactModule = require("react");\nvar React = ReactModule.default || ReactModule;\nvar react_1 = React;',
            );
            return { contents: source, loader: "js" };
          },
        );
        context.onLoad(
          { filter: /(?:AstRenderer|tokensToAST)\.js$/ },
          async ({ path: filename }) => {
            if (!filename.startsWith(markdownRoot + path.sep)) return;
            let source = await readFile(filename, "utf8");
            if (filename.endsWith("AstRenderer.js")) {
              source = replaceExact(
                source,
                "import getUniqueID from './util/getUniqueID';",
                "",
              );
              source = replaceExact(
                source,
                "key: getUniqueID(),",
                "key: 'rnmr_root',",
              );
            } else {
              source = replaceExact(
                source,
                "import getUniqueID from './getUniqueID';",
                "",
              );
              source = replaceExact(
                source,
                "function createNode(token, tokenIndex)",
                "function createNode(token, tokenIndex, parentKey)",
              );
              source = replaceExact(
                source,
                "const content = token.content;",
                "const content = token.content;\n  const keyPath = parentKey ? `${parentKey}.${tokenIndex}` : `${tokenIndex}`;",
              );
              source = replaceExact(
                source,
                "key: getUniqueID() + '_' + type,",
                "key: `rnmr_${keyPath}_${type}`,",
              );
              source = replaceExact(
                source,
                "children: tokensToAST(token.children)",
                "children: tokensToAST(token.children, keyPath)",
              );
              source = replaceExact(
                source,
                "function tokensToAST(tokens)",
                "function tokensToAST(tokens, parentKey = '')",
              );
              source = replaceExact(
                source,
                "createNode(token, i)",
                "createNode(token, i, parentKey)",
              );
            }
            return { contents: source, loader: "jsx" };
          },
        );
      },
    },
  ],
});
// The pinned renderer's declarations still import Markdown 10's private Token
// path. Keep its real types, adapted to the public Markdown 15 export, alongside
// the portable bundle. Do not modify installed dependency files.
await writeFile(
  path.join(root, "client/generated/markdown-types.d.ts"),
  replaceExact(
    await readFile(path.join(markdownRoot, "src/index.d.ts"), "utf8"),
    "import Token from 'markdown-it/lib/token';",
    "import type { Token } from 'markdown-it';",
  ),
);
await writeFile(
  path.join(root, "client/generated/markdown.d.ts"),
  'export { default } from "./markdown-types.js";\nexport type { ASTNode, RenderFunction, RenderRules } from "./markdown-types.js";\nexport { default as MarkdownIt } from "markdown-it";\nexport { markdownMath, hasMath } from "../../shared/markdown-math.js";\n',
);
const wasm = await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm"));
await writeFile(
  path.join(root, "server/generated/wasm.ts"),
  `// Generated by scripts/build.mjs; contains only the pinned resvg WASM binary.\nexport const wasmBase64 = ${JSON.stringify(wasm.toString("base64"))};\n`,
);
console.log("Prepared portable Markdown and rasterizer assets.");
