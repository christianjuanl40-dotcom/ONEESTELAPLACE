import { hasActiveCancellationRequest, isAvailabilityBlockingBooking, isTerminalAvailabilityBooking, normalizeStatus } from "./booking-helpers"
import { ambiguousResourceAffectsSpace, catalogForAvailabilitySpace, isOfficeResourceBooking, resolveResourceSpace, resourceSpacesOverlap, unresolvedResourceAffectsSpace } from "./resource-identity"

export type AvailabilityCategory = "venue" | "office"
export type AvailabilityStatus = "available" | "few" | "full" | "maintenance"
export type OfficeAvailabilityTerm = "6_months" | "1_year" | "2_years"
export type OfficeRoomStatus = "available" | "reserved" | "occupied" | "maintenance" | "unavailable"
export const MAX_OFFICE_SEARCH_DAYS = 1096

/** Same Manila calendar-month notice used by the form, search, and booking API.
 * Keep the existing month-rollover convention for the minimum notice. */
export function getMinimumBookingDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = new Date(`${values.year}-${values.month}-${values.day}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return date.toISOString().slice(0, 10)
}

export function addAvailabilityDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export type AvailabilitySpace = {
  category: AvailabilityCategory
  venueId: string
  officeId?: string
  spaceId?: string
  name: string
  roomName?: string
  catalog?: Record<string, unknown>
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
  occupiedIntervals: AvailabilityInterval[]
}

export type AvailabilityInterval = Pick<AvailabilitySlot, "startMinutes" | "endMinutes" | "startTimeLabel" | "endTimeLabel">

export type EventSchedule = {
  openingMinutes: number
  closingMinutes: number
  bookingDurationMinutes: number
  slotIntervalMinutes: number
}

export type OfficeRentalLike = AvailabilityRecord

// Event policy is fixed across calendar, selectors, and server commits.
// Office rentals deliberately do not use this schedule or turnover rule.
export const EVENT_TURNOVER_MINUTES = 60
export const DEFAULT_EVENT_SCHEDULE: EventSchedule = {
  openingMinutes: 8 * 60,
  closingMinutes: 22 * 60,
  bookingDurationMinutes: 6 * 60,
  slotIntervalMinutes: 60,
}

const TERMINAL_OFFICE_RENTAL_STATUSES = new Set([
  "declined",
  "cancelled",
  "canceled",
  "completed",
  "expired",
  "rental_expired",
  "terminated",
])

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value || "").trim()
}

export function normalizeAvailabilityName(value: unknown): string {
  return asString(value).toLowerCase().replace(/\s+/g, " ")
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "")
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

export function getEventSchedule(_config?: unknown): EventSchedule {
  return { ...DEFAULT_EVENT_SCHEDULE }
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

export function hasEventTurnoverConflict(
  candidateStart: number | null,
  candidateEnd: number | null,
  existingStart: number | null,
  existingEnd: number | null,
): boolean {
  if (candidateStart === null || candidateEnd === null || existingStart === null || existingEnd === null) return true
  // Exactly one gap BETWEEN intervals. No buffer is added to closing hours.
  return !(candidateEnd + EVENT_TURNOVER_MINUTES <= existingStart
    || candidateStart >= existingEnd + EVENT_TURNOVER_MINUTES)
}

export function isOfficeAvailabilityBooking(record: AvailabilityRecord): boolean {
  return isOfficeResourceBooking(record)
}

/** Matches a booking to one exact resource without fuzzy display-name joins. */
export function bookingMatchesAvailabilitySpace(record: AvailabilityRecord, space: AvailabilitySpace): boolean {
  const resolved = resolveResourceSpace(catalogForAvailabilitySpace(space), record)
  return resolved.status === "resolved" && resourceSpacesOverlap(resolved.space, space)
}

export function bookingCoversAvailabilityDate(record: AvailabilityRecord, date: string): boolean {
  const { start, end } = getAvailabilityDateBounds(record)
  return Boolean(start && end && start <= date && date <= end)
}

export function getAvailabilityDateBounds(record: AvailabilityRecord): { start: string; end: string } {
  const start = asString(firstValue(record.date, record.startDate))
  const term = asString(firstValue(record.officeRentalTerm, record.rentalTerm, record.contractTerm))
  const officeTerm = (isOfficeResourceBooking(record) || Boolean(record.officeRentalTerm))
    && ["6_months", "1_year", "2_years"].includes(term)
  const end = asString(firstValue(record.endDate)) || (start && officeTerm ? getOfficeRentalEndDate(start, term) : start)
  return { start, end }
}

export function maintenanceMatchesAvailabilitySpace(record: AvailabilityRecord, space: AvailabilitySpace): boolean {
  const resolved = resolveResourceSpace(catalogForAvailabilitySpace(space), record, "maintenance")
  return resolved.status === "resolved" && resourceSpacesOverlap(resolved.space, space)
}

export function maintenanceCoversAvailabilityDate(record: AvailabilityRecord, date: string): boolean {
  if (normalizeStatus(record.status) !== "active") return false
  return bookingCoversAvailabilityDate(record, date)
}

export function officeRentalMatchesAvailabilitySpace(record: OfficeRentalLike, space: AvailabilitySpace): boolean {
  if (space.category !== "office") return false
  const resolved = resolveResourceSpace(catalogForAvailabilitySpace(space), record, "rental")
  return resolved.status === "resolved" && resourceSpacesOverlap(resolved.space, space)
}

export function officeRentalBlocksAvailability(record: OfficeRentalLike, _date: string): boolean {
  // A lease end date is a plan, not evidence of checkout/completion.
  return isAvailabilityBlockingOfficeRental(record)
}

export function isAvailabilityBlockingOfficeRental(record: OfficeRentalLike): boolean {
  return !TERMINAL_OFFICE_RENTAL_STATUSES.has(normalizeAvailabilityName(record.leaseStatus || record.status).replace(/[\s-]+/g, "_"))
}

const OCCUPIED_OFFICE_STATUSES = new Set(["active", "occupied", "active_rental", "active_lease"])
const officeStatus = (record: AvailabilityRecord) => normalizeStatus(record.leaseStatus || record.status || record.bookingStatus).replace(/[\s-]+/g, "_")

/** Office-only legacy states/secured flags; event lifecycle rules stay unchanged. */
export function isAvailabilityBlockingOfficeBooking(record: AvailabilityRecord): boolean {
  if (OCCUPIED_OFFICE_STATUSES.has(normalizeStatus(record.status || record.bookingStatus).replace(/[\s-]+/g, "_"))) return true
  if (isTerminalAvailabilityBooking(record)) return false
  return isAvailabilityBlockingBooking(record)
    || hasActiveCancellationRequest(record) || record.isSlotSecured === true || record.verifiedByAdmin === true
}

/** Sanitized room-card state. Inputs must have ledger-checked hold expiry applied. */
export function getOfficeRoomStatus(space: AvailabilitySpace, today: string, bookings: AvailabilityRecord[],
  maintenanceRecords: AvailabilityRecord[] = [], officeRentals: OfficeRentalLike[] = []): OfficeRoomStatus {
  const catalog = catalogForAvailabilitySpace(space)
  const needsReview = (record: AvailabilityRecord, kind: "booking" | "maintenance" | "rental") =>
    ambiguousResourceAffectsSpace(catalog, record, space, kind) || unresolvedResourceAffectsSpace(catalog, record, space, kind)
  if (bookings.some((record) => isAvailabilityBlockingOfficeBooking(record) && needsReview(record, "booking"))
    || officeRentals.some((record) => isAvailabilityBlockingOfficeRental(record) && needsReview(record, "rental"))
    || maintenanceRecords.some((record) => maintenanceCoversAvailabilityDate(record, today) && needsReview(record, "maintenance"))) return "unavailable"
  const reservations = bookings.filter((record) => isAvailabilityBlockingOfficeBooking(record) && bookingMatchesAvailabilitySpace(record, space))
  const rentals = officeRentals.filter((record) => isAvailabilityBlockingOfficeRental(record) && officeRentalMatchesAvailabilitySpace(record, space))
  if ([...reservations, ...rentals].some((record) => OCCUPIED_OFFICE_STATUSES.has(officeStatus(record)))) return "occupied"
  if (reservations.length || rentals.length) return "reserved"
  if (maintenanceRecords.some((record) => maintenanceMatchesAvailabilitySpace(record, space)
    && maintenanceCoversAvailabilityDate(record, today))) return "maintenance"
  return "available"
}

function getBlockingBookings(
  space: AvailabilitySpace,
  bookings: AvailabilityRecord[],
): AvailabilityRecord[] {
  return bookings.filter((booking) => (
    (space.category === "office" ? isAvailabilityBlockingOfficeBooking(booking) : isAvailabilityBlockingBooking(booking))
      && bookingMatchesAvailabilitySpace(booking, space)
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
  if (maintenanceBlocked) return { status: "maintenance", availableSlots: [], occupiedIntervals: [] }

  const blockingBookings = getBlockingBookings(space, bookings)
  if (space.category === "office") {
    const bookingBlocked = blockingBookings.length > 0
    const rentalBlocked = officeRentals.some((rental) => (
      officeRentalMatchesAvailabilitySpace(rental, space) && officeRentalBlocksAvailability(rental, date)
    ))
    return {
      status: bookingBlocked || rentalBlocked ? "full" : "available",
      availableSlots: [],
      occupiedIntervals: [],
    }
  }

  const dayBookings = blockingBookings.filter((booking) => bookingCoversAvailabilityDate(booking, date))
  const occupiedIntervals = dayBookings.flatMap((booking) => {
    const interval = getAvailabilityTimeRange(booking)
    return interval ? [{ ...interval,
      startTimeLabel: formatAvailabilityTime(interval.startMinutes),
      endTimeLabel: formatAvailabilityTime(interval.endMinutes),
    }] : []
  }).sort((first, second) => first.startMinutes - second.startMinutes || first.endMinutes - second.endMinutes)
  const slots = getEventSlots(scheduleConfig)
  const availableSlots = slots.filter((slot) => (
    !dayBookings.some((booking) => {
      const interval = getAvailabilityTimeRange(booking)
      return hasEventTurnoverConflict(
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
    occupiedIntervals,
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
  rentalTerm?: OfficeAvailabilityTerm,
): Record<string, AvailabilityDay> {
  if (space.category === "office" && rentalTerm) {
    const blocks = getOfficeAvailabilityBlocks(space, bookings, maintenanceRecords, officeRentals)
    return Object.fromEntries(getAvailabilityDates(from, to).map((date) => [date, {
      status: officeRangeStatus(date, getOfficeRentalEndDate(date, rentalTerm), blocks),
      availableSlots: [], occupiedIntervals: [],
    }]))
  }
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
  if (!from || !to || from > to) return "full"
  return officeRangeStatus(from, to, getOfficeAvailabilityBlocks(space, bookings, maintenanceRecords, officeRentals))
}

type OfficeBlock = { start: string; end: string; status: "full" | "maintenance" }

function getOfficeAvailabilityBlocks(space: AvailabilitySpace, bookings: AvailabilityRecord[],
  maintenanceRecords: AvailabilityRecord[], officeRentals: OfficeRentalLike[]): OfficeBlock[] {
  const blocks: OfficeBlock[] = []
  const add = (record: AvailabilityRecord, status: OfficeBlock["status"]) => {
    const { start, end } = getAvailabilityDateBounds(record)
    if (start && end) blocks.push({ start, end, status })
  }
  maintenanceRecords.forEach((record) => {
    if (normalizeStatus(record.status) === "active" && maintenanceMatchesAvailabilitySpace(record, space)) add(record, "maintenance")
  })
  bookings.forEach((record) => {
    if (isAvailabilityBlockingOfficeBooking(record) && bookingMatchesAvailabilitySpace(record, space)) {
      blocks.push({ start: "0000-01-01", end: "9999-12-31", status: "full" })
    }
  })
  officeRentals.forEach((record) => {
    if (isAvailabilityBlockingOfficeRental(record) && officeRentalMatchesAvailabilitySpace(record, space)) {
      blocks.push({ start: "0000-01-01", end: "9999-12-31", status: "full" })
    }
  })
  return blocks
}

function officeRangeStatus(from: string, to: string, blocks: OfficeBlock[]): AvailabilityStatus {
  if (!from || !to || from > to) return "full"
  const conflicts = blocks.filter((block) => block.start <= to && from <= block.end)
  return conflicts.some((block) => block.status === "maintenance") ? "maintenance" : conflicts.length ? "full" : "available"
}

/** Bounded start-date search, using the identical inclusive ranges as server
 * allocation and calendar days. Resolve IDs once, then jump past conflicts. */
export function findEarliestOfficeStartDate(space: AvailabilitySpace, from: string, to: string,
  term: OfficeAvailabilityTerm, bookings: AvailabilityRecord[], maintenanceRecords: AvailabilityRecord[] = [],
  officeRentals: OfficeRentalLike[] = []): string | null {
  if (space.category !== "office" || !getOfficeRentalEndDate(from, term) || !getOfficeRentalEndDate(to, term)
    || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 >= MAX_OFFICE_SEARCH_DAYS) return null
  const blocks = getOfficeAvailabilityBlocks(space, bookings, maintenanceRecords, officeRentals)
  let candidate = from
  while (candidate <= to) {
    const end = getOfficeRentalEndDate(candidate, term)
    const conflicts = blocks.filter((block) => block.start <= end && candidate <= block.end)
    if (!conflicts.length) return candidate
    const blockedThrough = conflicts.reduce((latest, block) => block.end > latest ? block.end : latest, candidate)
    if (blockedThrough >= to) return null
    candidate = addAvailabilityDays(blockedThrough, 1)
  }
  return null
}

export function getOfficeRentalEndDate(dateValue: string, term: string): string {
  if (!["6_months", "1_year", "2_years"].includes(term) || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return ""
  const months = term === "2_years" ? 24 : term === "1_year" ? 12 : 6
  const date = new Date(`${dateValue}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateValue) return ""
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date.toISOString().slice(0, 10)
}

/** Ongoing office reservations/leases are exclusive; maintenance remains date-bounded. */
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
