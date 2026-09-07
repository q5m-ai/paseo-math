import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as sdk from "../.paseo-sdk/packages/plugin/dist/index.js";
import * as nativeSdk from "../.paseo-sdk/packages/plugin/dist/react-native.js";
import { createPluginContext } from "../.paseo-sdk/packages/plugin/dist/host.js";
import { compilePlugin } from "../.paseo-sdk/packages/server/src/server/plugins/compiler.ts";
import { readPluginManifest } from "../.paseo-sdk/packages/server/src/server/plugins/manifest.ts";
import { transformTimelineItem } from "../.paseo-sdk/packages/app/src/plugins/timeline/model.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
export async function loadCompiledPlugin() {
  await readPluginManifest(root);
  const bundles = await compilePlugin(path.join(root, "index.ts"));
  assert.ok(bundles.clientBundle && bundles.serverBundle);
  const handlers = new Map();
  const factory = (0, eval)(bundles.serverBundle);
  const entry = factory((name) =>
    name === "@getpaseo/plugin" || name === "@getpaseo/plugin/server"
      ? sdk
      : require(name),
  );
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
  return { bundles, invoke, cleanup };
}

async function exerciseClientBundle(bundle) {
  const timelineTransformers = [];
  const timelineRenderers = [];
  const context = createPluginContext({
    addTimelineTransformer(contribution) {
      timelineTransformers.push(contribution);
    },
    addTimelineRenderer(contribution) {
      timelineRenderers.push(contribution);
    },
  });
  const factory = (0, eval)(bundle);
  assert.equal(typeof factory, "function");
  const entry = factory((name) => {
    if (name === "@getpaseo/plugin" || name === "@getpaseo/plugin/server")
      return sdk;
    // Registration only: native components use real React Native Web exports.
    // SDK native hooks are host-injected at render time, not exercised here.
    if (name === "@getpaseo/plugin/react-native") return nativeSdk;
    if (name === "react-native") return require("react-native-web");
    if (name === "react" || name === "react/jsx-runtime" || name === "zod")
      return require(name);
    throw new Error(`Module "${name}" is not available in this client smoke`);
  });
  assert.equal(typeof entry.default, "function");
  const cleanup = entry.default(context);
  assert.equal(typeof cleanup, "function");
  try {
    const installed = {
      id: "paseo-math",
      timelineTransformers,
      timelineRenderers,
    };
    const text = String.raw`Completed answer: $\frac{1}{2} + \sqrt{x^2+y^2}$.`;
    const transformed = transformTimelineItem(
      { type: "assistant_message", text },
      [installed],
    );
    assert.deepEqual(transformed, [
      {
        type: "plugin",
        pluginId: "paseo-math",
        kind: "math-message",
        version: 1,
        data: { text },
      },
    ]);
    const [item] = transformed;
    const renderer = timelineRenderers.find(
      (candidate) =>
        candidate.kind === item.kind && candidate.version === item.version,
    );
    assert.ok(renderer, "Transformed math must have a registered renderer");
    assert.deepEqual(renderer.schema.parse(item.data), { text });
    assert.equal(
      transformTimelineItem(
        { type: "assistant_message", text: "An ordinary completed answer." },
        [installed],
      ),
      undefined,
      "Ordinary prose must retain the native timeline renderer",
    );
    assert.equal(
      transformTimelineItem({ type: "user_message", text }, [installed]),
      undefined,
      "Math in user messages must retain the native timeline renderer",
    );
  } finally {
    // Released registration methods return void; the host owns removal.
    // This catches cleanup that incorrectly calls registration return values.
    await cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plugin = await loadCompiledPlugin();
  try {
    await exerciseClientBundle(plugin.bundles.clientBundle);
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
        compiler: "released Paseo 0.7.2 compiler",
        manifest: "accepted by released strict manifest reader",
        client: "compiled contribution through released SDK host collector",
        timeline:
          "released app transform model; completed math and native prose",
        clientCleanup: "completed with void-returning registration APIs",
        rpc: "compiled server contribution",
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
