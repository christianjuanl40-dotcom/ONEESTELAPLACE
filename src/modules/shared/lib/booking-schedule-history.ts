import { formatAvailabilityTime, getAvailabilityTimeRange, parseAvailabilityTime } from "./availability"

export type BookingScheduleSnapshot = {
  date: string
  endDate?: string
  startTime?: string
  endTime?: string
  time?: string
}

export type BookingScheduleRevision = {
  revision: number
  previousSchedule: BookingScheduleSnapshot
  currentSchedule: BookingScheduleSnapshot
  changedAt: string
  changedBy?: string
  changedByName?: string
}

type ScheduleRecord = Record<string, unknown>

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && asText(value) !== ""
}

function normalizeTime(value: unknown): string | undefined {
  const text = asText(value)
  if (!text) return undefined
  const minutes = parseAvailabilityTime(text)
  if (minutes !== null) return formatAvailabilityTime(minutes)
  return text
}

function snapshotTime(record: ScheduleRecord): Pick<BookingScheduleSnapshot, "startTime" | "endTime" | "time"> {
  const interval = getAvailabilityTimeRange(record)
  if (interval) {
    const startTime = formatAvailabilityTime(interval.startMinutes)
    const endTime = formatAvailabilityTime(interval.endMinutes)
    return { startTime, endTime, time: `${startTime} - ${endTime}` }
  }

  const startTime = normalizeTime(record.startTime)
  const endTime = normalizeTime(record.endTime)
  const time = asText(record.time) || (startTime && endTime ? `${startTime} - ${endTime}` : undefined)
  return {
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(time ? { time } : {}),
  }
}

/**
 * Creates a compact, owner-readable snapshot from the trusted effective
 * booking fields. It deliberately ignores customer, resource, financial, and
 * lifecycle fields so schedule history cannot become a second booking record.
 */
export function getBookingScheduleSnapshot(record: ScheduleRecord): BookingScheduleSnapshot | null {
  const date = asText(record.date) || asText(record.startDate) || asText(record.eventDate)
  if (!date) return null

  const endDate = asText(record.endDate)
  const time = snapshotTime(record)
  return {
    date,
    ...(endDate && endDate !== date ? { endDate } : {}),
    ...time,
  }
}

/** Normalizes a server-maintained snapshot before it is rendered or reused. */
export function normalizeBookingScheduleSnapshot(value: unknown): BookingScheduleSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as ScheduleRecord
  const date = asText(record.date)
  if (!date) return null
  const endDate = asText(record.endDate)
  return {
    date,
    ...(endDate && endDate !== date ? { endDate } : {}),
    ...snapshotTime(record),
  }
}

function timeKey(value: unknown): string {
  const text = asText(value)
  if (!text) return ""
  const interval = getAvailabilityTimeRange({ time: text })
  return interval ? `${interval.startMinutes}:${interval.endMinutes}` : text.toLowerCase()
}

export function areBookingScheduleSnapshotsEqual(
  first: BookingScheduleSnapshot | null | undefined,
  second: BookingScheduleSnapshot | null | undefined,
): boolean {
  if (!first || !second) return false
  return first.date === second.date
    && (first.endDate || first.date) === (second.endDate || second.date)
    && timeKey(first.time || `${first.startTime || ""} - ${first.endTime || ""}`)
      === timeKey(second.time || `${second.startTime || ""} - ${second.endTime || ""}`)
}

export function normalizeBookingScheduleHistory(value: unknown): BookingScheduleRevision[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
    const record = entry as ScheduleRecord
    const previousSchedule = normalizeBookingScheduleSnapshot(record.previousSchedule)
    const currentSchedule = normalizeBookingScheduleSnapshot(record.currentSchedule)
    const changedAt = asText(record.changedAt)
    const revision = Number(record.revision)
    if (!previousSchedule || !currentSchedule || !changedAt || !Number.isInteger(revision) || revision < 1) return []
    return [{
      revision,
      previousSchedule,
      currentSchedule,
      changedAt,
      ...(asText(record.changedBy) ? { changedBy: asText(record.changedBy) } : {}),
      ...(asText(record.changedByName) ? { changedByName: asText(record.changedByName) } : {}),
    }]
  }).sort((first, second) => first.revision - second.revision)
}

/**
 * Builds the only history fields written by the server after a successful
 * schedule change. Existing original metadata is never replaced.
 */
export function buildBookingScheduleHistoryUpdate(
  booking: ScheduleRecord,
  candidate: ScheduleRecord,
  changedAt: string,
  actorId?: string,
  actorName?: string,
): Record<string, unknown> {
  const previousSchedule = getBookingScheduleSnapshot(booking)
  const currentSchedule = getBookingScheduleSnapshot(candidate)
  if (!previousSchedule || !currentSchedule || areBookingScheduleSnapshotsEqual(previousSchedule, currentSchedule)) return {}

  const existingOriginalSchedule = normalizeBookingScheduleSnapshot(booking.originalSchedule)
  const originalSchedule = existingOriginalSchedule || previousSchedule
  const history = normalizeBookingScheduleHistory(booking.scheduleHistory)
  const nextRevision = (history[history.length - 1]?.revision || 0) + 1
  const revision: BookingScheduleRevision = {
    revision: nextRevision,
    previousSchedule,
    currentSchedule,
    changedAt,
    ...(actorId ? { changedBy: actorId } : {}),
    ...(actorName ? { changedByName: actorName } : {}),
  }

  return {
    originalSchedule,
    scheduleHistory: [...history, revision],
    ...(existingOriginalSchedule ? {} : { originalScheduleCapturedAt: changedAt }),
  }
}

export function hasTrackedScheduleHistory(record: ScheduleRecord): boolean {
  const original = normalizeBookingScheduleSnapshot(record.originalSchedule)
  const current = getBookingScheduleSnapshot(record)
  return Boolean(original && current && !areBookingScheduleSnapshotsEqual(original, current))
    || normalizeBookingScheduleHistory(record.scheduleHistory).length > 0
}

export function hasAnyScheduleValue(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.values(value as ScheduleRecord).some(hasValue)
}
