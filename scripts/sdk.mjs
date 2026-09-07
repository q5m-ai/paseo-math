import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const revision = "c43df5d4c398571f62584b4ad5a629b5fd3b4599";
const source = fileURLToPath(new URL("../.paseo-sdk", import.meta.url));
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
const head = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: source,
  encoding: "utf8",
});
if (head.status !== 0 || head.stdout.trim() !== revision) {
  throw new Error(
    "Existing .paseo-sdk is not the pinned SDK; move it aside explicitly before preparing",
  );
}
run(
  "npm",
  [
    "ci",
    "--ignore-scripts",
    "--workspace=@getpaseo/plugin",
    "--workspace=@getpaseo/client",
    "--workspace=@getpaseo/protocol",
    "--include-workspace-root",
  ],
  source,
);
run("npm", ["run", "build:client"], source);
run("npm", ["run", "build:plugin"], source);
console.log(
  `Built genuine Paseo SDK declarations at ${revision}. Registry 0.7.2 is not this API.`,
);
