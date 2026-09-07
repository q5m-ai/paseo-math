import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const renderInput = z.object({
  expression: z.string().min(1).max(4096),
  display: z.boolean(),
  color: z
    .string()
    .regex(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i),
});

export const renderOutput = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    png: z.string().max(2_000_000),
    width: z.number().positive().max(2048),
    height: z.number().positive().max(1024),
    baseline: z.number().nonnegative().max(1024),
  }),
  z.object({ ok: z.literal(false), reason: z.enum(["invalid", "too-large"]) }),
]);

export const renderMath = defineRpc({
  name: "math.render",
  input: renderInput,
  output: renderOutput,
});
export type RenderInput = z.infer<typeof renderInput>;
export type RenderOutput = z.infer<typeof renderOutput>;
