import { describe, expect, it } from "vitest";
import { formulaScale } from "../client/formula-scale.js";

const base = {
  fontSize: 16,
  fontScale: 1,
  block: true,
  display: true,
  platform: "android",
  maxInlineWidth: 320,
  width: 200,
};

describe("formula sizing", () => {
  it.each(["android", "ios"])("enlarges display equations on %s by 25%%", (platform) => {
    expect(formulaScale({ ...base, platform })).toBe(1.25);
  });

  it("preserves desktop/web display sizing", () => {
    expect(formulaScale({ ...base, platform: "web" })).toBe(1);
  });

  it("does not shrink wide mobile blocks to the viewport", () => {
    expect(formulaScale({ ...base, width: 1000 })).toBe(1.25);
  });

  it("retains accessibility and text size scaling", () => {
    expect(formulaScale({ ...base, fontSize: 20, fontScale: 1.5 })).toBe(2.34375);
  });

  it("leaves inline math at body-text scale", () => {
    expect(formulaScale({ ...base, block: false, display: false })).toBe(1);
    expect(formulaScale({ ...base, block: true, display: false })).toBe(1);
  });

  it("still constrains wide inline attachments", () => {
    expect(formulaScale({ ...base, block: false, display: false, width: 640 })).toBe(0.5);
  });
});
