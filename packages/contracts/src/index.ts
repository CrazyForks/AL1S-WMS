import { z } from "zod";

export const homeIdSchema = z.string().uuid();

export const itemSchema = z.object({
  id: z.string().uuid(),
  homeId: homeIdSchema,
  sku: z.string().min(1),
  name: z.string().min(1),
  baseUnit: z.string().min(1),
  reorderPoint: z.number().nonnegative(),
  reorderQuantity: z.number().positive(),
  active: z.boolean()
});

export const createItemSchema = itemSchema.omit({ id: true, active: true });
export type Item = z.infer<typeof itemSchema>;
export type CreateItem = z.infer<typeof createItemSchema>;
