export function normalizeStatus(value: unknown): string {
  return String(value || "").toLowerCase().trim()
}

export type BookingLifecycleStatus = "pending" | "confirmed" | "cancelled" | "completed"

export type BookingScheduleClassification =
  | "upcoming"
  | "active"
  | "completed"
  | "cancelled"
  | "rejected"
  | "legacy"

export type BookingScheduleInput = {
  status?: unknown
  bookingStatus?: unknown
  date?: unknown
  bookingDate?: unknown
  eventDate?: unknown
  startDate?: unknown
  endDate?: unknown
  startTime?: unknown
  endTime?: unknown
  time?: unknown
  createdAt?: unknown
}

export type BookingScheduleRange = {
  start: Date
  end: Date
  startTimestamp: number
  endTimestamp: number
}

const BOOKING_TIME_ZONE = "Asia/Manila"

type ManilaDateParts = {
  year: number
  month: number
  day: number
  hour?: number
  minute?: number
  second?: number
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null
  }

  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    try {
      return asDate(value.toDate())
    } catch {
      return null
    }
  }

  if (typeof value === "number") {
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }

  if (typeof value !== "string" || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function getManilaDateParts(value: Date): ManilaDateParts | null {
  if (!Number.isFinite(value.getTime())) return null

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(value)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const result = {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  }
  return Object.values(result).every(Number.isFinite) ? result : null
}

function parseCalendarValue(value: unknown): ManilaDateParts | null {
  const text = typeof value === "string" ? value.trim() : ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number)
    const candidate = new Date(Date.UTC(year, month - 1, day))
    if (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    ) {
      return { year, month, day }
    }
    return null
  }

  const parsed = asDate(value)
  return parsed ? getManilaDateParts(parsed) : null
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string") return null
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([ap]m))?$/i)
  if (!match) return null

  let hour = Number(match[1])
  const minute = Number(match[2])
  const meridiem = match[3]?.toLowerCase()
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null
  if (meridiem) {
    if (hour < 1 || hour > 12) return null
    if (meridiem === "am" && hour === 12) hour = 0
    if (meridiem === "pm" && hour !== 12) hour += 12
  }
  if (hour > 23) return null
  return hour * 60 + minute
}

function getEmbeddedTime(value: unknown): number | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null
  const parsed = asDate(value)
  const parts = parsed ? getManilaDateParts(parsed) : null
  if (!parts || parts.hour === undefined || parts.minute === undefined) return null
  return parts.hour * 60 + parts.minute
}

function getTimes(booking: BookingScheduleInput): { start: number | null; end: number | null } {
  const timeMatches = typeof booking.time === "string"
    ? booking.time.match(/\d{1,2}:\d{2}(?:\s*[ap]m)?/gi) || []
    : []
  return {
    start: parseTime(booking.startTime) ?? parseTime(timeMatches[0]),
    end: parseTime(booking.endTime) ?? parseTime(timeMatches[1]),
  }
}

function comparableDate(parts: ManilaDateParts, minutes: number, endOfDay = false): Date {
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(minutes / 60),
    minutes % 60,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  ))
}

function getScheduleStartValue(booking: BookingScheduleInput): unknown {
  return booking.date || booking.startDate || booking.eventDate || booking.bookingDate
}

function getScheduleEndValue(booking: BookingScheduleInput, startValue: unknown): unknown {
  return booking.endDate || startValue
}

/**
 * Parses booking dates as Manila calendar values. Date-only records are never
 * passed through the host machine's timezone, so a browser or test runner in a
 * different timezone cannot move a booking across a day boundary.
 */
export function getBookingScheduleRange(
  booking: BookingScheduleInput,
): BookingScheduleRange | null {
  const startValue = getScheduleStartValue(booking)
  const endValue = getScheduleEndValue(booking, startValue)
  const startParts = parseCalendarValue(startValue)
  const endParts = parseCalendarValue(endValue)
  if (!startParts || !endParts) return null

  const times = getTimes(booking)
  const startMinutes = times.start ?? getEmbeddedTime(startValue) ?? 0
  const endMinutes = times.end ?? getEmbeddedTime(endValue)
  const start = comparableDate(startParts, startMinutes)
  const end = endMinutes === null || endMinutes === undefined
    ? comparableDate(endParts, 23 * 60 + 59, true)
    : comparableDate(endParts, endMinutes)

  if (end.getTime() < start.getTime()) return null
  return {
    start,
    end,
    startTimestamp: start.getTime(),
    endTimestamp: end.getTime(),
  }
}

function getBookingRawStatus(booking: BookingScheduleInput): string {
  return normalizeStatus(booking.status) || normalizeStatus(booking.bookingStatus)
}

/**
 * Returns a presentation-only schedule classification. It deliberately does
 * not mutate or replace the persisted lifecycle status: a confirmed future
 * booking remains confirmed, while its schedule classification is upcoming.
 */
export function getBookingScheduleClassification(
  booking: BookingScheduleInput,
  now = new Date(),
): BookingScheduleClassification {
  const rawStatus = getBookingRawStatus(booking).replace(/[\s-]+/g, "_")
  if (["rejected", "declined", "denied", "booking_rejected", "request_rejected"].includes(rawStatus)) {
    return "rejected"
  }
  if (["cancelled", "canceled", "expired"].includes(rawStatus)) return "cancelled"
  if (rawStatus === "rental_expired" || getBookingLifecycleStatus(booking as Record<string, unknown>) === "completed") {
    return "completed"
  }

  const range = getBookingScheduleRange(booking)
  const nowParts = getManilaDateParts(now)
  if (!range || !nowParts) return "legacy"
  const comparableNow = comparableDate(
    nowParts,
    (nowParts.hour || 0) * 60 + (nowParts.minute || 0),
  ).getTime() + (nowParts.second || 0) * 1000
  const lifecycle = getBookingLifecycleStatus(booking as Record<string, unknown>)

  if (comparableNow < range.startTimestamp) return "upcoming"
  if (lifecycle === "pending") return "legacy"
  if (comparableNow <= range.endTimestamp) return "active"
  return "completed"
}

export function getBookingScheduleClassificationLabel(
  classification: BookingScheduleClassification,
): string {
  if (classification === "upcoming") return "Upcoming"
  if (classification === "active") return "Active now"
  if (classification === "completed") return "Completed"
  if (classification === "cancelled") return "Cancelled"
  if (classification === "rejected") return "Rejected"
  return "Schedule unavailable"
}

/** Formats reservation calendar dates in the application's Manila timezone. */
export function formatBookingDate(value: unknown, month: "long" | "short" = "long"): string {
  if (value === null || value === undefined || value === "") return ""
  const text = String(value).trim()
  let date: Date | null = null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parts = parseCalendarValue(text)
    date = parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : null
  } else {
    date = asDate(value)
  }
  if (!date) return text
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: BOOKING_TIME_ZONE,
    month,
    day: "2-digit",
    year: "numeric",
  }).format(date)
}

/** Formats booking/payment timestamps in Manila time for user-facing detail views. */
export function formatBookingDateTime(value: unknown, month: "long" | "short" = "short"): string {
  if (value === null || value === undefined || value === "") return ""
  const text = String(value).trim()
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? (() => {
        const parts = parseCalendarValue(text)
        return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : null
      })()
    : asDate(value)
  if (!date) return text
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: BOOKING_TIME_ZONE,
    month,
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date)
}

export function isBookingCurrentOrUpcoming(
  booking: BookingScheduleInput,
  now = new Date(),
): boolean {
  const classification = getBookingScheduleClassification(booking, now)
  return classification === "active" || classification === "upcoming"
}

export function isBookingHistory(
  booking: BookingScheduleInput,
  now = new Date(),
): boolean {
  return ["completed", "cancelled", "rejected", "legacy"].includes(
    getBookingScheduleClassification(booking, now),
  )
}

/**
 * Maps legacy and workflow-specific values to the four user-facing booking
 * lifecycle states. Payment and request states belong in their own fields.
 */
export function normalizeBookingLifecycleStatus(value: unknown): BookingLifecycleStatus {
  const status = normalizeStatus(value).replace(/[\s-]+/g, "_")

  if (status === "completed" || status === "complete" || status === "rental_expired") return "completed"
  if (["cancelled", "canceled", "declined", "expired"].includes(status)) return "cancelled"
  if ([
    "confirmed",
    "reservation_secured",
    "slot_secured",
    "slot_verified",
    "active_rental",
    "contract_signing_required",
    "fully_paid",
  ].includes(status)) return "confirmed"
  return "pending"
}

export function getBookingLifecycleStatus(
  booking: Record<string, unknown>,
): BookingLifecycleStatus {
  const rawStatus = normalizeStatus(booking.status).replace(/[\s-]+/g, "_")
  if (rawStatus === "cancellation_requested" || rawStatus === "cancellation_under_review") {
    return normalizeBookingLifecycleStatus(
      booking.previousStatus || booking.modificationPreviousStatus ||
        (booking.isSlotSecured === true ? "confirmed" : "pending"),
    )
  }
  if (rawStatus === "modification_under_review") {
    return normalizeBookingLifecycleStatus(
      booking.modificationPreviousStatus ||
        (booking.isSlotSecured === true ? "confirmed" : "pending"),
    )
  }
  if (rawStatus) return normalizeBookingLifecycleStatus(rawStatus)
  return normalizeBookingLifecycleStatus(booking.bookingStatus)
}

export function getBookingLifecycleLabel(booking: Record<string, unknown>): string {
  const status = getBookingLifecycleStatus(booking)
  if (status === "confirmed") return "Confirmed"
  if (status === "cancelled") return "Cancelled"
  if (status === "completed") return "Completed"
  return "Pending"
}

export function getAmount(value: unknown): number {
  if (typeof value === "number") return value
  const cleaned = String(value || "0").replace(/[^0-9.-]+/g, "")
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : 0
}

export function getTotalAmount(booking: Record<string, unknown>): number {
  return getAmount(booking.totalAmount || booking.totalPrice || booking.amount || booking.price)
}

export function getAmountPaid(booking: Record<string, unknown>): number {
  const amountPaid = getAmount(booking.amountPaid)
  if (amountPaid > 0) return amountPaid
  const paidAmount = getAmount(booking.paidAmount)
  if (paidAmount > 0) return paidAmount

  const paymentStatus = normalizeStatus(booking.paymentStatus)
  if (
    [
      "verified",
      "paid",
      "completed",
      "fully paid",
      "fully_paid",
      "partial",
      "slot_verified",
      "reservation secured",
      "reservation_secured",
    ].includes(paymentStatus)
  ) {
    return getAmount(booking.paymentAmount)
  }

  return 0
}

export function getRemainingBalance(booking: Record<string, unknown>): number {
  return Math.max(getTotalAmount(booking) - getAmountPaid(booking), 0)
}

export function isFullyPaid(booking: Record<string, unknown>): boolean {
  const amountPaid = getAmountPaid(booking)
  const total = getTotalAmount(booking)
  const remaining = getRemainingBalance(booking)
  return total > 0 && amountPaid >= total && remaining === 0
}

export function hasActivePaymentSubmission(booking: Record<string, unknown>): boolean {
  const normalizedStatus = normalizeStatus(booking.paymentStatus || booking.status)
  return (
    booking.hasActivePaymentSubmission === true ||
    normalizedStatus === "for_review" ||
    normalizedStatus === "for review" ||
    normalizedStatus === "pending_verification" ||
    normalizedStatus === "pending verification"
  )
}

export function hasPaymentProof(booking: Record<string, unknown>): boolean {
  return Boolean(
    booking.proofUrl ||
      booking.paymentProof ||
      booking.proofOfPayment ||
      booking.paymentReference ||
      booking.referenceNumber ||
      booking.proofImage ||
      booking.receiptImage
  )
}

export function hasActiveCancellationRequest(booking: Record<string, unknown>): boolean {
  const cancellationStatus = normalizeStatus(booking.cancellationStatus)
  return Boolean(
    booking.cancellationRequested === true ||
      normalizeStatus(booking.status) === "cancellation_requested" ||
      ["pending", "under review", "requested"].includes(cancellationStatus) ||
      normalizeStatus(booking.cancelRequestStatus) === "pending",
  )
}

export function hasActiveModificationRequest(booking: Record<string, unknown>): boolean {
  const bookingStatus = normalizeStatus(booking.bookingStatus)
  const status = normalizeStatus(booking.status)
  const modificationStatus = normalizeStatus(booking.modificationStatus)
  const modifyRequestStatus = normalizeStatus(booking.modifyRequestStatus)
  const canonicalReviewStatus =
    status === "modification_under_review" ||
    status === "modification under review" ||
    bookingStatus === "modification_under_review" ||
    bookingStatus === "modification under review"

  if (canonicalReviewStatus) return true

  // `status`/`bookingStatus` are the canonical lifecycle fields. If either
  // field is present and has already left review, older request aliases are
  // stale and must not keep a resolved booking locked.
  if (status || bookingStatus) return false

  // These fields were introduced at different points in the modification
  // flow. Treat all active representations as blocking a second request,
  // while an explicit admin decision makes stale legacy flags harmless.
  if (["approved", "declined"].includes(modificationStatus)) return false

  return (
    modificationStatus === "under review" ||
    modificationStatus === "modification_under_review" ||
    booking.modificationRequested === true ||
    booking.modificationUnderReview === true ||
    modifyRequestStatus === "pending" ||
    modifyRequestStatus === "under review" ||
    modifyRequestStatus === "modification under review"
  )
}

export function isForVerificationStatus(booking: Record<string, unknown>): boolean {
  const normStatus = normalizeStatus(booking.status)
  const paymentStatus = normalizeStatus(booking.paymentStatus)
  if (normStatus === "verifying") return true
  return ["for_review", "cash_pending", "slot_pending", "pending_verification", "pending verification", "for verification"].includes(paymentStatus)
}

export function isPencilBooking(booking: Record<string, unknown>): boolean {
  const normStatus = normalizeStatus(booking.status)
  const paymentStatus = normalizeStatus(booking.paymentStatus)
  return normStatus === "pending" && !["for_review", "cash_pending", "slot_pending", "pending_verification", "pending verification", "for verification"].includes(paymentStatus)
}

export function isApprovedOrConfirmed(booking: Record<string, unknown>): boolean {
  const normStatus = normalizeStatus(booking.status)
  return ["confirmed", "reservation_secured"].includes(normStatus)
}

export function canRecordOnsitePayment(booking: Record<string, unknown>): boolean {
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  if (isForVerificationStatus(booking)) return false
  if (isFullyPaid(booking)) return false
  if (hasActivePaymentSubmission(booking)) return false
  if (hasPaymentProof(booking)) return false
  return getRemainingBalance(booking) > 0
}

export function canSendBalanceReminder(booking: Record<string, unknown>): boolean {
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  if (!isApprovedOrConfirmed(booking)) return false
  return getRemainingBalance(booking) > 0
}

export function canMarkContractSigned(booking: Record<string, unknown>): boolean {
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  if (normalizeStatus(booking.contractStatus) === "signed" || booking.contractSigned === true) return false
  const normStatus = normalizeStatus(booking.status)
  return ["confirmed", "reservation_secured"].includes(normStatus) || isFullyPaid(booking)
}

export function isEventFinished(booking: Record<string, unknown>): boolean {
  const dateStr = booking.date as string | undefined
  const endDateStr = (booking.endDate as string | undefined) || dateStr
  const endTimeStr = booking.endTime as string | undefined
  if (!endDateStr && !dateStr) return false
  const targetDate = endDateStr || dateStr
  try {
    const dateObj = new Date(targetDate + "T23:59:59")
    if (!isNaN(dateObj.getTime())) {
      if (endTimeStr) {
        const [hours, minutes] = String(endTimeStr).split(":").map(Number)
        if (!isNaN(hours)) dateObj.setHours(hours, minutes || 0, 0, 0)
      }
      return dateObj.getTime() < Date.now()
    }
  } catch {}
  return false
}

export function canMarkAsCompleted(booking: Record<string, unknown>): boolean {
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  return isFullyPaid(booking)
}

export function isMarkCompletedEnabled(booking: Record<string, unknown>): boolean {
  return canMarkAsCompleted(booking) && isEventFinished(booking)
}

export function canShowPayNow(booking: Record<string, unknown>): boolean {
  if (hasActiveCancellationRequest(booking)) return false
  if (hasActiveModificationRequest(booking)) return false
  if (hasActivePaymentSubmission(booking)) return false
  if (hasPaymentProof(booking)) return false
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  const paymentStatus = normalizeStatus(booking.paymentStatus)
  if (["verified", "paid", "slot_verified"].includes(paymentStatus)) return false
  return true
}

export function isCompleted(booking: Record<string, unknown>): boolean {
  return normalizeStatus(booking.status) === "completed"
}

export function isCancelled(booking: Record<string, unknown>): boolean {
  return normalizeStatus(booking.status) === "cancelled"
}

export function isCancellationRequested(booking: Record<string, unknown>): boolean {
  return hasActiveCancellationRequest(booking)
}

export function isModificationUnderReview(booking: Record<string, unknown>): boolean {
  return hasActiveModificationRequest(booking)
}

export const AVAILABILITY_BLOCKING_BOOKING_STATUSES = [
  "pending",
  "pending_verification",
  "verifying",
  "approved",
  "confirmed",
  "slot_secured",
  "contract_signing_required",
  "reservation_secured",
  "active_rental",
  "modification_under_review",
  "cancellation_requested",
  "cancellation_under_review",
]

const AVAILABILITY_TERMINAL_BOOKING_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "declined",
  "expired",
  "rental_expired",
])

function normalizeAvailabilityLifecycleStatus(value: unknown): string {
  return normalizeStatus(value).replace(/[\s-]+/g, "_")
}

export function isTerminalAvailabilityBooking(booking: Record<string, unknown>): boolean {
  const status = normalizeAvailabilityLifecycleStatus(booking.status)
  if (AVAILABILITY_TERMINAL_BOOKING_STATUSES.has(status)) return true
  if (AVAILABILITY_BLOCKING_BOOKING_STATUSES.includes(status)) return false
  return AVAILABILITY_TERMINAL_BOOKING_STATUSES.has(normalizeAvailabilityLifecycleStatus(booking.bookingStatus))
}

/**
 * These are the lifecycle states that reserve a space. In particular, a
 * confirmed booking remains blocking while a later payment or modification
 * request is being reviewed.
 */
export function isAvailabilityBlockingBooking(booking: Record<string, unknown>): boolean {
  const status = normalizeAvailabilityLifecycleStatus(booking.status)
  const bookingStatus = normalizeAvailabilityLifecycleStatus(booking.bookingStatus)

  if (AVAILABILITY_TERMINAL_BOOKING_STATUSES.has(status)) return false
  if (AVAILABILITY_BLOCKING_BOOKING_STATUSES.includes(status as typeof AVAILABILITY_BLOCKING_BOOKING_STATUSES[number])) {
    return true
  }
  if (AVAILABILITY_TERMINAL_BOOKING_STATUSES.has(bookingStatus)) return false
  if (AVAILABILITY_BLOCKING_BOOKING_STATUSES.includes(bookingStatus as typeof AVAILABILITY_BLOCKING_BOOKING_STATUSES[number])) {
    return true
  }

  // Some older records did not retain a canonical lifecycle status after a
  // verified payment. Keep those reservations blocked unless they are known
  // terminal records.
  return isFullyPaid(booking)
}

export function isActiveBooking(booking: {
  status?: unknown
  bookingStatus?: unknown
  date?: unknown
  bookingDate?: unknown
  eventDate?: unknown
  startDate?: unknown
  endDate?: unknown
  startTime?: unknown
  endTime?: unknown
  time?: unknown
}, now = new Date()): boolean {
  return getBookingScheduleClassification(booking, now) === "active"
}

export function getCurrentBooking<T extends {
  status?: unknown
  bookingStatus?: unknown
  createdAt?: unknown
  date?: unknown
  bookingDate?: unknown
  eventDate?: unknown
  startDate?: unknown
  endDate?: unknown
  startTime?: unknown
  endTime?: unknown
  time?: unknown
}>(bookings: T[], now = new Date()): T | null {
  const sorted = [...bookings].sort(
    (a, b) =>
      getTimestamp(b.createdAt) - getTimestamp(a.createdAt),
  )
  const active = sorted.filter((booking) => isActiveBooking(booking, now))
  return active.length > 0 ? active[0] : null
}

function getTimestamp(value: unknown): number {
  const parsed = asDate(value)
  return parsed ? parsed.getTime() : 0
}

/** Selects the active booking, or the soonest scheduled booking when none is active. */
export function getNextBooking<T extends {
  status?: unknown
  bookingStatus?: unknown
  createdAt?: unknown
  date?: unknown
  bookingDate?: unknown
  eventDate?: unknown
  startDate?: unknown
  endDate?: unknown
  startTime?: unknown
  endTime?: unknown
  time?: unknown
}>(bookings: T[], now = new Date()): T | null {
  const current = getCurrentBooking(bookings, now)
  if (current) return current

  return bookings
    .filter((booking) => getBookingScheduleClassification(booking, now) === "upcoming")
    .sort((a, b) => {
      const aRange = getBookingScheduleRange(a)?.startTimestamp ?? Number.POSITIVE_INFINITY
      const bRange = getBookingScheduleRange(b)?.startTimestamp ?? Number.POSITIVE_INFINITY
      if (aRange !== bRange) return aRange - bRange
      return getTimestamp(b.createdAt) - getTimestamp(a.createdAt)
    })[0] || null
}
