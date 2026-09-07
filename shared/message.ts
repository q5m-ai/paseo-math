import { z } from "zod";

export const mathMessageSchema = z.object({
  text: z.string(),
});
export type MathMessage = z.infer<typeof mathMessageSchema>;
