import type { PluginContext } from "@getpaseo/plugin";
import { MathMessageView } from "./client/math-message.js";
import { hasMath } from "./client/generated/markdown.js";
import { mathMessageSchema } from "./shared/message.js";
import { renderMath } from "./shared/render.js";
import { renderFormula } from "./server/render.js";

export default function setup(plugin: PluginContext) {
  plugin.handle(renderMath, renderFormula);
  const objects = new WeakMap<object, { text: string; result: boolean }>();
  // Projection may clone settled items. Bound retained source while avoiding
  // reparsing those clones on every unrelated transcript/composer update.
  const sources = new Map<string, boolean>();
  let sourceCharacters = 0;
  plugin.addTimelineRenderer({
    kind: "math-message",
    version: 1,
    schema: mathMessageSchema,
    Component: MathMessageView,
  });
  plugin.addTimelineTransformer({
    id: "assistant-math",
    query: { itemType: "assistant_message" },
    transform({ item }) {
      const remembered = objects.get(item);
      let result =
        remembered?.text === item.text
          ? remembered.result
          : sources.get(item.text);
      if (result === undefined) {
        result = hasMath(item.text);
        if (item.text.length <= 512 * 1024) {
          sources.set(item.text, result);
          sourceCharacters += item.text.length;
          for (const source of sources.keys()) {
            if (sources.size <= 256 && sourceCharacters <= 512 * 1024) break;
            sources.delete(source);
            sourceCharacters -= source.length;
          }
        }
      }
      objects.set(item, { text: item.text, result });
      if (!result) return undefined;
      return {
        items: [
          {
            type: "plugin",
            kind: "math-message",
            version: 1,
            data: { text: item.text },
          },
        ],
      };
    },
  });
  return () => {
    sources.clear();
    sourceCharacters = 0;
  };
}
