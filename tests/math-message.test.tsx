import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import type { MathMessage } from "../shared/message.js";

// Paseo injects both modules at runtime, so tests supply them.
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  copyText: async () => {},
  useToast: () => ({ show: () => {}, error: () => {} }),
}));
vi.mock("@getpaseo/plugin/client", () => ({
  openExternalUrl: async () => {},
  useRpc: () => async () => ({ ok: false, reason: "invalid" }),
}));
const revealed = vi.fn((text: string, _phase: string) => text);
vi.mock("../client/use-revealed-text.js", () => ({
  useRevealedText: (text: string, phase: string) => revealed(text, phase),
}));

const { MathMessageView, isSameMathMessage } = await import("../client/math-message.js");

const colors = {
  foreground: "#e6edf3", foregroundMuted: "#8b949e", surface0: "#0d1117", surface1: "#161b22",
  surface2: "#21262d", border: "#30363d", accent: "#2f81f7",
};

function props(
  text: string,
  phase: MathMessage["phase"] = "complete",
): PluginTimelineItemProps<MathMessage> {
  return {
    agentId: "agent-1",
    item: { type: "plugin", kind: "math-message", version: 2, data: { text, phase } },
    timestamp: new Date(0),
    theme: { colors },
    host: { id: "host-1", label: "Host" },
    layout: { compact: false, platform: "web" },
  } as unknown as PluginTimelineItemProps<MathMessage>;
}

describe("MathMessageView pacing", () => {
  it("paces the text with the item's phase", () => {
    renderToStaticMarkup(<MathMessageView {...props("Area $x$", "streaming")} />);
    expect(revealed).toHaveBeenLastCalledWith("Area $x$", "streaming");
  });

  it("renders the revealed prefix, not the full text", () => {
    revealed.mockReturnValueOnce("Partial");
    const html = renderToStaticMarkup(<MathMessageView {...props("Partial answer $x$", "streaming")} />);
    expect(html).toContain("Partial");
    expect(html).not.toContain("answer");
  });
});

describe("isSameMathMessage", () => {
  it("is equal for equal text and phase", () => {
    expect(isSameMathMessage(props("$x$", "streaming"), props("$x$", "streaming"))).toBe(true);
  });

  it("is not equal when only the phase changes", () => {
    expect(isSameMathMessage(props("$x$", "streaming"), props("$x$", "complete"))).toBe(false);
  });

  it("is not equal when the text changes", () => {
    expect(isSameMathMessage(props("$x$"), props("$y$"))).toBe(false);
  });
});
