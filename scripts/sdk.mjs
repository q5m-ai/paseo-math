import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const revision = "b8e24677e12b226c7c38c1c3a40649daa9f1152f";
const source = fileURLToPath(new URL("../.paseo-sdk", import.meta.url));
const update = process.argv.includes("--update");
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited ${result.status}`);
}
let present = true;
try {
  await access(source);
} catch {
  present = false;
}
if (!present) {
  run("git", [
    "clone",
    "--filter=blob:none",
    "--no-checkout",
    "https://github.com/getpaseo/paseo.git",
    source,
  ]);
  run("git", ["checkout", "--detach", revision], source);
}
function gitOutput(args) {
  const result = spawnSync("git", args, { cwd: source, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
if (gitOutput(["status", "--porcelain", "--untracked-files=all"])) {
  throw new Error(
    "Refusing to build or upgrade a dirty .paseo-sdk; preserve its changes first",
  );
}
if (gitOutput(["rev-parse", "HEAD"]) !== revision) {
  if (!update) {
    throw new Error(
      "Existing .paseo-sdk is not the pinned SDK; run npm run sdk -- --update to explicitly upgrade a clean checkout",
    );
  }
  run("git", ["fetch", "origin", revision], source);
  run("git", ["checkout", "--detach", revision], source);
  if (gitOutput(["rev-parse", "HEAD"]) !== revision)
    throw new Error("SDK checkout did not reach the pinned revision");
}
run(
  "npm",
  [
    "ci",
    "--ignore-scripts",
    "--workspace=@getpaseo/plugin",
    "--workspace=@getpaseo/client",
    "--workspace=@getpaseo/protocol",
    "--workspace=@getpaseo/relay",
    "--include-workspace-root",
  ],
  source,
);
run("npm", ["run", "build:relay:clean"], source);
run("npm", ["run", "build:client:clean"], source);
run("npm", ["run", "build:plugin:clean"], source);
console.log(`Built genuine Paseo 0.8.0 SDK artifacts at ${revision}.`);
