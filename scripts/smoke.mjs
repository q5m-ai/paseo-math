import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { transformSync } from "@babel/core";
import MarkdownIt from "markdown-it";
import * as sdk from "../.paseo-sdk/packages/plugin/dist/index.js";
import * as clientSdk from "../.paseo-sdk/packages/plugin/dist/client/index.js";
import * as serverSdk from "../.paseo-sdk/packages/plugin/dist/server/index.js";
import * as nativeSdk from "../.paseo-sdk/packages/plugin/dist/client/react-native.js";
import { compilePlugin } from "../.paseo-sdk/packages/server/src/server/plugins/compiler.ts";
import { readPluginManifest } from "../.paseo-sdk/packages/server/src/server/plugins/manifest.ts";
import { transformTimelineItem } from "../.paseo-sdk/packages/app/src/plugins/timeline/model.ts";
import { projectPluginTimelineItems } from "../.paseo-sdk/packages/app/src/plugins/timeline/projection.ts";
import { markdownMath } from "../shared/markdown-math.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(
  new URL("../.paseo-sdk/package.json", import.meta.url),
);
export async function loadCompiledPlugin() {
  const manifest = await readPluginManifest(root);
  const bundles = await compilePlugin({
    client: path.join(root, "index.client.tsx"),
    server: path.join(root, "index.server.ts"),
  });
  assert.ok(bundles.clientBundle && bundles.serverBundle);
  const handlers = new Map();
  const factory = (0, eval)(bundles.serverBundle);
  const entry = factory((name) => {
    if (name === "@getpaseo/plugin") return sdk;
    if (name === "@getpaseo/plugin/server") return serverSdk;
    return require(name);
  });
  const cleanup = entry.default({
    handle(contract, handler) {
      handlers.set(contract.name, { contract, handler });
    },
  });
  assert.equal(typeof cleanup, "function");
  async function invoke(method, input) {
    const registered = handlers.get(method);
    assert.ok(registered, `No registered RPC ${method}`);
    const parsed = await registered.contract.input.parseAsync(input);
    return registered.contract.output.parseAsync(
      await registered.handler(parsed),
    );
  }
  return { bundles, invoke, cleanup, id: manifest.id };
}

async function loadStreamRuntime() {
  // Bundle the unmodified released helper solely to resolve the app's @/ alias.
  // This is the same head/tail assembly path used by the running app, including
  // Markdown block promotion and turn-completion flushing, not a mock reducer.
  const app = path.join(root, ".paseo-sdk/packages/app/src");
  const result = await build({
    entryPoints: [path.join(app, "types/stream.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    alias: { "@": app },
    tsconfigRaw: {},
    write: false,
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(
    sdkRequire,
    module,
    module.exports,
  );
  return module.exports;
}

const displayExpression = String.raw`\boxed{\begin{aligned}
Q^{r_*}
=
\frac{1}{2} e_{r_*}
\end{aligned}}`;
const displaySource = `\\[\n${displayExpression}\n\\]`;
const markdown = new MarkdownIt({ html: false }).use(markdownMath);
function expressions(text) {
  const found = [];
  function visit(token) {
    if (token.type === "math_inline" || token.type === "math_block")
      found.push(token.content.trim());
    token.children?.forEach(visit);
  }
  markdown.parse(text, {}).forEach(visit);
  return found;
}

async function exerciseClientBundle(bundle, id) {
  const timelineTransformers = [];
  const timelineRenderers = [];
  // Registration harness only. Actual React Native hooks/clipboard are injected
  // by Paseo when rendering; the real UI smoke must exercise those separately.
  function register(items, contribution) {
    items.push(contribution);
    return () => {
      const index = items.indexOf(contribution);
      if (index !== -1) items.splice(index, 1);
    };
  }
  const factory = (0, eval)(bundle);
  assert.equal(typeof factory, "function");
  const entry = factory((name) => {
    if (name === "@getpaseo/plugin") return sdk;
    if (name === "@getpaseo/plugin/client") return clientSdk;
    if (name === "@getpaseo/plugin/client/react-native") return nativeSdk;
    if (name === "react-native") return require("react-native-web");
    if (name === "react") {
      const react = require("react");
      // Metro exposes this namespace shape to evaluated Android plugin bundles.
      // Legacy CommonJS dependencies must tolerate Component under default.
      return { ...react, Component: undefined, default: react };
    }
    if (name === "react/jsx-runtime" || name === "zod") return require(name);
    throw new Error(`Module "${name}" is not available in this client smoke`);
  });
  const cleanup = entry.default({
    addTimelineTransformer: (value) => register(timelineTransformers, value),
    addTimelineRenderer: (value) => register(timelineRenderers, value),
  });
  assert.equal(typeof cleanup, "function");
  try {
    const installed = { id, timelineTransformers, timelineRenderers };
    const transform = (input) =>
      transformTimelineItem({ ...input, plugins: [installed] });
    const { applyStreamEvent } = await loadStreamRuntime();
    const timestamp = new Date("2026-09-01T12:00:00.000Z");
    const project = (state) => [
      ...projectPluginTimelineItems(state.tail, transform),
      ...projectPluginTimelineItems(state.head, transform),
    ];
    const sourceOf = (row) =>
      row.kind === "plugin" ? row.data.text : row.text;
    function assertMathRow(row, text) {
      assert.equal(row.kind, "plugin", `Math projection missing for ${JSON.stringify(text)}`);
      assert.equal(row.pluginId, id);
      assert.equal(row.itemKind, "math-message");
      const renderer = timelineRenderers.find(
        (candidate) =>
          candidate.kind === row.itemKind && candidate.version === row.version,
      );
      assert.ok(renderer, "Projected math must have a registered renderer");
      assert.deepEqual(renderer.schema.parse(row.data), { text });
    }
    function stream(text, check) {
      let state = { tail: [], head: [] };
      let assembled = "";
      // One character per event splits every delimiter, TeX command, subscript
      // and closing boundary. Never feed projected plugin rows back into state.
      for (const chunk of text) {
        assembled += chunk;
        state = applyStreamEvent({
          ...state,
          event: {
            type: "timeline",
            provider: "codex",
            item: {
              type: "assistant_message",
              messageId: "synthetic-message",
              text: chunk,
            },
          },
          timestamp,
        });
        check(project(state), assembled, false);
      }
      state = applyStreamEvent({
        ...state,
        event: { type: "turn_completed", provider: "codex" },
        timestamp,
      });
      assert.deepEqual(state.head, [], "Completion must flush the live head");
      const rows = project(state);
      check(rows, text, true);
      return rows;
    }
    const cases = [
      {
        text: String.raw`Prefix $r_*$ then $Q^{r_*}$ and $e_{r_*}$; suffix after math.`,
        firstClose: String.raw`Prefix $r_*$`.length,
        expected: ["r_*", "Q^{r_*}", "e_{r_*}"],
      },
      {
        text: String.raw`Inline \(x+y\) followed by an intact suffix.`,
        firstClose: String.raw`Inline \(x+y\)`.length,
        expected: ["x+y"],
      },
      {
        text: displaySource + "\nTrailing source remains in the same block.",
        firstClose: displaySource.length,
        expected: [displayExpression],
      },
    ];
    for (const fixture of cases) {
      let pluginRowId;
      const rows = stream(fixture.text, (projected, assembled, complete) => {
        assert.equal(
          projected.length,
          1,
          "Network chunks must never become mixed/truncated rows",
        );
        assert.equal(
          sourceOf(projected[0]),
          assembled,
          "Projection must preserve every assembled character",
        );
        // A later incomplete star subscript can temporarily make Markdown
        // emphasis ambiguous. Source fallback is valid, but row splitting or
        // losing an appended suffix is never valid.
        if (projected[0].kind === "plugin" || assembled.length === fixture.firstClose || complete) {
          assertMathRow(projected[0], assembled);
          pluginRowId ??= projected[0].id;
          assert.equal(
            projected[0].id,
            pluginRowId,
            "Appending text must preserve row identity",
          );
        } else {
          assert.equal(
            projected[0].kind,
            "assistant_message",
            "Incomplete or ambiguous math stays readable",
          );
        }
      });
      assert.deepEqual(expressions(sourceOf(rows[0])), fixture.expected);
    }
    stream("An ordinary completed answer.", (rows, assembled) => {
      assert.deepEqual(
        rows.map((row) => [row.kind, sourceOf(row)]),
        [["assistant_message", assembled]],
      );
    });
    // The host intentionally promotes Markdown blocks, not entire messages.
    // A prose/math/prose message is three correct rows, not the old chunk bug.
    const paragraphs = `Introduction.\n\n${displaySource}\n\nConclusion.`;
    const blocks = stream(paragraphs, (rows, assembled, complete) => {
      if (!complete) return;
      assert.deepEqual(
        rows.map((row) => [row.kind, sourceOf(row)]),
        [
          ["assistant_message", "Introduction."],
          ["plugin", displaySource],
          ["assistant_message", "Conclusion."],
        ],
      );
    });
    assertMathRow(blocks[1], displaySource);
    const user = {
      kind: "user_message",
      id: "user",
      text: cases[0].text,
      timestamp,
    };
    assert.deepEqual(
      projectPluginTimelineItems([user], transform),
      [user],
      "Math in user messages must retain the native timeline renderer",
    );
    return {
      incrementalCases: cases.length,
      chunkSize: 1,
      completedSource: true,
      markdownBlocks: true,
    };
  } finally {
    await cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plugin = await loadCompiledPlugin();
  try {
    // Also enforce this in ordinary CI, where a Hermes executable is optional.
    transformSync(plugin.bundles.clientBundle, {
      babelrc: false,
      configFile: false,
      plugins: [{ visitor: { Class(node) {
        throw node.buildCodeFrameError("Client classes must be lowered before Hermes eval");
      } } }],
    });
    const streaming = await exerciseClientBundle(
      plugin.bundles.clientBundle,
      plugin.id,
    );
    await mkdir(path.join(root, ".smoke"), { recursive: true });
    const formula = await plugin.invoke("math.render", {
      expression: String.raw`\frac{1}{2} + \sqrt{x^2+y^2}`,
      display: true,
      color: "#fafafa",
    });
    assert.equal(formula.ok, true);
    assert.equal(
      Buffer.from(formula.png, "base64").subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
    );
    const boxed = await plugin.invoke("math.render", {
      expression: displayExpression,
      display: true,
      color: "#fafafa",
    });
    assert.equal(
      boxed.ok,
      true,
      "The streamed boxed/aligned expression must rasterize",
    );
    await writeFile(
      path.join(root, ".smoke/formula.png"),
      Buffer.from(formula.png, "base64"),
    );
    await writeFile(
      path.join(root, ".smoke/client.bundle.js"),
      plugin.bundles.clientBundle,
    );
    const invalid = await plugin.invoke("math.render", {
      expression: String.raw`\unknownCommand{a}`,
      display: false,
      color: "#111111",
    });
    assert.equal(invalid.ok, false);
    console.log(
      JSON.stringify({
        compiler: "released Paseo 0.8.0-beta.1 runtime-entry compiler",
        manifest: "accepted by released strict manifest reader",
        client:
          "compiled client entry in registration harness (not UI rendering)",
        timeline:
          "released applyStreamEvent + projectPluginTimelineItems + transformTimelineItem",
        streaming,
        rpc: "compiled server entry",
        image: ".smoke/formula.png",
        width: formula.width,
        height: formula.height,
        invalidSourceFallback: true,
      }),
    );
  } finally {
    await plugin.cleanup();
  }
}
