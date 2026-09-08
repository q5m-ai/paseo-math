import type { PluginServerContext } from "@getpaseo/plugin/server";
import { renderMath } from "./shared/render.js";
import { renderFormula } from "./server/render.js";

export default function setup(server: PluginServerContext) {
  server.handle(renderMath, renderFormula);
  return () => {};
}
