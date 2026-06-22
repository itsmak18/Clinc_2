// Client-generated identifier shared across rows created from one multi-add order
// (e.g. CBC + Lipid + HbA1c from a single draw, or chest + hand X-rays in one visit).
// crypto.randomUUID is available in all supported browsers (and jsdom in tests).
export function newOrderGroupId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `og_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// Counts how many loaded rows share each orderGroupId, so the list can badge
// "part of an order of N". Rows without a group id are ignored.
export function countByOrderGroup<T extends { orderGroupId?: string | null }>(rows: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.orderGroupId) counts[r.orderGroupId] = (counts[r.orderGroupId] ?? 0) + 1;
  }
  return counts;
}
