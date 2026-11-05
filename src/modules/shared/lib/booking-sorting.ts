export type BookingCreationRecord = {
  id?: unknown
  createdAt?: unknown
}

export type BookingSortDirection = "asc" | "desc"

function finiteMilliseconds(value: unknown) {
  const milliseconds = typeof value === "number" ? value : Number(value)
  return Number.isFinite(milliseconds) ? milliseconds : null
}

function normalizeNumericTimestamp(value: number) {
  // Legacy numeric timestamps are commonly Unix seconds, while browser/API
  // timestamps are milliseconds. Firestore Timestamp values are handled by
  // their own structural methods below.
  return Math.abs(value) < 100_000_000_000 ? value * 1000 : value
}

/** Normalize Firestore Timestamp, Date, ISO string, and legacy numeric values. */
export function getBookingCreationTime(value: unknown): number | null {
  if (value instanceof Date) {
    const milliseconds = value.getTime()
    return Number.isFinite(milliseconds) ? milliseconds : null
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? normalizeNumericTimestamp(value) : null
  }

  if (typeof value === "string") {
    const text = value.trim()
    if (!text) return null
    const numeric = Number(text)
    if (Number.isFinite(numeric)) return normalizeNumericTimestamp(numeric)
    const milliseconds = Date.parse(text)
    return Number.isFinite(milliseconds) ? milliseconds : null
  }

  if (typeof value !== "object" || value === null) return null

  const timestamp = value as {
    toMillis?: () => unknown
    toDate?: () => unknown
    seconds?: unknown
    _seconds?: unknown
    nanoseconds?: unknown
    _nanoseconds?: unknown
  }

  if (typeof timestamp.toMillis === "function") {
    try {
      const milliseconds = finiteMilliseconds(timestamp.toMillis())
      if (milliseconds !== null) return milliseconds
    } catch {
      // Continue to the other supported legacy shapes.
    }
  }

  if (typeof timestamp.toDate === "function") {
    try {
      const milliseconds = getBookingCreationTime(timestamp.toDate())
      if (milliseconds !== null) return milliseconds
    } catch {
      // Continue to the other supported legacy shapes.
    }
  }

  const seconds = finiteMilliseconds(timestamp.seconds ?? timestamp._seconds)
  if (seconds === null) return null
  const nanoseconds = finiteMilliseconds(timestamp.nanoseconds ?? timestamp._nanoseconds) ?? 0
  return seconds * 1000 + nanoseconds / 1_000_000
}

function compareBookingIds(left: BookingCreationRecord, right: BookingCreationRecord) {
  return String(left.id ?? "").localeCompare(String(right.id ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

/** Sort a copy newest/oldest first while keeping invalid timestamps last. */
export function sortBookingsByCreationTime<T extends BookingCreationRecord>(
  items: readonly T[],
  direction: BookingSortDirection = "desc",
) {
  return items
    .map((item, index) => ({ item, index, time: getBookingCreationTime(item.createdAt) }))
    .sort((left, right) => {
      if (left.time === null || right.time === null) {
        if (left.time === null && right.time === null) {
          return compareBookingIds(left.item, right.item) || left.index - right.index
        }
        return left.time === null ? 1 : -1
      }

      if (left.time !== right.time) {
        const comparison = left.time < right.time ? -1 : 1
        return direction === "asc" ? comparison : -comparison
      }

      return compareBookingIds(left.item, right.item) || left.index - right.index
    })
    .map(({ item }) => item)
}
