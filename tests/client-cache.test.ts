import { describe, expect, it } from "vitest";
import {
  peekRender,
  renderKey,
  requestRender,
} from "../client/render-cache.js";
import type { RenderInput, RenderOutput } from "../shared/render.js";

const input: RenderInput = {
  expression: "r+s",
  display: false,
  color: "#202020",
};
const image: RenderOutput = {
  ok: true,
  png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=",
  width: 1,
  height: 1,
  baseline: 1,
};

describe("formula request cache", () => {
  it("does not reuse another host's successful render when this host is offline", async () => {
    const online = renderKey("cache-test-online", input);
    const offline = renderKey("cache-test-offline", input);
    await requestRender(online, input, async () => image);
    expect(
      await requestRender(offline, input, async () => {
        throw new Error("Disconnected");
      }),
    ).toBeNull();
    expect(peekRender(online)).toEqual(image);
    expect(peekRender(offline)).toBeNull();
  });

  it("queues every formula in a full proof instead of dropping the tail", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = Array.from({ length: 96 }, (_, index) => {
      const next = { ...input, expression: `proof_${index}` };
      return requestRender(
        renderKey("cache-test-full-proof", next),
        next,
        async () => {
          await gate;
          return image;
        },
      );
    });
    release();
    expect(await Promise.all(pending)).toEqual(Array(96).fill(image));
  });

  it("retains completed renders while more than 128 formulas remain pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const firstInput = { ...input, expression: "large-proof-0" };
    const firstKey = renderKey("cache-test-large-proof", firstInput);
    const pending = Array.from({ length: 200 }, (_, index) => {
      const next = { ...input, expression: `large-proof-${index}` };
      return requestRender(renderKey("cache-test-large-proof", next), next, async () => {
        calls++;
        if (index !== 0) await gate;
        return image;
      });
    });
    try {
      await pending[0];
      expect(peekRender(firstKey)).toEqual(image);
      expect(requestRender(firstKey, firstInput, async () => {
        throw new Error("Duplicate remount RPC");
      })).toBe(pending[0]);
    } finally {
      release();
      await Promise.all(pending);
    }
    expect(calls).toBe(200);
    const retained = Array.from({ length: 200 }, (_, index) => {
      const next = { ...input, expression: `large-proof-${index}` };
      return peekRender(renderKey("cache-test-large-proof", next));
    }).filter((result) => result !== undefined);
    expect(retained).toHaveLength(128); // completed LRU is still bounded
    const last = { ...input, expression: "large-proof-199" };
    expect(peekRender(renderKey("cache-test-large-proof", last))).toEqual(image);
  });

  it("shares pending/remounted requests and keeps newer expressions independent of late results", async () => {
    const oldKey = renderKey("cache-test-stream", input);
    const nextInput = { ...input, expression: "r+s+t" };
    const nextKey = renderKey("cache-test-stream", nextInput);
    let finishOld!: (value: RenderOutput) => void;
    const pendingOld = new Promise<RenderOutput>((resolve) => {
      finishOld = resolve;
    });
    const first = requestRender(oldKey, input, () => pendingOld);
    const concurrent = requestRender(oldKey, input, async () => {
      throw new Error("Duplicate request");
    });
    const newer = await requestRender(nextKey, nextInput, async () => ({
      ok: false,
      reason: "invalid",
    }));
    expect(newer).toEqual({ ok: false, reason: "invalid" });
    finishOld(image);
    expect(await first).toEqual(image);
    expect(await concurrent).toEqual(image);
    expect(peekRender(nextKey)).toEqual({ ok: false, reason: "invalid" });
    expect(
      await requestRender(oldKey, input, async () => {
        throw new Error("Remount repeated request");
      }),
    ).toEqual(image);
  });
});
