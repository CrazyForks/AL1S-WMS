import { z } from "zod";

// Inventory quantities are kept at hundredth-unit precision, including legacy ledger reads.
export const roundQuantity = (value: number) => Math.round(value * 100) / 100 || 0;
export const positiveQuantity = z.number().finite().positive().transform(roundQuantity).pipe(z.number().positive());
export const nonnegativeQuantity = z.number().finite().nonnegative().transform(roundQuantity);
