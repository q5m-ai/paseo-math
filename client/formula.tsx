import { useRpc } from "@getpaseo/plugin";
import { memo, useEffect, useRef, useState } from "react";
import {
  Image,
  ScrollView,
  Text,
  useWindowDimensions,
  type TextStyle,
} from "react-native";
import { renderMath } from "../shared/render.js";
import {
  peekRender,
  renderKey,
  requestRender,
  type CachedRender,
} from "./render-cache.js";

type FormulaProps = {
  expression: string;
  source: string;
  display: boolean;
  block: boolean;
  color: string;
  hostId: string;
  textStyle: TextStyle;
  maxInlineWidth: number;
};

export const Formula = memo(function Formula({
  expression,
  source,
  display,
  block,
  color,
  hostId,
  textStyle,
  maxInlineWidth,
}: FormulaProps) {
  const call = useRpc(renderMath);
  const callRef = useRef(call);
  callRef.current = call;
  const input = { expression, display, color };
  const key = renderKey(hostId, input);
  const [settled, setSettled] = useState<{
    key: string;
    result: CachedRender;
  }>();
  const [failedImage, setFailedImage] = useState<string>();
  const { fontScale } = useWindowDimensions();
  const cached = peekRender(key);
  const result = settled?.key === key ? settled.result : cached;
  const eligible = expression.length > 0 && expression.length <= 4096;

  useEffect(() => {
    if (!eligible) return;
    let current = true;
    void requestRender(
      key,
      { expression, display, color },
      callRef.current,
    ).then((next) => {
      if (current) setSettled({ key, result: next });
    });
    return () => {
      current = false;
    };
  }, [key, expression, display, color, eligible]);

  const sourceText = (
    <Text selectable style={textStyle} accessibilityLabel={source}>
      {source}
    </Text>
  );

  if (
    !eligible ||
    !result?.ok ||
    failedImage === key ||
    (!block && maxInlineWidth <= 1)
  ) {
    return block ? (
      <ScrollView
        horizontal
        style={{ width: "100%", flexGrow: 0 }}
        contentContainerStyle={{ paddingVertical: 6 }}
      >
        {sourceText}
      </ScrollView>
    ) : (
      sourceText
    );
  }

  const fontSize = textStyle.fontSize ?? 16;
  const naturalScale = (fontSize / 16) * fontScale;
  const scale = block
    ? naturalScale
    : Math.min(naturalScale, Math.max(1, maxInlineWidth) / result.width);
  const width = result.width * scale;
  const height = result.height * scale;
  const descent = Math.max(0, result.height - result.baseline) * scale;
  const image = (
    <Image
      key={key}
      source={{ uri: `data:image/png;base64,${result.png}` }}
      accessible
      accessibilityLabel={source}
      resizeMode="contain"
      fadeDuration={0}
      onError={() => setFailedImage(key)}
      style={{
        width,
        height,
        ...(block ? {} : { transform: [{ translateY: descent }] }),
      }}
    />
  );

  if (block) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        removeClippedSubviews={false}
        style={{ width: "100%", flexGrow: 0, marginVertical: 6 }}
        contentContainerStyle={{ padding: 4 }}
        accessibilityLabel={`Formula: ${source}`}
      >
        {image}
      </ScrollView>
    );
  }

  // Native inline images occupy a text attachment ending at the baseline.
  // Shift its descender below that baseline, reserving enough line height for
  // both the attachment and descender instead of clipping tall fractions.
  return (
    <Text
      accessible
      accessibilityLabel={source}
      style={[
        textStyle,
        {
          lineHeight: Math.max(
            textStyle.lineHeight ?? fontSize * 1.5,
            (height + descent) / fontScale,
          ),
        },
      ]}
    >
      {image}
    </Text>
  );
});
