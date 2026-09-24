import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
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
  type AvailabilityRecord,
  type AvailabilitySpace,
} from "@/src/modules/shared/lib/availability"

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

function getRoomNumber(value: unknown): number | null {
  const match = String(value || "").match(/\broom\s+(\d+)\b/i)
  return match ? Number(match[1]) : null
}

function isOfficeBooking(booking: DataRecord): boolean {
  return booking.isOfficeRental === true || booking.bookingCategory === "office" ||
    String(booking.venue || "").toLowerCase().includes("office")
}

function addMonths(dateValue: string, months: number): string {
  const date = new Date(`${dateValue}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

function getTermMonths(value: unknown): number {
  if (value === "1_year") return 12
  if (value === "2_years") return 24
  return 6
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
      changes[key] = entry
    }
  }
  if (Object.keys(changes).length === 0) throw new ApiAuthError(400, "Please provide at least one change.")
  return changes
}

function validateDate(value: unknown, allowPastValue: string): string {
  const date = String(value || "")
  if (!DATE_PATTERN.test(date)) throw new ApiAuthError(400, "Please choose a valid booking date.")
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
) {
  const venueId = String(booking.venueId || "")
  if (!venueId) return
  const date = validateDate(candidate.date, String(booking.date || ""))
  const office = isOfficeBooking(candidate)
  const venueName = String(candidate.venue || booking.venue || venueId)
  const officeName = venueName.split(/\s+-\s+(?:room|rm)\s+/i)[0].trim() || venueName
  const roomNumber = getRoomNumber(candidate.venue)
  const rentalTerm = candidate.officeRentalTerm || candidate.rentalTerm || candidate.contractTerm
  const endDate = office
    ? rentalTerm
      ? addMonths(date, getTermMonths(rentalTerm))
      : String(candidate.endDate || date)
    : date
  const space: AvailabilitySpace = office
    ? {
        category: "office",
        venueId,
        officeId: String(candidate.officeId || booking.officeId || venueId),
        spaceId: String(candidate.spaceId || booking.spaceId || ""),
        name: officeName,
        roomName: roomNumber ? `Room ${roomNumber}` : "",
      }
    : {
        category: "venue",
        venueId,
        spaceId: String(candidate.spaceId || booking.spaceId || venueId),
        name: venueName,
      }

  const bookingQueries: FirebaseFirestore.Query[] = [
    firestore.collection("bookings").where("venueId", "==", venueId),
    firestore.collection("bookings").where("date", "==", date),
  ]
  if (office) bookingQueries.push(firestore.collection("bookings").where("endDate", ">=", date))
  const bookingSnapshots = await Promise.all(bookingQueries.map((query) => transaction.get(query)))
  const existingBookings = new Map<string, AvailabilityRecord>()
  bookingSnapshots.forEach((snapshot) => snapshot.forEach((document) => {
    if (document.id !== bookingId) {
      existingBookings.set(document.id, { ...(document.data() as DataRecord), id: document.id })
    }
  }))

  const maintenanceQueries: FirebaseFirestore.Query[] = [
    firestore.collection("maintenanceRecords").where("date", "==", date),
    firestore.collection("maintenanceRecords").where("endDate", ">=", date),
    ...[...new Set([space.spaceId, space.officeId, space.venueId].filter(Boolean))].map((spaceId) => (
      firestore.collection("maintenanceRecords").where("spaceId", "==", spaceId)
    )),
  ]
  const maintenanceSnapshots = await Promise.all(maintenanceQueries.map((query) => transaction.get(query)))
  const maintenanceRecords = new Map<string, AvailabilityRecord>()
  maintenanceSnapshots.forEach((snapshot) => snapshot.forEach((document) => {
    maintenanceRecords.set(document.id, { ...(document.data() as DataRecord), id: document.id })
  }))

  let officeRentals: AvailabilityRecord[] = []
  if (office) {
    const officeRentalSnapshots = await Promise.all(
      [...new Set([space.spaceId, space.officeId, space.venueId].filter(Boolean))].map((spaceId) => (
        transaction.get(firestore.collection("officeRentals").where("officeSpaceId", "==", spaceId))
      )),
    )
    const records = new Map<string, AvailabilityRecord>()
    officeRentalSnapshots.forEach((snapshot) => snapshot.forEach((document) => {
      records.set(document.id, { ...(document.data() as DataRecord), id: document.id })
    }))
    officeRentals = [...records.values()]
  }

  let scheduleConfig: unknown = candidate
  if (!office) {
    const cmsSnapshot = await transaction.get(firestore.collection("cms").doc("data"))
    if (cmsSnapshot.exists) {
      const cmsData = cmsSnapshot.data() as DataRecord
      const venues = Array.isArray(cmsData.venues) ? cmsData.venues.filter(isRecord) : []
      scheduleConfig = venues.find((entry) => String(entry.id || "") === venueId) || candidate
    }
  }

  if (office) {
    const rangeStatus = getAvailabilityRangeStatus(
      space,
      date,
      endDate,
      [...existingBookings.values()],
      [...maintenanceRecords.values()],
      officeRentals,
    )
    if (rangeStatus === "maintenance") {
      throw new ApiAuthError(409, "That office room is under maintenance during the selected rental term.")
    }
    if (rangeStatus !== "available") {
      throw new ApiAuthError(409, "That office room is already reserved during the selected rental term.")
    }
    return
  }

  const availability = calculateAvailabilityForDate(
    space,
    date,
    [...existingBookings.values()],
    [...maintenanceRecords.values()],
    officeRentals,
    scheduleConfig,
  )
  if (availability.status === "maintenance") {
    throw new ApiAuthError(409, "That space is under maintenance on the selected date.")
  }
  const interval = getAvailabilityTimeRange(candidate)
  if (!interval || !isValidEventSlot(interval.startMinutes, interval.endMinutes, scheduleConfig)) {
    throw new ApiAuthError(409, "Please choose a valid event time.")
  }
  if (!availability.availableSlots.some((slot) => (
    slot.startMinutes === interval.startMinutes && slot.endMinutes === interval.endMinutes
  ))) {
    throw new ApiAuthError(409, "That space is already reserved for the selected time.")
  }
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

      if (action === "request") {
        if (String(booking.userId || booking.uid || "") !== user.uid) throw new ApiAuthError(403, "You do not have access to this booking.")
        if (["cancelled", "completed", "declined", "rental_expired"].includes(String(booking.status || "").toLowerCase())) {
          throw new ApiAuthError(409, "This booking cannot be modified.")
        }
        if (String(booking.status || "").toLowerCase() === "modification_under_review" || booking.modificationRequested === true) {
          return { changed: false, booking: { ...booking, id: bookingId } }
        }
        const changes = normalizeChanges(body.changes)
        const candidate = { ...booking, ...changes }
        await assertAvailable(transaction, firestore, bookingId, booking, candidate)
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
          requestedChanges: changes,
          originalBookingSnapshot: {
            eventName: booking.eventName,
            eventType: booking.eventType,
            guestCount: booking.guestCount,
            date: booking.date,
            startTime: booking.startTime,
            endTime: booking.endTime,
            time: booking.time,
            venue: booking.venue,
            venueId: booking.venueId,
            officeId: booking.officeId,
            spaceId: booking.spaceId,
            specialRequests: booking.specialRequests,
          },
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(booking, "REQUEST_MODIFICATION", `Client requested modification. Reason: ${reason}.`, now),
        }
        transaction.update(bookingRef, fields as any)
        return { changed: true, booking: { ...booking, ...fields, id: bookingId }, userId: String(booking.userId || "") }
      }

      if (action === "admin_update") {
        const changes = normalizeChanges(body.changes)
        const candidate = { ...booking, ...changes }
        if (isOfficeBooking(candidate) && (changes.date || changes.officeRentalTerm || changes.rentalTerm || changes.contractTerm)) {
          candidate.endDate = addMonths(String(candidate.date || booking.date), getTermMonths(candidate.officeRentalTerm || candidate.rentalTerm || candidate.contractTerm))
        }
        await assertAvailable(transaction, firestore, bookingId, booking, candidate)
        const fields: DataRecord = {
          ...changes,
          ...(candidate.endDate ? { endDate: candidate.endDate } : {}),
          modifiedAt: now,
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(booking, "ADMIN_UPDATE_BOOKING", "Admin updated the booking details.", now),
        }
        transaction.update(bookingRef, fields as any)
        return { changed: true, booking: { ...booking, ...fields, id: bookingId }, userId: String(booking.userId || "") }
      }

      if (String(booking.status || "").toLowerCase() !== "modification_under_review" || !booking.requestedChanges) {
        throw new ApiAuthError(409, "This booking has no pending modification request.")
      }
      const changes = normalizeChanges(booking.requestedChanges)
      if (action === "approve") {
        const candidate = { ...booking, ...changes }
        if (isOfficeBooking(candidate) && (changes.date || changes.officeRentalTerm || changes.rentalTerm || changes.contractTerm)) {
          candidate.endDate = addMonths(String(candidate.date || booking.date), getTermMonths(candidate.officeRentalTerm || candidate.rentalTerm || candidate.contractTerm))
        }
        await assertAvailable(transaction, firestore, bookingId, booking, candidate)
        const restored = restoredStatus(booking)
        const fields: DataRecord = {
          ...changes,
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
