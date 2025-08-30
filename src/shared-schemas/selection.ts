import { z } from "zod";
import { LineRangeSchema } from "./line-range";

export const SelectedFileReferenceSchema = z.object({
  path: z.string(),
  lines: z.array(LineRangeSchema).optional()
});

