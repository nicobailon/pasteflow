import { z } from "zod";

export const LineRangeSchema = z.object({
  start: z.number().int().positive(),
  end: z.number().int().positive()
});

