export type CatalogCapacityRecord = Record<string, unknown>

export type CatalogGuestCountValidation =
  | { ok: true; guestCount: number; capacity: number | null }
  | { ok: false; reason: "invalid" | "exceeds_capacity"; capacity: number | null }

/**
 * Reads the authoritative maximum from the persisted catalog capacity text.
 * Capacity strings may be ranges such as "80–100 pax" or "1-4 pax per room";
 * the largest numeric value is the enforceable maximum.
 */
export function getCatalogCapacity(item: CatalogCapacityRecord): number | null {
  const values = String(item.capacity || "").match(/\d+/g)?.map(Number) || []
  const maximum = values
    .filter((value) => Number.isFinite(value))
    .reduce((highest, value) => Math.max(highest, value), 0)
  return maximum > 0 ? maximum : null
}

export function validateCatalogGuestCount(
  item: CatalogCapacityRecord,
  value: unknown,
  maximumAllowed = 1000,
): CatalogGuestCountValidation {
  const numberValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : Number.NaN
  const capacity = getCatalogCapacity(item)

  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue)
    || numberValue < 1 || numberValue > maximumAllowed) {
    return { ok: false, reason: "invalid", capacity }
  }
  if (capacity !== null && numberValue > capacity) {
    return { ok: false, reason: "exceeds_capacity", capacity }
  }
  return { ok: true, guestCount: numberValue, capacity }
}
