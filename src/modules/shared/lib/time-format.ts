const MANILA_TIME_ZONE = "Asia/Manila"

export type TimestampLike =
  | Date
  | string
  | number
  | {
      toDate?: () => Date
      toMillis?: () => number
      seconds?: number | string
      _seconds?: number | string
      nanoseconds?: number | string
      _nanoseconds?: number | string
    }
  | null
  | undefined

/** Converts supported Firestore/browser timestamp values without inventing a fallback date. */
export function toValidDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    // Firestore exports and older records may store Unix seconds. Browser
    // timestamps are normally milliseconds, so use the size of the value to
    // distinguish the two without inventing a date for invalid numbers.
    const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value
    const date = new Date(milliseconds)
    return Number.isNaN(date.getTime()) ? null : date
  }

  if (typeof value === "string") {
    const text = value.trim()
    if (!text) return null
    const numeric = Number(text)
    const milliseconds = Number.isFinite(numeric)
      ? Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric
      : null
    const date = new Date(milliseconds === null ? text : milliseconds)
    return Number.isNaN(date.getTime()) ? null : date
  }

  if (typeof value !== "object") return null

  const timestamp = value as TimestampLike & Record<string, unknown>

  if (typeof timestamp.toMillis === "function") {
    try {
      const milliseconds = timestamp.toMillis()
      if (typeof milliseconds === "number" && Number.isFinite(milliseconds)) {
        const date = new Date(milliseconds)
        if (!Number.isNaN(date.getTime())) return date
      }
    } catch {
      // Continue through the other supported timestamp shapes.
    }
  }

  if (typeof timestamp.toDate === "function") {
    try {
      const date = timestamp.toDate()
      if (date instanceof Date && !Number.isNaN(date.getTime())) return date
    } catch {
      // Continue through the other supported timestamp shapes.
    }
  }

  const secondsValue = timestamp.seconds ?? timestamp._seconds
  const nanosecondsValue = timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0
  const seconds = Number(secondsValue)
  const nanoseconds = Number(nanosecondsValue)
  if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
    const date = new Date(seconds * 1000 + nanoseconds / 1_000_000)
    return Number.isNaN(date.getTime()) ? null : date
  }

  return null
}

function getManilaDateParts(value: unknown): { year: number; month: number; day: number } | null {
  const date = toValidDate(value)
  if (!date) return null

  const parts = new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const year = Number(values.year)
  const month = Number(values.month)
  const day = Number(values.day)
  if (![year, month, day].every(Number.isFinite)) return null
  return { year, month, day }
}

export function getManilaDateKey(value: unknown): string | null {
  const parts = getManilaDateParts(value)
  if (!parts) return null
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`
}

export function formatManilaTime(value: TimestampLike): string | null {
  const date = toValidDate(value)
  if (!date) return null
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)
}

export function formatManilaDateTime(value: TimestampLike): string | null {
  const date = toValidDate(value)
  if (!date) return null
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)
}

export function formatManilaDate(value: TimestampLike): string | null {
  const date = toValidDate(value)
  if (!date) return null
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: MANILA_TIME_ZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

export function formatManilaDayLabel(value: TimestampLike, now: TimestampLike = new Date()): string | null {
  const key = getManilaDateKey(value)
  const nowKey = getManilaDateKey(now)
  if (!key || !nowKey) return null

  const dayDifference = Math.round(
    (Date.parse(`${nowKey}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) / 86_400_000,
  )
  if (dayDifference === 0) return "Today"
  if (dayDifference === 1) return "Yesterday"

  const date = toValidDate(value)
  if (!date) return null
  if (dayDifference > 1 && dayDifference < 7) {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: MANILA_TIME_ZONE,
      weekday: "long",
    }).format(date)
  }
  return formatManilaDate(value)
}

export function isSameManilaDay(first: TimestampLike, second: TimestampLike): boolean {
  const firstKey = getManilaDateKey(first)
  const secondKey = getManilaDateKey(second)
  return firstKey === secondKey
}
