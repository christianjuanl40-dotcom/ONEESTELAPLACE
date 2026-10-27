import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { readResourceAvailabilityLock, commitEventAvailabilityLock } from "@/lib/event-availability-lock"
import { commitExpiredAvailabilityHolds, evaluateAvailabilityHolds, readResourceAvailability } from "@/lib/resource-availability"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
  requireBackofficeUser,
} from "@/lib/server-auth"
import {
  calculateAvailabilityForDate,
  getAvailabilityRangeStatus,
  getAvailabilityTimeRange,
  isValidEventSlot,
  getOfficeRentalEndDate,
  getAvailabilityDateBounds,
} from "@/src/modules/shared/lib/availability"
import { isOfficeResourceBooking, resolveResourceSpace } from "@/src/modules/shared/lib/resource-identity"
import { isTerminalAvailabilityBooking } from "@/src/modules/shared/lib/booking-helpers"
import { isCatalogPublished } from "@/src/modules/shared/lib/catalog-status"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

const BOOKING_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CHANGE_KEYS = new Set([
  "date",
  "eventName",
  "eventType",
  "guestCount",
  "specialRequests",
  "time",
  "startTime",
  "endTime",
  "companyName",
  "natureOfBusiness",
  "bookingType",
  "bookingCategory",
  "isOfficeRental",
  "rentalTerm",
  "contractTerm",
  "officeRentalTerm",
])

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null
}

function readString(body: DataRecord, key: string, maxLength: number, required = false): string {
  const value = body[key]
  if (typeof value !== "string") {
    if (required) throw new ApiAuthError(400, `A valid ${key} is required.`)
    return ""
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new ApiAuthError(400, `${key} is too long.`)
  if (required && !normalized) throw new ApiAuthError(400, `A valid ${key} is required.`)
  return normalized
}

const isOfficeBooking = isOfficeResourceBooking

function addMonths(dateValue: string, months: number): string {
  const date = new Date(`${dateValue}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

function getMinimumDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return addMonths(`${values.year}-${values.month}-${values.day}`, 1)
}

function appendLog(booking: DataRecord, action: string, message: string, createdAt: string) {
  const existing = Array.isArray(booking.adminLogs)
    ? booking.adminLogs.filter(isRecord).slice(-49)
    : []
  return [...existing, { action, message, createdAt }]
}

function normalizeChanges(value: unknown): DataRecord {
  if (!isRecord(value)) throw new ApiAuthError(400, "Invalid modification changes.")
  const changes: DataRecord = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!CHANGE_KEYS.has(key)) throw new ApiAuthError(400, `The modification field ${key} is not allowed.`)
    if (typeof entry === "string" && entry.length > 500) throw new ApiAuthError(400, `The modification field ${key} is too long.`)
    if (key === "guestCount") {
      const guests = typeof entry === "number" ? entry : Number(entry)
      if (!Number.isInteger(guests) || guests < 1 || guests > 1000) throw new ApiAuthError(400, "Invalid guest count.")
      changes[key] = guests
    } else if (key === "isOfficeRental") {
      if (typeof entry !== "boolean") throw new ApiAuthError(400, "Invalid office booking value.")
      changes[key] = entry
    } else {
      if (typeof entry !== "string") throw new ApiAuthError(400, `The modification field ${key} must be text.`)
      changes[key] = entry
    }
  }
  if (Object.keys(changes).length === 0) throw new ApiAuthError(400, "Please provide at least one change.")
  return changes
}

function buildCandidate(booking: DataRecord, changes: DataRecord): DataRecord {
  const candidate = { ...booking, ...changes }
  if (changes.date !== undefined && changes.date !== booking.date) {
    if (booking.startDate !== undefined) candidate.startDate = changes.date
    if (!isOfficeBooking(booking) && booking.endDate) candidate.endDate = changes.date
  }
  if (isOfficeBooking(candidate) !== isOfficeBooking(booking)) {
    throw new ApiAuthError(400, "A modification cannot change the booking's resource category.")
  }
  if (isOfficeBooking(booking)) {
    const previousTerm = booking.officeRentalTerm || booking.rentalTerm || booking.contractTerm || "6_months"
    const term = changes.officeRentalTerm || changes.rentalTerm || changes.contractTerm
      || previousTerm
    if (!["6_months", "1_year", "2_years"].includes(String(term))) throw new ApiAuthError(400, "Please choose a valid office rental term.")
    if ((changes.date !== undefined && changes.date !== booking.date) || term !== previousTerm) {
      candidate.officeRentalTerm = term
      candidate.rentalTerm = term
      candidate.contractTerm = term
      candidate.endDate = getOfficeRentalEndDate(validateDate(candidate.date, String(booking.date || "")), String(term))
    }
  } else if (["time", "startTime", "endTime"].some((key) => changes[key] !== undefined && changes[key] !== booking[key])) {
    // A legacy time-range-only request must not silently validate the old
    // startTime/endTime and then persist a different display interval.
    const interval = changes.time !== undefined && changes.startTime === undefined && changes.endTime === undefined
      ? getAvailabilityTimeRange({ time: changes.time })
      : getAvailabilityTimeRange(candidate)
    if (!interval) throw new ApiAuthError(400, "Please choose a valid event time.")
    candidate.startTime = `${String(Math.floor(interval.startMinutes / 60)).padStart(2, "0")}:${String(interval.startMinutes % 60).padStart(2, "0")}`
    candidate.endTime = `${String(Math.floor(interval.endMinutes / 60)).padStart(2, "0")}:${String(interval.endMinutes % 60).padStart(2, "0")}`
    candidate.time = `${candidate.startTime} - ${candidate.endTime}`
  }
  return candidate
}

function scheduleFields(candidate: DataRecord): DataRecord {
  const fields = isOfficeBooking(candidate)
    ? { officeRentalTerm: candidate.officeRentalTerm, rentalTerm: candidate.rentalTerm, contractTerm: candidate.contractTerm }
    : { startTime: candidate.startTime, endTime: candidate.endTime, time: candidate.time }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

function resourceFields(candidate: DataRecord): DataRecord {
  return { venueId: candidate.venueId, officeId: candidate.officeId, spaceId: candidate.spaceId,
    bookingCategory: candidate.bookingCategory, bookingType: candidate.bookingType, isOfficeRental: candidate.isOfficeRental,
    ...(candidate.startDate !== undefined ? { startDate: candidate.startDate } : {}) }
}

function hasScheduleChanges(changes: DataRecord, booking: DataRecord): boolean {
  return ["date", "time", "startTime", "endTime", "officeRentalTerm", "rentalTerm", "contractTerm"]
    .some((key) => changes[key] !== undefined && changes[key] !== booking[key])
}

function validateDate(value: unknown, allowPastValue: string): string {
  const date = String(value || "")
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!DATE_PATTERN.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ApiAuthError(400, "Please choose a valid booking date.")
  }
  if (date !== allowPastValue && date < getMinimumDate()) {
    throw new ApiAuthError(400, "Bookings must be scheduled at least one month in advance.")
  }
  return date
}

async function assertAvailable(
  transaction: FirebaseFirestore.Transaction,
  firestore: FirebaseFirestore.Firestore,
  bookingId: string,
  booking: DataRecord,
  candidate: DataRecord,
  schedulingChange: boolean,
) {
  const date = validateDate(candidate.date, String(booking.date || ""))
  const cmsSnapshot = await transaction.get(firestore.collection("cms").doc("data"))
  const catalog = cmsSnapshot.data() || {}
  const resolved = resolveResourceSpace(catalog, booking)
  if (resolved.status !== "resolved") {
    throw new ApiAuthError(409, `The booking resource is ${resolved.status}. An administrator must resolve its resource ID.`)
  }
  const space = resolved.space
  const office = space.category === "office"
  if (schedulingChange) {
    const items = catalog[office ? "offices" : "venues"]
    const item = Array.isArray(items) ? items.find((entry: DataRecord) => entry.id === space.venueId) : null
    const room = office && space.spaceId !== space.venueId && Array.isArray(item?.rooms)
      ? item.rooms.find((entry: DataRecord) => entry.id === space.spaceId) : null
    const unavailable = (entry: DataRecord | null) => !entry || entry.isArchived === true || !isCatalogPublished(entry) || entry.isHidden === true || entry.isBookable === false
    if (unavailable(item) || (office && space.spaceId !== space.venueId && unavailable(room))) {
      throw new ApiAuthError(409, "This resource is no longer bookable. Its existing reservation has not been changed.")
    }
  }
  const endDate = office ? getAvailabilityDateBounds(candidate).end : date
  const eventLock = await readResourceAvailabilityLock(transaction, firestore, space, date)
  const { bookings: existingBookings, maintenanceRecords, officeRentals, expiredBookings } = await readResourceAvailability(
    firestore, space, date, endDate, transaction, bookingId,
  )
  candidate.venueId = space.venueId
  candidate.officeId = space.officeId || ""
  candidate.spaceId = space.spaceId || space.venueId
  candidate.bookingCategory = space.category
  candidate.bookingType = space.category
  candidate.isOfficeRental = office

  if (office) {
    const rangeStatus = getAvailabilityRangeStatus(
      space,
      date,
      endDate,
      existingBookings,
      maintenanceRecords,
      officeRentals,
    )
    if (rangeStatus === "maintenance") {
      throw new ApiAuthError(409, "That office room is under maintenance during the selected rental term.")
    }
    if (rangeStatus !== "available") {
      throw new ApiAuthError(409, "That office room is already reserved during the selected rental term.")
    }
    return { ...eventLock, expiredBookings }
  }

  const availability = calculateAvailabilityForDate(
    space,
    date,
    existingBookings,
    maintenanceRecords,
    officeRentals,
  )
  if (availability.status === "maintenance") {
    throw new ApiAuthError(409, "That space is under maintenance on the selected date.")
  }
  const interval = getAvailabilityTimeRange(candidate)
  if (!interval || !isValidEventSlot(interval.startMinutes, interval.endMinutes)) {
    throw new ApiAuthError(409, "Please choose a valid event time.")
  }
  if (!availability.availableSlots.some((slot) => (
    slot.startMinutes === interval.startMinutes && slot.endMinutes === interval.endMinutes
  ))) {
    throw new ApiAuthError(409, "That space is already reserved for the selected time.")
  }
  return { ...eventLock, expiredBookings }
}

function restoredStatus(booking: DataRecord): { status: string; bookingStatus: string } {
  const previousStatus = String(booking.modificationPreviousStatus || booking.status || "pending")
  const previousLabel = String(booking.modificationPreviousBookingStatus || "")
  if (previousStatus !== "modification_under_review") {
    return {
      status: previousStatus,
      bookingStatus: previousLabel || (previousStatus === "confirmed" ? "Confirmed" : "Pending Verification"),
    }
  }
  if (booking.isSlotSecured === true || booking.verifiedByAdmin === true) {
    return { status: isOfficeBooking(booking) ? "reservation_secured" : "confirmed", bookingStatus: isOfficeBooking(booking) ? "Slot Secured" : "Confirmed" }
  }
  return { status: "pending", bookingStatus: "Pending" }
}

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(
    "[POST /api/bookings/modification]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to update the modification request. Please try again." }, { status: 500 })
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 64 * 1024) {
      throw new ApiAuthError(413, "The modification request is too large.")
    }
    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in modification request.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid modification request.")
    const bookingId = readString(body, "bookingId", 128, true)
    if (!BOOKING_ID_PATTERN.test(bookingId)) throw new ApiAuthError(400, "Invalid booking ID.")
    const action = readString(body, "action", 20, true).toLowerCase()
    if (!["request", "approve", "decline", "admin_update"].includes(action)) throw new ApiAuthError(400, "Invalid modification action.")
    if (action !== "request") await requireBackofficeUser(request, { permission: "bookings" })

    const reason = readString(body, "reason", 2000, action !== "approve")
    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)
    const now = new Date().toISOString()
    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(bookingRef)
      if (!snapshot.exists) throw new ApiAuthError(404, "Booking not found.")
      const booking: DataRecord = snapshot.data() as DataRecord
      if (action === "request" && String(booking.userId || booking.uid || "") !== user.uid) {
        throw new ApiAuthError(403, "You do not have access to this booking.")
      }
      if (action !== "decline" && isTerminalAvailabilityBooking(booking)) {
        throw new ApiAuthError(409, "This booking cannot be modified.")
      }
      if (action !== "decline") {
        const hold = await evaluateAvailabilityHolds(firestore, [{ ...booking, id: bookingId }], transaction)
        if (hold.expiredBookings.length) throw new ApiAuthError(409, "This unpaid reservation hold has expired. Create a new booking.")
      }

      if (action === "request") {
        if (String(booking.status || "").toLowerCase() === "modification_under_review" || booking.modificationRequested === true) {
          return { changed: false, booking: { ...booking, id: bookingId } }
        }
        const changes = normalizeChanges(body.changes)
        const candidate = buildCandidate(booking, changes)
        await assertAvailable(transaction, firestore, bookingId, booking, candidate, hasScheduleChanges(changes, booking))
        const fields: DataRecord = {
          modificationPreviousStatus: booking.status || "pending",
          modificationPreviousBookingStatus: booking.bookingStatus || "Pending Verification",
          status: "modification_under_review",
          bookingStatus: "Modification Under Review",
          modificationRequested: true,
          modificationUnderReview: true,
          modifyRequestStatus: "Pending",
          modificationStatus: "Under Review",
          modificationReason: reason,
          modificationRequestedAt: now,
          requestedChanges: { ...changes, ...scheduleFields(candidate) },
          originalBookingSnapshot: Object.fromEntries(["eventName", "eventType", "guestCount", "date", "startTime", "endTime", "time",
            "venue", "venueId", "officeId", "spaceId", "specialRequests"].filter((key) => booking[key] !== undefined).map((key) => [key, booking[key]])),
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(booking, "REQUEST_MODIFICATION", `Client requested modification. Reason: ${reason}.`, now),
        }
        transaction.update(bookingRef, fields as any)
        return { changed: true, booking: { ...booking, ...fields, id: bookingId }, userId: String(booking.userId || "") }
      }

      if (action === "admin_update") {
        const changes = normalizeChanges(body.changes)
        const candidate = buildCandidate(booking, changes)
        const eventLock = await assertAvailable(transaction, firestore, bookingId, booking, candidate, hasScheduleChanges(changes, booking))
        const fields: DataRecord = {
          ...changes,
          ...scheduleFields(candidate),
          ...resourceFields(candidate),
          ...(candidate.endDate ? { endDate: candidate.endDate } : {}),
          modifiedAt: now,
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(booking, "ADMIN_UPDATE_BOOKING", "Admin updated the booking details.", now),
        }
        commitEventAvailabilityLock(transaction, eventLock)
        commitExpiredAvailabilityHolds(transaction, firestore, eventLock.expiredBookings)
        transaction.update(bookingRef, fields as any)
        return { changed: true, booking: { ...booking, ...fields, id: bookingId }, userId: String(booking.userId || "") }
      }

      if (String(booking.status || "").toLowerCase() !== "modification_under_review" || !booking.requestedChanges) {
        throw new ApiAuthError(409, "This booking has no pending modification request.")
      }
      const changes = normalizeChanges(booking.requestedChanges)
      if (action === "approve") {
        const candidate = buildCandidate(booking, changes)
        const eventLock = await assertAvailable(transaction, firestore, bookingId, booking, candidate, hasScheduleChanges(changes, booking))
        const restored = restoredStatus(booking)
        const fields: DataRecord = {
          ...changes,
          ...scheduleFields(candidate),
          ...resourceFields(candidate),
          ...(candidate.endDate ? { endDate: candidate.endDate } : {}),
          status: restored.status,
          bookingStatus: restored.bookingStatus,
          modificationRequested: false,
          modificationUnderReview: false,
          modifyRequestStatus: "Approved",
          modificationStatus: "Approved",
          modificationReviewedAt: now,
          modificationPreviousStatus: null,
          modificationPreviousBookingStatus: null,
          requestedChanges: null,
          originalBookingSnapshot: null,
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(booking, "APPROVE_MODIFICATION", "Admin approved the requested booking changes.", now),
        }
        commitEventAvailabilityLock(transaction, eventLock)
        commitExpiredAvailabilityHolds(transaction, firestore, eventLock.expiredBookings)
        transaction.update(bookingRef, fields as any)
        return { changed: true, booking: { ...booking, ...fields, id: bookingId }, userId: String(booking.userId || "") }
      }

      const fields: DataRecord = {
        ...restoredStatus(booking),
        modificationRequested: false,
        modificationUnderReview: false,
        modifyRequestStatus: "Declined",
        modificationStatus: "Declined",
        modificationDeclineReason: reason,
        modificationReviewedAt: now,
        modificationPreviousStatus: null,
        modificationPreviousBookingStatus: null,
        requestedChanges: null,
        originalBookingSnapshot: null,
        lastActivityAt: now,
        updatedAt: now,
        adminLogs: appendLog(booking, "DECLINE_MODIFICATION", `Admin declined the requested booking changes. Reason: ${reason}.`, now),
      }
      transaction.update(bookingRef, fields as any)
      return { changed: true, booking: { ...booking, ...fields, id: bookingId }, userId: String(booking.userId || "") }
    })

    if (result.changed && result.userId && action !== "admin_update") {
      try {
        await firestore.collection("notifications").add({
          type: action === "request" ? "modification_requested" : action === "approve" ? "modification_approved" : "modification_declined",
          title: action === "request" ? "Modification Requested" : action === "approve" ? "Modification Approved" : "Modification Declined",
          message: action === "request"
            ? "A booking modification request is awaiting admin review."
            : action === "approve"
              ? `Your modification request for Booking ${bookingId} has been approved.`
              : `Your modification request for Booking ${bookingId} has been declined.`,
          bookingId,
          userId: action === "request" ? "admin" : result.userId,
          ...(action === "request" ? { relatedUserId: result.userId } : {}),
          isRead: false,
          moduleRead: false,
          createdAt: new Date(),
          link: action === "request" ? `/dashboard/bookings?highlight=${bookingId}` : `/portal/bookings?highlight=${bookingId}`,
        })
      } catch (error) {
        console.error("[POST /api/bookings/modification] Notification write failed:", error)
      }
    }

    return NextResponse.json({ booking: result.booking, alreadyProcessed: !result.changed })
  } catch (error: unknown) {
    return errorResponse(error)
  }
}
