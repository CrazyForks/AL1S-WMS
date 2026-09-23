// Display and threshold calculations use the same hundredth-unit precision as inventory storage.
export function roundQuantity(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}
