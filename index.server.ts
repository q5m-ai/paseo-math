import type { PluginServerContext } from "@getpaseo/plugin";
import { renderMath } from "./shared/render.js";
import { renderFormula } from "./server/render.js";

export default function contribute(server: PluginServerContext) {
  server.handle(renderMath, renderFormula);
  return () => undefined;
}
