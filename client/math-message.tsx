import type { PluginTimelineItemProps } from "@getpaseo/plugin";
import { copyText, useToast } from "@getpaseo/plugin/react-native";
import { memo, useCallback, useMemo, useState } from "react";
import {
  Linking,
  Platform,
  Pressable,
  Text,
  View,
  processColor,
  type TextStyle,
} from "react-native";
import type { MathMessage } from "../shared/message.js";
import Markdown, {
  MarkdownIt,
  markdownMath,
  type ASTNode,
  type RenderFunction,
  type RenderRules,
} from "./generated/markdown.js";
import { Formula } from "./formula.js";

const markdown = new MarkdownIt({
  html: false,
  typographer: false,
  linkify: true,
}).use(markdownMath);

// The dependency's runtime retains token.meta, but its public ASTNode type
// omits sourceMeta. Narrow that field instead of serializing TeX into markup.
type MathNode = ASTNode & { sourceMeta?: unknown };

function colorHex(color: TextStyle["color"], fallback: string): string {
  if (
    typeof color === "string" &&
    /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)
  )
    return color;
  const value = processColor(color ?? fallback);
  if (typeof value !== "number") return "#808080";
  // React Native processColor produces ARGB on all platforms (signed on Android).
  return `#${(value & 0xffffff).toString(16).padStart(6, "0")}${(value >>> 24).toString(16).padStart(2, "0")}`;
}

export const MathMessageView = memo(
  function MathMessageView({
    item,
    host,
    theme,
    layout,
  }: PluginTimelineItemProps<MathMessage>) {
    const { text } = item.data;
    const colors = theme.colors;
    const toast = useToast();
    const [width, setWidth] = useState(0);
    const fontSize = layout.compact ? 14 : 16;
    const styles = useMemo(
      () => ({
        body: {
          color: colors.foreground,
          fontSize,
          lineHeight: fontSize * 1.5,
        },
        textgroup: { flexShrink: 1 },
        paragraph: { marginTop: 4, marginBottom: 8 },
        heading1: {
          fontSize: fontSize * 1.8,
          lineHeight: fontSize * 2.3,
          marginVertical: 8,
        },
        heading2: {
          fontSize: fontSize * 1.5,
          lineHeight: fontSize * 2,
          marginVertical: 6,
        },
        heading3: {
          fontSize: fontSize * 1.25,
          lineHeight: fontSize * 1.75,
          marginVertical: 4,
        },
        blockquote: {
          color: colors.foregroundMuted,
          backgroundColor: colors.surface1,
          borderColor: colors.border,
          paddingVertical: 4,
        },
        link: { color: colors.accent },
        code_inline: {
          color: colors.foreground,
          backgroundColor: colors.surface2,
          borderColor: colors.border,
          padding: 1,
        },
        code_block: {
          color: colors.foreground,
          backgroundColor: colors.surface1,
          borderColor: colors.border,
        },
        fence: {
          color: colors.foreground,
          backgroundColor: colors.surface1,
          borderColor: colors.border,
        },
        hr: { backgroundColor: colors.border },
        table: { borderColor: colors.border },
        tr: { borderColor: colors.border },
        blocklink: { borderColor: colors.border },
      }),
      [
        fontSize,
        colors.foreground,
        colors.foregroundMuted,
        colors.surface1,
        colors.surface2,
        colors.border,
        colors.accent,
      ],
    );

    const rules = useMemo<RenderRules>(() => {
      const mathRule: RenderFunction = (
        node: MathNode,
        _children,
        _parents,
        _styles,
        inherited: TextStyle = {},
      ) => {
        const meta = node.sourceMeta;
        const source =
          meta &&
          typeof meta === "object" &&
          "source" in meta &&
          typeof meta.source === "string"
            ? meta.source
            : `${node.markup}${node.content}${node.markup === "\\(" ? "\\)" : node.markup === "\\[" ? "\\]" : node.markup}`;
        return (
          <Formula
            key={node.key}
            expression={node.content}
            source={source}
            display={
              meta &&
              typeof meta === "object" &&
              "display" in meta &&
              typeof meta.display === "boolean"
                ? meta.display
                : node.type === "math_block"
            }
            block={node.type === "math_block"}
            color={colorHex(inherited.color, colors.foreground)}
            hostId={host.id}
            textStyle={inherited}
            maxInlineWidth={Math.max(1, width - 48)}
          />
        );
      };
      return {
        math_inline: mathRule,
        math_block: mathRule,
        text: (node, _children, _parents, ruleStyles, inherited = {}) => (
          <Text key={node.key} selectable style={[inherited, ruleStyles.text]}>
            {node.content}
          </Text>
        ),
        code_inline: (
          node,
          _children,
          _parents,
          ruleStyles,
          inherited = {},
        ) => (
          <Text
            key={node.key}
            selectable
            style={[inherited, ruleStyles.code_inline]}
          >
            {node.content}
          </Text>
        ),
        fence: (node, _children, _parents, ruleStyles, inherited = {}) => (
          <Text
            key={node.key}
            selectable
            style={[
              inherited,
              ruleStyles.fence,
              { fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
            ]}
          >
            {node.content.replace(/\n$/, "")}
          </Text>
        ),
        code_block: (node, _children, _parents, ruleStyles, inherited = {}) => (
          <Text
            key={node.key}
            selectable
            style={[
              inherited,
              ruleStyles.code_block,
              { fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
            ]}
          >
            {node.content.replace(/\n$/, "")}
          </Text>
        ),
      };
    }, [colors.foreground, host.id, width]);

    const onLinkPress = useCallback(
      (url: string) => {
        // Opening happens only after a user's press, never while parsing/rendering.
        // Refuse custom app/file/script schemes even if a future parser allows them.
        if (!/^(?:https?:\/\/|mailto:)/i.test(url)) {
          toast.error("This link type is not supported.");
          return false;
        }
        void Linking.openURL(url).catch(() =>
          toast.error("Unable to open this link."),
        );
        return false;
      },
      [toast],
    );

    const copyOriginal = useCallback(() => {
      void copyText(text).then(
        () => toast.show("Original message copied", { variant: "success" }),
        () => toast.error("Unable to copy the message."),
      );
    }, [text, toast]);

    return (
      <View
        style={{ minWidth: 0, width: "100%" }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        <Markdown
          markdownit={markdown}
          style={styles}
          rules={rules}
          onLinkPress={onLinkPress}
        >
          {text}
        </Markdown>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy original message"
          onPress={copyOriginal}
          style={{
            alignSelf: "flex-start",
            paddingVertical: 8,
            paddingHorizontal: 4,
            minHeight: 44,
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: colors.foregroundMuted,
              fontSize: layout.compact ? 12 : 13,
            }}
          >
            Copy original message
          </Text>
        </Pressable>
      </View>
    );
  },
  (previous, next) => {
    const a = previous.theme.colors;
    const b = next.theme.colors;
    return (
      previous.item.data.text === next.item.data.text &&
      previous.host.id === next.host.id &&
      previous.layout.compact === next.layout.compact &&
      a.foreground === b.foreground &&
      a.foregroundMuted === b.foregroundMuted &&
      a.surface1 === b.surface1 &&
      a.surface2 === b.surface2 &&
      a.border === b.border &&
      a.accent === b.accent
    );
  },
);
