import { isAvailabilityBlockingBooking, normalizeStatus } from "./booking-helpers"

export type AvailabilityCategory = "venue" | "office"
export type AvailabilityStatus = "available" | "few" | "full" | "maintenance"

export type AvailabilitySpace = {
  category: AvailabilityCategory
  venueId: string
  officeId?: string
  spaceId?: string
  name: string
  roomName?: string
}

export type AvailabilityRecord = Record<string, unknown> & { id?: string }

export type AvailabilitySlot = {
  startMinutes: number
  endMinutes: number
  startTimeLabel: string
  endTimeLabel: string
  label: string
}

export type AvailabilityDay = {
  status: AvailabilityStatus
  availableSlots: AvailabilitySlot[]
}

export type EventSchedule = {
  openingMinutes: number
  closingMinutes: number
  bookingDurationMinutes: number
  slotIntervalMinutes: number
}

export type OfficeRentalLike = AvailabilityRecord

// These are the existing venue defaults represented by the original booking
// selector. CMS fields, when present, always override them.
export const DEFAULT_EVENT_SCHEDULE: EventSchedule = {
  openingMinutes: 8 * 60,
  closingMinutes: 22 * 60,
  bookingDurationMinutes: 6 * 60,
  slotIntervalMinutes: 60,
}

const TERMINAL_OFFICE_RENTAL_STATUSES = new Set([
  "declined",
  "cancelled",
  "completed",
])

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value || "").trim()
}

export function normalizeAvailabilityName(value: unknown): string {
  return asString(value).toLowerCase().replace(/\s+/g, " ")
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "")
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

/** Parses the display time formats used by existing and legacy bookings. */
export function parseAvailabilityTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= 0 && value <= 24 * 60 ? value : null
  }

  const normalized = asString(value)
  if (!normalized) return null

  const twelveHour = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (twelveHour) {
    let hour = Number(twelveHour[1])
    const minute = Number(twelveHour[2] || 0)
    if (hour < 1 || hour > 12 || minute > 59) return null
    if (twelveHour[3].toUpperCase() === "AM" && hour === 12) hour = 0
    if (twelveHour[3].toUpperCase() === "PM" && hour !== 12) hour += 12
    return hour * 60 + minute
  }

  const twentyFourHour = normalized.match(/^(\d{1,2}):(\d{2})$/)
  if (!twentyFourHour) return null
  const hour = Number(twentyFourHour[1])
  const minute = Number(twentyFourHour[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

export function formatAvailabilityTime(minutes: number): string {
  const safeMinutes = Math.max(0, Math.min(24 * 60, Math.round(minutes)))
  const hour24 = Math.floor(safeMinutes / 60) % 24
  const minute = safeMinutes % 60
  const meridiem = hour24 >= 12 ? "PM" : "AM"
  const hour12 = hour24 % 12 || 12
  return `${hour12}:${String(minute).padStart(2, "0")} ${meridiem}`
}

export function getAvailabilityTimeRange(record: AvailabilityRecord): { startMinutes: number; endMinutes: number } | null {
  let start = parseAvailabilityTime(firstValue(record.startTime, record.start_time, record.start, record.bookingStartTime))
  let end = parseAvailabilityTime(firstValue(record.endTime, record.end_time, record.end, record.bookingEndTime))

  if (start === null || end === null) {
    const range = asString(firstValue(record.time, record.timeRange, record.bookingTime))
      .split(/\s*[-–—]\s*/)
    if (range.length === 2) {
      start = start ?? parseAvailabilityTime(range[0])
      end = end ?? parseAvailabilityTime(range[1])
    }
  }

  if (start === null || end === null || end <= start) return null
  return { startMinutes: start, endMinutes: end }
}

function readScheduleTime(source: Record<string, unknown>, keys: string[]): number | null {
  return parseAvailabilityTime(firstValue(...keys.map((key) => source[key])))
}

export function getEventSchedule(config: unknown): EventSchedule {
  const source = asRecord(config) || {}
  const hours = asRecord(firstValue(source.operatingHours, source.operatingSchedule, source.businessHours)) || {}
  const nestedSchedule = asRecord(source.schedule) || {}

  const openingMinutes = readScheduleTime(source, ["openingTime", "openTime", "open", "opensAt", "bookingOpenTime"])
    ?? readScheduleTime(hours, ["openingTime", "openTime", "open", "start", "from"])
    ?? readScheduleTime(nestedSchedule, ["openingTime", "openTime", "open", "start", "from"])
    ?? DEFAULT_EVENT_SCHEDULE.openingMinutes
  const closingMinutes = readScheduleTime(source, ["closingTime", "closeTime", "close", "closesAt", "bookingCloseTime"])
    ?? readScheduleTime(hours, ["closingTime", "closeTime", "close", "end", "to"])
    ?? readScheduleTime(nestedSchedule, ["closingTime", "closeTime", "close", "end", "to"])
    ?? DEFAULT_EVENT_SCHEDULE.closingMinutes

  const durationValue = firstValue(
    source.bookingDurationMinutes,
    source.reservationDurationMinutes,
    source.durationMinutes,
  )
  const durationHoursValue = firstValue(
    source.bookingDurationHours,
    source.reservationDurationHours,
    source.durationHours,
    source.bookingDuration,
    source.duration,
  )
  const durationMinutes = durationValue !== undefined
    ? parseNumeric(durationValue)
    : durationHoursValue !== undefined
      ? (parseNumeric(durationHoursValue) || 0) * 60
      : DEFAULT_EVENT_SCHEDULE.bookingDurationMinutes
  const intervalValue = firstValue(source.slotIntervalMinutes, source.bookingSlotIntervalMinutes)
  const intervalHoursValue = firstValue(source.slotIntervalHours, source.bookingSlotIntervalHours, source.slotInterval)
  const slotIntervalMinutes = intervalValue !== undefined
    ? parseNumeric(intervalValue)
    : intervalHoursValue !== undefined
      ? (parseNumeric(intervalHoursValue) || 0) * 60
      : DEFAULT_EVENT_SCHEDULE.slotIntervalMinutes

  const safeOpening = Number.isFinite(openingMinutes) ? openingMinutes : DEFAULT_EVENT_SCHEDULE.openingMinutes
  const safeClosing = Number.isFinite(closingMinutes) ? closingMinutes : DEFAULT_EVENT_SCHEDULE.closingMinutes
  const safeDuration = Number.isFinite(durationMinutes) && (durationMinutes || 0) > 0
    ? durationMinutes as number
    : DEFAULT_EVENT_SCHEDULE.bookingDurationMinutes
  const safeInterval = Number.isFinite(slotIntervalMinutes) && (slotIntervalMinutes || 0) > 0
    ? slotIntervalMinutes as number
    : DEFAULT_EVENT_SCHEDULE.slotIntervalMinutes

  if (safeClosing <= safeOpening || safeDuration > safeClosing - safeOpening) {
    return DEFAULT_EVENT_SCHEDULE
  }

  return {
    openingMinutes: safeOpening,
    closingMinutes: safeClosing,
    bookingDurationMinutes: safeDuration,
    slotIntervalMinutes: safeInterval,
  }
}

export function getEventSlots(config: unknown): AvailabilitySlot[] {
  const schedule = getEventSchedule(config)
  const slots: AvailabilitySlot[] = []
  for (
    let startMinutes = schedule.openingMinutes;
    startMinutes + schedule.bookingDurationMinutes <= schedule.closingMinutes;
    startMinutes += schedule.slotIntervalMinutes
  ) {
    const endMinutes = startMinutes + schedule.bookingDurationMinutes
    slots.push({
      startMinutes,
      endMinutes,
      startTimeLabel: formatAvailabilityTime(startMinutes),
      endTimeLabel: formatAvailabilityTime(endMinutes),
      label: `${formatAvailabilityTime(startMinutes)} - ${formatAvailabilityTime(endMinutes)}`,
    })
  }
  return slots
}

export function hasAvailabilityTimeOverlap(
  startMinutes: number | null,
  endMinutes: number | null,
  existingStartMinutes: number | null,
  existingEndMinutes: number | null,
): boolean {
  // Unknown legacy times are treated conservatively as occupied.
  if (startMinutes === null || endMinutes === null || existingStartMinutes === null || existingEndMinutes === null) return true
  // Reservation intervals are half-open: a booking ending at 2 PM does not
  // conflict with a new booking beginning at 2 PM.
  return startMinutes < existingEndMinutes && existingStartMinutes < endMinutes
}

function isOfficeBooking(record: AvailabilityRecord): boolean {
  return record.isOfficeRental === true
    || normalizeAvailabilityName(record.bookingCategory) === "office"
    || normalizeAvailabilityName(record.bookingType) === "office"
    || normalizeAvailabilityName(record.venue).includes("office")
}

export function isOfficeAvailabilityBooking(record: AvailabilityRecord): boolean {
  return isOfficeBooking(record)
}

function matchesIdOrName(value: unknown, id: string, name: string): boolean {
  const normalized = normalizeAvailabilityName(value)
  return normalized !== "" && (normalized === normalizeAvailabilityName(id) || normalized === normalizeAvailabilityName(name))
}

function getRoomNumber(value: unknown): number | null {
  const match = asString(value).match(/\broom\s+(\d+)\b/i)
  return match ? Number(match[1]) : null
}

/** Matches a booking to one exact resource without fuzzy display-name joins. */
export function bookingMatchesAvailabilitySpace(record: AvailabilityRecord, space: AvailabilitySpace): boolean {
  if (space.category === "venue") {
    if (isOfficeBooking(record)) return false
    const selectedId = space.spaceId || space.venueId
    const recordSpaceId = asString(record.spaceId)
    if (recordSpaceId) {
      return normalizeAvailabilityName(recordSpaceId) === normalizeAvailabilityName(selectedId)
        || normalizeAvailabilityName(recordSpaceId) === normalizeAvailabilityName(space.name)
    }
    const recordOfficeId = asString(record.officeId)
    if (recordOfficeId) return false
    const recordVenueId = asString(record.venueId)
    if (recordVenueId) {
      return matchesIdOrName(recordVenueId, selectedId, space.name)
    }
    return [record.venue, record.spaceName].some((value) => normalizeAvailabilityName(value) === normalizeAvailabilityName(space.name))
  }

  if (!isOfficeBooking(record)) return false
  const officeId = space.officeId || space.venueId
  const selectedSpaceId = space.spaceId || ""
  const officeReference = firstValue(record.officeId, record.venueId)
  if (officeReference !== undefined && officeReference !== null && asString(officeReference)) {
    if (!matchesIdOrName(officeReference, officeId, space.name)) {
      // A legacy record may have put the full room label in venueId.
      if (normalizeAvailabilityName(officeReference) !== normalizeAvailabilityName(`${space.name} - ${space.roomName || ""}`)) return false
    }
  }

  const recordSpaceId = asString(record.spaceId)
  if (recordSpaceId) {
    if (selectedSpaceId && normalizeAvailabilityName(recordSpaceId) === normalizeAvailabilityName(selectedSpaceId)) return true
    if (normalizeAvailabilityName(recordSpaceId) === normalizeAvailabilityName(officeId)) return true
    if (normalizeAvailabilityName(recordSpaceId) === normalizeAvailabilityName(space.name)) return true
    return false
  }

  if (!selectedSpaceId && !space.roomName) return true
  const selectedRoomNumber = getRoomNumber(space.roomName)
  const recordRoomNumber = getRoomNumber(firstValue(record.venue, record.spaceName, record.roomName))
  if (recordRoomNumber !== null && selectedRoomNumber !== null) return recordRoomNumber === selectedRoomNumber
  if (recordRoomNumber !== null && selectedRoomNumber === null) return false
  if (recordRoomNumber === null && selectedRoomNumber !== null && officeReference) return true

  const selectedFullName = normalizeAvailabilityName(`${space.name} - ${space.roomName || ""}`)
  const legacyNames = [record.venue, record.spaceName].map(normalizeAvailabilityName).filter(Boolean)
  if (legacyNames.includes(selectedFullName)) return true
  if (legacyNames.includes(normalizeAvailabilityName(space.name))) return true

  // A room-less office booking reserves the entire identified office, but an
  // unscoped "Room 1" legacy record is deliberately not merged into every
  // office because its building cannot be determined safely.
  return false
}

export function bookingCoversAvailabilityDate(record: AvailabilityRecord, date: string): boolean {
  const start = asString(firstValue(record.startDate, record.date))
  const end = asString(firstValue(record.endDate, start))
  return Boolean(start && end && start <= date && date <= end)
}

export function maintenanceMatchesAvailabilitySpace(record: AvailabilityRecord, space: AvailabilitySpace): boolean {
  const recordType = normalizeAvailabilityName(record.type)
  if (recordType && recordType !== space.category) return false

  const selectedResourceId = space.spaceId || space.venueId
  const recordSpaceId = asString(record.spaceId)
  if (recordSpaceId) {
    if (normalizeAvailabilityName(recordSpaceId) === normalizeAvailabilityName(selectedResourceId)) return true
    if (space.category === "office" && normalizeAvailabilityName(recordSpaceId) === normalizeAvailabilityName(space.officeId || space.venueId)) return true
    if (normalizeAvailabilityName(recordSpaceId) === normalizeAvailabilityName(space.name)) return true
    return false
  }

  const names = [record.spaceName, record.name].map(normalizeAvailabilityName).filter(Boolean)
  const selectedFullName = normalizeAvailabilityName(`${space.name} - ${space.roomName || ""}`)
  return names.includes(normalizeAvailabilityName(space.name)) || names.includes(selectedFullName)
}

export function maintenanceCoversAvailabilityDate(record: AvailabilityRecord, date: string): boolean {
  if (normalizeStatus(record.status) !== "active") return false
  return bookingCoversAvailabilityDate(record, date)
}

export function officeRentalMatchesAvailabilitySpace(record: OfficeRentalLike, space: AvailabilitySpace): boolean {
  const officeId = space.officeId || space.venueId
  const resourceId = firstValue(record.spaceId, record.officeSpaceId, record.officeId, record.venueId)
  if (resourceId) {
    const normalized = normalizeAvailabilityName(resourceId)
    if (normalized === normalizeAvailabilityName(officeId)) return true
    if (space.spaceId && normalized === normalizeAvailabilityName(space.spaceId)) return true
    return false
  }
  const names = [record.officeSpaceName, record.spaceName, record.venue].map(normalizeAvailabilityName).filter(Boolean)
  const selectedFullName = normalizeAvailabilityName(`${space.name} - ${space.roomName || ""}`)
  return names.includes(normalizeAvailabilityName(space.name)) || names.includes(selectedFullName)
}

export function officeRentalBlocksAvailability(record: OfficeRentalLike, date: string): boolean {
  const status = normalizeAvailabilityName(record.leaseStatus || record.status)
  if (TERMINAL_OFFICE_RENTAL_STATUSES.has(status)) return false
  const hasDate = Boolean(firstValue(record.startDate, record.date, record.endDate))
  return !hasDate || bookingCoversAvailabilityDate(record, date)
}

function getBlockingBookings(
  space: AvailabilitySpace,
  bookings: AvailabilityRecord[],
): AvailabilityRecord[] {
  return bookings.filter((booking) => (
    isAvailabilityBlockingBooking(booking) && bookingMatchesAvailabilitySpace(booking, space)
  ))
}

export function calculateAvailabilityForDate(
  space: AvailabilitySpace,
  date: string,
  bookings: AvailabilityRecord[],
  maintenanceRecords: AvailabilityRecord[] = [],
  officeRentals: OfficeRentalLike[] = [],
  scheduleConfig?: unknown,
): AvailabilityDay {
  const maintenanceBlocked = maintenanceRecords.some((record) => (
    maintenanceMatchesAvailabilitySpace(record, space)
      && maintenanceCoversAvailabilityDate(record, date)
  ))
  if (maintenanceBlocked) return { status: "maintenance", availableSlots: [] }

  const blockingBookings = getBlockingBookings(space, bookings)
  if (space.category === "office") {
    const bookingBlocked = blockingBookings.some((booking) => bookingCoversAvailabilityDate(booking, date))
    const rentalBlocked = officeRentals.some((rental) => (
      officeRentalMatchesAvailabilitySpace(rental, space) && officeRentalBlocksAvailability(rental, date)
    ))
    return {
      status: bookingBlocked || rentalBlocked ? "full" : "available",
      availableSlots: [],
    }
  }

  const dayBookings = blockingBookings.filter((booking) => bookingCoversAvailabilityDate(booking, date))
  const slots = getEventSlots(scheduleConfig)
  const availableSlots = slots.filter((slot) => (
    !dayBookings.some((booking) => {
      const interval = getAvailabilityTimeRange(booking)
      return hasAvailabilityTimeOverlap(
        slot.startMinutes,
        slot.endMinutes,
        interval?.startMinutes ?? null,
        interval?.endMinutes ?? null,
      )
    })
  ))

  return {
    status: dayBookings.length === 0
      ? "available"
      : availableSlots.length > 0
        ? "few"
        : "full",
    availableSlots,
  }
}

export function isValidEventSlot(
  startMinutes: number | null,
  endMinutes: number | null,
  scheduleConfig?: unknown,
): boolean {
  if (startMinutes === null || endMinutes === null) return false
  return getEventSlots(scheduleConfig).some((slot) => (
    slot.startMinutes === startMinutes && slot.endMinutes === endMinutes
  ))
}

export function isAvailabilitySlotOpen(
  space: AvailabilitySpace,
  date: string,
  startMinutes: number,
  endMinutes: number,
  bookings: AvailabilityRecord[],
  maintenanceRecords: AvailabilityRecord[] = [],
  scheduleConfig?: unknown,
): boolean {
  const result = calculateAvailabilityForDate(space, date, bookings, maintenanceRecords, [], scheduleConfig)
  if (space.category === "office") return result.status === "available"
  return result.availableSlots.some((slot) => (
    slot.startMinutes === startMinutes && slot.endMinutes === endMinutes
  ))
}

export function getAvailabilityDates(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return []
  const dates: string[] = []
  for (const current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(current.toISOString().slice(0, 10))
  }
  return dates
}

export function calculateAvailabilityRange(
  space: AvailabilitySpace,
  from: string,
  to: string,
  bookings: AvailabilityRecord[],
  maintenanceRecords: AvailabilityRecord[] = [],
  officeRentals: OfficeRentalLike[] = [],
  scheduleConfig?: unknown,
): Record<string, AvailabilityDay> {
  return Object.fromEntries(getAvailabilityDates(from, to).map((date) => [
    date,
    calculateAvailabilityForDate(space, date, bookings, maintenanceRecords, officeRentals, scheduleConfig),
  ]))
}

export function getAvailabilityRangeStatus(
  space: AvailabilitySpace,
  from: string,
  to: string,
  bookings: AvailabilityRecord[],
  maintenanceRecords: AvailabilityRecord[] = [],
  officeRentals: OfficeRentalLike[] = [],
): AvailabilityStatus {
  if (space.category !== "office") return "full"
  const availability = calculateAvailabilityRange(space, from, to, bookings, maintenanceRecords, officeRentals)
  const days = Object.values(availability)
  if (days.length === 0) return "full"
  if (days.some((day) => day.status === "maintenance")) return "maintenance"
  if (days.some((day) => day.status === "full")) return "full"
  return "available"
}

/** Office rentals reserve every date in their persisted start/end range. */
export function isAvailabilityRangeOpen(
  space: AvailabilitySpace,
  from: string,
  to: string,
  bookings: AvailabilityRecord[],
  maintenanceRecords: AvailabilityRecord[] = [],
  officeRentals: OfficeRentalLike[] = [],
): boolean {
  return getAvailabilityRangeStatus(space, from, to, bookings, maintenanceRecords, officeRentals) === "available"
}
