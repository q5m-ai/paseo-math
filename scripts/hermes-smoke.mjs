import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadCompiledPlugin } from "./smoke.mjs";

// Use the RN 0.81 Hermes revision from react-native/sdks/.hermesversion.
// This harness checks evaluated bundle initialization and real Markdown parsing,
// not native UI rendering. Native/React/schema APIs below are registration stubs.
const hermes = process.env.HERMES_BIN;
if (!hermes) throw new Error("Set HERMES_BIN to the RN 0.81 Hermes executable");
const plugin = await loadCompiledPlugin();
const directory = await mkdtemp(path.join(os.tmpdir(), "paseo-math-hermes-"));
try {
  const source = `
function check(value, message) { if (!value) throw new Error(message); }
function stub() { return proxy; }
var proxy = new Proxy(stub, {get: function(target, key) {
  if (key === 'memo' || key === 'create') return function(x) { return x; };
  if (key === 'OS') return 'android';
  if (key === 'select') return function(x) { return x.android || x.default; };
  return proxy;
}});
// React Native supplies atob, but the standalone Hermes CLI does not.
var atob = function(input) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var bits = 0, value = 0, output = '';
  for (var i = 0; i < input.length; i++) {
    var c = alphabet.indexOf(input[i]);
    if (c < 0) continue;
    value = (value << 6) | c; bits += 6;
    if (bits >= 8) {
      bits -= 8; output += String.fromCharCode((value >> bits) & 255);
    }
  }
  return output;
};
var allowed = ['react', 'react/jsx-runtime', 'react-native', 'zod',
  '@getpaseo/plugin/client', '@getpaseo/plugin/client/react-native', '@getpaseo/plugin'];
var entry = (0, eval)(${JSON.stringify(plugin.bundles.clientBundle)})(function(name) {
  check(allowed.indexOf(name) !== -1, 'Unexpected module: ' + name);
  return proxy;
});
var transformers = [], renderers = [];
var cleanup = entry.default({
  addTimelineRenderer: function(x) { renderers.push(x); },
  addTimelineTransformer: function(x) { transformers.push(x); }
});
check(typeof cleanup === 'function', 'Missing cleanup');
check(renderers.length === 1 && transformers.length === 1, 'Missing registrations');
var text = '&amp; **bold** $x^2$';
for (var n = 1; n <= text.length; n++) {
  transformers[0].transform({item: {text: text.slice(0, n)}});
}
var result = transformers[0].transform({item: {text: text}});
check(result && result.items[0].data.text === text, 'Math projection failed');
check(!transformers[0].transform({item: {text: 'plain &amp; text'}}), 'Plain text transformed');
check(!transformers[0].transform({item: {text: '\\x60$x$\\x60'}}), 'Code transformed');
cleanup();
print('Hermes evaluated client: setup, incremental math projection, fallbacks, cleanup passed');
`;
  const filename = path.join(directory, "client.js");
  await writeFile(filename, source);
  // Run both with the Android runtime class transform enabled and disabled.
  // The fixed client must no longer depend on that experimental transform.
  for (const flags of [["-Xes6-class"], []]) {
    const result = spawnSync(hermes, [...flags, filename], {
      encoding: "utf8",
      timeout: 60_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /cleanup passed/);
    console.log(result.stdout.trim());
  }
} finally {
  await plugin.cleanup();
  await rm(directory, { recursive: true, force: true });
}
