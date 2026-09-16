import { z } from "zod";

export const homeIdSchema = z.string().uuid();

export const itemSchema = z.object({
  id: z.string().uuid(),
  homeId: homeIdSchema,
  sku: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  baseUnit: z.string().min(1),
  reorderPoint: z.number().nonnegative(),
  reorderQuantity: z.number().nonnegative(),
  manufacturedDate: z.string().date().nullable().optional(),
  expiryDate: z.string().date().nullable().optional(),
  active: z.boolean()
});

export const createItemSchema = itemSchema.omit({ id: true, active: true }).extend({
  sku: z.string().trim().max(80).optional(),
  locationId: z.string().uuid().optional(),
  initialStock: z.number().nonnegative().optional().default(0)
});
export type Item = z.infer<typeof itemSchema>;
export type CreateItem = z.infer<typeof createItemSchema>;
export const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  baseUnit: z.string().min(1).optional(),
  reorderPoint: z.number().nonnegative().optional(),
  locationId: z.string().uuid().nullable().optional(),
  manufacturedDate: z.string().date().nullable().optional(),
  expiryDate: z.string().date().nullable().optional()
}).refine((value) => Object.keys(value).length > 0);
export type UpdateItem = z.infer<typeof updateItemSchema>;

export const stockCommandSchema = z.object({
  itemId: z.string().uuid(),
  locationId: z.string().uuid(),
  quantity: z.number().positive(),
  reason: z.string().max(200).optional(),
  idempotencyKey: z.string().min(1).max(200)
});

export type StockCommand = z.infer<typeof stockCommandSchema>;
