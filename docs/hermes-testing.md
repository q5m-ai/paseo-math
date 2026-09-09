# Hermes client regression

Node's registration smoke does not cover Hermes runtime `eval`. The unlowered
client at `96049b3` reproduces Android's `getDecoder` / undefined `prototype`
exception under the Hermes revision shipped with React Native 0.81.5.
Lowering classes with Babel before Paseo's final compilation makes the same
registration and Markdown projection harness pass. The earlier decoder-argument
and MarkdownIt callable-wrapper patches did not fix this and have been removed.

After `npm ci`, SDK preparation (`npm run sdk`), and `npm run build`:

```sh
HERMES_BIN=/absolute/path/to/hermes npm run smoke:hermes
```

Use the runtime executable, not React Native's compiler-only `hermesc` binary.
The matching Hermes source revision is recorded in
`node_modules/react-native/sdks/.hermesversion` (currently
`e0fc67142ec0763c6b6153ca2bf96df815539782`). Build that revision with CMake/Ninja,
a C++ toolchain, Python, and ICU development libraries, targeting `hermes`.

The test compiles the plugin with the released Paseo compiler, evaluates its
client bundle in Hermes, and checks registration, incremental math projection,
plain-text/code fallbacks, and cleanup. It runs with `-Xes6-class` (matching the
Android failure) and without it, to ensure native class evaluation is unnecessary.
React Native/React/schema APIs are stubs: this does **not** verify native UI,
clipboard behavior, or formula image layout. Those still require device testing.

Ordinary `npm run smoke` also rejects any remaining class syntax in the final
client bundle, even when Hermes is unavailable in CI.
