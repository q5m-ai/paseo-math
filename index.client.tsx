import type { PluginClientContext } from "@getpaseo/plugin/client";

function setupPlugin(client: PluginClientContext) {
  // Keep client dependencies lazy so an Android evaluation failure includes the
  // dependency stack in the plugin status instead of only its final message.
  const { MathMessageView } = require("./client/math-message.js") as typeof import("./client/math-message.js");
  const { hasMath } = require("./client/generated/markdown.js") as typeof import("./client/generated/markdown.js");
  const { mathMessageSchema } = require("./shared/message.js") as typeof import("./shared/message.js");
  const objects = new WeakMap<object, { text: string; result: boolean }>();
  // Projection may clone settled items. Bound retained source while avoiding
  // reparsing those clones on every unrelated transcript/composer update.
  const sources = new Map<string, boolean>();
  let sourceCharacters = 0;
  client.addTimelineRenderer({
    kind: "math-message",
    version: 1,
    schema: mathMessageSchema,
    Component: MathMessageView,
  });
  // Paseo 0.8 projects assembled assistant text at render time. Its phase is
  // "complete" even while that text grows; do not use phase to gate rendering.
  client.addTimelineTransformer({
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
            type: "plugin" as const,
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

export default function setup(client: PluginClientContext) {
  try {
    return setupPlugin(client);
  } catch (error) {
    const detail =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw new Error(`q5m-math client initialization failed:\n${detail}`);
  }
}
