import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as sdk from "../.paseo-sdk/packages/plugin/dist/index.js";
import { compilePlugin } from "../.paseo-sdk/packages/server/src/server/plugins/compiler.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
export async function loadCompiledPlugin() {
  const bundles = await compilePlugin({
    client: path.join(root, "index.client.tsx"),
    server: path.join(root, "index.server.ts"),
  });
  assert.ok(bundles.clientBundle && bundles.serverBundle);
  const handlers = new Map();
  const factory = (0, eval)(bundles.serverBundle);
  const entry = factory((name) =>
    name === "@getpaseo/plugin" ? sdk : require(name),
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plugin = await loadCompiledPlugin();
  try {
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
        compiler: "pinned Paseo compiler",
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
