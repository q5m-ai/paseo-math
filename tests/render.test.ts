import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { renderFormula } from "../server/render.js";
import type { RenderOutput } from "../shared/render.js";

type ImageOutput = Extract<RenderOutput, { ok: true }>;

async function render(
  expression: string,
  display = false,
  color = "#17202a",
): Promise<ImageOutput> {
  const result = await renderFormula({ expression, display, color });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Rendering failed: ${result.reason}`);
  return result;
}

// Decode actual renderer PNGs, rather than mocking WASM or inspecting SVG source.
function pixels(image: ImageOutput): {
  width: number;
  height: number;
  rgba: Uint8Array;
} {
  const png = Buffer.from(image.png, "base64");
  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (png[24] !== 8 || png[25] !== 6 || png[28] !== 0)
    throw new Error("Expected non-interlaced RGBA8 PNG");
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const filtered = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)]!;
    if (filter > 4) throw new Error("Invalid PNG filter");
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= 4 ? rgba[index - 4]! : 0;
      const up = y > 0 ? rgba[index - stride]! : 0;
      const upperLeft = x >= 4 && y > 0 ? rgba[index - stride - 4]! : 0;
      const prediction = left + up - upperLeft;
      const dl = Math.abs(prediction - left);
      const du = Math.abs(prediction - up);
      const dc = Math.abs(prediction - upperLeft);
      const paeth = dl <= du && dl <= dc ? left : du <= dc ? up : upperLeft;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth;
      rgba[index] = (filtered[y * (stride + 1) + x + 1]! + predictor) & 255;
    }
  }
  return { width, height, rgba };
}

function inkCount(rgba: Uint8Array): number {
  let count = 0;
  for (let index = 3; index < rgba.length; index += 4)
    if (rgba[index]! > 0) count++;
  return count;
}

describe("local math rasterization", () => {
  it("typesets real glyphs with 2x pixels and a descender-aware inline baseline", async () => {
    const result = await render("q_j + 2");
    const decoded = pixels(result);
    expect(decoded.width).toBe(result.width * 2);
    expect(decoded.height).toBe(result.height * 2);
    expect(result.baseline).toBeGreaterThan(1);
    expect(result.baseline).toBeLessThan(result.height - 1);
    expect(inkCount(decoded.rgba)).toBeGreaterThan(30);
    // Padding remains transparent, not an opaque message-sized screenshot.
    expect(decoded.rgba[3]).toBe(0);
  });

  it("lays out display fractions and multiple aligned rows instead of literal TeX", async () => {
    const inline = await render(String.raw`\frac{p}{q}`);
    const display = await render(String.raw`\frac{p}{q}`, true);
    const aligned = await render(
      String.raw`\begin{aligned}p&=q+2\\r&=\frac{p}{q}\end{aligned}`,
      true,
    );
    expect(display.height).toBeGreaterThan(inline.height);
    expect(aligned.height).toBeGreaterThan(display.height);
    expect(inkCount(pixels(aligned).rgba)).toBeGreaterThan(
      inkCount(pixels(display).rgba),
    );
  });

  it("does not leak user-defined macros between independent formulas", async () => {
    const defined = await render(
      String.raw`\def\privateSymbol{p+2}\privateSymbol`,
    );
    expect(defined.png).toBe((await render("p+2")).png);
    expect(
      await renderFormula({
        expression: String.raw`\privateSymbol`,
        display: false,
        color: "#17202a",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    // Concurrent requests must not interleave mutable TeX configurations either.
    const [first, second] = await Promise.all([
      render(String.raw`\def\sharedName{a}\sharedName`),
      render(String.raw`\def\sharedName{b}\sharedName`),
    ]);
    expect(first.png).toBe((await render("a")).png);
    expect(second.png).toBe((await render("b")).png);
  });

  it("renders bold vectors in a full aligned Fourier transform", async () => {
    const result = await render(
      String.raw`\boxed{
\begin{aligned}
\widehat f(\boldsymbol\xi)
&=\int_{\mathbb R^n} f(\mathbf x)e^{-2\pi i\mathbf x\cdot\boldsymbol\xi}\,d^n\mathbf x,\\
f(\mathbf x)
&=\int_{\mathbb R^n} \widehat f(\boldsymbol\xi)e^{2\pi i\mathbf x\cdot\boldsymbol\xi}\,d^n\boldsymbol\xi.
\end{aligned}
}`,
      true,
    );
    expect(result.width).toBeGreaterThan(150);
    expect(result.height).toBeGreaterThan(30);
    expect(inkCount(pixels(result).rgba)).toBeGreaterThan(1_000);
  });

  it("renders standalone AMS equation tags as compact display geometry", async () => {
    const tagged = await render(
      String.raw`u_{2n+\varepsilon}=i^\varepsilon u_n,\qquad z_{2n+\varepsilon}=(1+i)z_n+\varepsilon u_n.\tag{1}`,
      true,
    );
    const compact = await render(
      String.raw`u_{2n+\varepsilon}=i^\varepsilon u_n,\qquad z_{2n+\varepsilon}=(1+i)z_n+\varepsilon u_n.\qquad{\text{(}1\text{)}}`,
      true,
    );
    expect(tagged).toEqual(compact);
    expect(tagged.width).toBeLessThan(600);
  });

  it("rasterizes leading and middle tags as trailing display and row labels", async () => {
    for (const expression of [String.raw`\tag{1}x=y`, String.raw`x\tag{1}=y`]) {
      expect(await render(expression, true)).toEqual(
        await render(String.raw`x=y\qquad{\text{(}1\text{)}}`, true),
      );
    }
    expect(await render(
      String.raw`\begin{align}\tag{1}x&=y\\u\tag*{B}&=v\end{align}`, true,
    )).toEqual(await render(
      String.raw`\begin{align}x&=y\qquad{\text{(}1\text{)}}\\u&=v\qquad{B}\end{align}`, true,
    ));
  });

  it("applies border-free boxed presentation without changing the expression", async () => {
    const expression = String.raw`\boxed{\frac{s}{t}}`;
    const input = Object.freeze({
      expression,
      display: true,
      color: "#17202a",
    });
    const result = await renderFormula(input);
    expect(result).toEqual(
      await render(String.raw`{\displaystyle \frac{s}{t}}`, true),
    );
    expect(input.expression).toBe(expression);
  });

  it("repairs text percent signs while retaining actual TeX comments and verbatim", async () => {
    expect((await render(String.raw`\text{23% complete}`)).png).toBe(
      (await render(String.raw`\text{23\% complete}`)).png,
    );
    expect((await render(String.raw`\text{23% complete}`)).png).toBe(
      (await render(String.raw`\text{23}\%\text{ complete}`)).png,
    );
    expect((await render("p % this is a comment\n+q")).png).toBe(
      (await render("p+q")).png,
    );
    const verbatim = await render(String.raw`\verb|23%|`);
    expect(inkCount(pixels(verbatim).rgba)).toBeGreaterThan(20);
  });

  it("fails malformed closed TeX instead of rasterizing an error message", async () => {
    expect(
      await renderFormula({
        expression: String.raw`\frac{p}`,
        display: false,
        color: "#17202a",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects package loading, external links, and filesystem commands", async () => {
    expect(
      await renderFormula({
        expression: String.raw`\require{html}\href{https://example.invalid/payload}{x}`,
        display: false,
        color: "#fff",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    // mmlToken belongs to the allowed base package: disabling HTML alone is insufficient.
    expect(
      await renderFormula({
        expression: String.raw`\mmlToken{mi}[href="https://example.invalid/payload"]{x}`,
        display: false,
        color: "#fff",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await renderFormula({
        expression: String.raw`\input{/etc/passwd}`,
        display: false,
        color: "#fff",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await renderFormula({
        expression: String.raw`\mmlToken{mi}[style="fill:url(https://example.invalid/paint)"]{x}`,
        display: false,
        color: "#fff",
      }),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("bounds recursive expansion and raster allocation before rendering", async () => {
    expect(
      await renderFormula({
        expression: String.raw`\def\loop{\loop}\loop`,
        display: false,
        color: "#fff",
      }),
    ).toEqual({ ok: false, reason: "too-large" });
    expect(
      await renderFormula({
        expression: String.raw`\rule{3000px}{1px}`,
        display: true,
        color: "#fff",
      }),
    ).toEqual({ ok: false, reason: "too-large" });
    expect(
      await renderFormula({
        expression: String.raw`\rule{1px}{2000px}`,
        display: true,
        color: "#fff",
      }),
    ).toEqual({ ok: false, reason: "too-large" });
    expect(
      await renderFormula({
        expression: "x".repeat(4097),
        display: false,
        color: "#fff",
      }),
    ).toEqual({ ok: false, reason: "too-large" });
    // Exercise an uncached expression after rejected expansion.
    expect(inkCount(pixels(await render("r+9")).rgba)).toBeGreaterThan(30);
  });

  it("honors light/dark themes and alpha in the actual PNG pixels", async () => {
    const expression = String.raw`\rule{5px}{5px}`;
    const light = pixels(await render(expression, false, "#000"));
    const dark = pixels(await render(expression, false, "#fff"));
    expect(inkCount(light.rgba)).toBe(inkCount(dark.rgba));
    const opaque = dark.rgba.findIndex(
      (value, index) => index % 4 === 3 && value === 255,
    );
    expect(opaque).toBeGreaterThan(0);
    expect([...light.rgba.slice(opaque - 3, opaque + 1)]).toEqual([
      0, 0, 0, 255,
    ]);
    expect([...dark.rgba.slice(opaque - 3, opaque + 1)]).toEqual([
      255, 255, 255, 255,
    ]);
    const translucent = pixels(await render(expression, false, "#ff008080"));
    expect([...translucent.rgba.slice(opaque - 3, opaque + 1)]).toEqual([
      255, 0, 128, 128,
    ]);
    expect((await render(expression, false, "#f008")).png).toBe(
      (await render(expression, false, "#ff000088")).png,
    );
    expect(
      inkCount(pixels(await render(expression, false, "#0000")).rgba),
    ).toBe(0);
  });
});
