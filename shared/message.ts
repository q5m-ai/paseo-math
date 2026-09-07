import { z } from "zod";

export const mathMessageSchema = z.object({
  text: z.string(),
  phase: z.enum(["streaming", "complete"]),
});
export type MathMessage = z.infer<typeof mathMessageSchema>;
