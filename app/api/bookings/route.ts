import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
} from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const ROOM_PATTERN = /\broom\s+(\d+)\b/i
const ACTIVE_BOOKING_STATUSES = new Set([
  "pending",
  "verifying",
  "confirmed",
  "reservation_secured",
  "contract_signing_required",
  "modification_under_review",
  "cancellation_requested",
  "active_rental",
])
const NON_BOOKABLE_VENUE_NAMES = new Set(["Grand Ballroom", "Intimate Lounge"])

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

function readNumber(body: DataRecord, key: string, min: number, max: number): number {
  const value = body[key]
  const numberValue = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) {
    throw new ApiAuthError(400, `A valid ${key} is required.`)
  }
  return numberValue
}

function getManilaDate(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function parseTime(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return null
  let hour = Number(match[1])
  const minute = Number(match[2])
  const meridiem = match[3].toUpperCase()
  if (hour < 1 || hour > 12 || minute > 59) return null
  if (meridiem === "AM" && hour === 12) hour = 0
  if (meridiem === "PM" && hour !== 12) hour += 12
  return hour * 60 + minute
}

function getRoomNumber(value: string): number | null {
  const match = value.match(ROOM_PATTERN)
  return match ? Number(match[1]) : null
}

function isActiveBooking(data: DataRecord): boolean {
  return ACTIVE_BOOKING_STATUSES.has(String(data.status || "").toLowerCase())
}

function hasTimeOverlap(
  start: number | null,
  end: number | null,
  existingStart: number | null,
  existingEnd: number | null,
): boolean {
  if (start === null || end === null || existingStart === null || existingEnd === null) return true
  return start < existingEnd && existingStart < end
}

function getCatalogItem(cmsData: DataRecord, venueId: string, requestedOffice: boolean) {
  const venues = Array.isArray(cmsData.venues) ? cmsData.venues.filter(isRecord) : []
  const offices = Array.isArray(cmsData.offices) ? cmsData.offices.filter(isRecord) : []
  const isBookable = (item: DataRecord) => (
    item.isArchived !== true
    && item.isHidden !== true
    && !NON_BOOKABLE_VENUE_NAMES.has(String(item.name || ""))
  )
  const venue = venues.find((item) => String(item.id || "") === venueId && isBookable(item))
  const office = offices.find((item) => String(item.id || "") === venueId && isBookable(item))

  if (requestedOffice && office) return { item: office, isOffice: true }
  if (!requestedOffice && venue) return { item: venue, isOffice: false }
  if (office && !venue) return { item: office, isOffice: true }
  if (venue && !office) return { item: venue, isOffice: false }
  return null
}

function getCatalogPrice(item: DataRecord): number {
  const price = Number(item.price)
  if (!Number.isFinite(price) || price <= 0 || price > 10_000_000) {
    throw new ApiAuthError(503, "The selected space is not currently available for booking.")
  }
  return price
}

function getCatalogCapacity(item: DataRecord): number | null {
  const values = String(item.capacity || "").match(/\d+/g)?.map(Number) || []
  const maximum = values.filter((value) => Number.isFinite(value)).reduce((highest, value) => Math.max(highest, value), 0)
  return maximum > 0 ? maximum : null
}

function getNextBookingId(counterValue: unknown): { id: string; next: number } {
  const current = typeof counterValue === "number" && Number.isFinite(counterValue) ? counterValue : 0
  const next = Math.floor(current) + 1
  return { id: next < 10 ? `BK0${next}` : `BK${next}`, next }
}

function getTermMonths(term: string): number {
  if (term === "1_year") return 12
  if (term === "2_years") return 24
  return 6
}

function addMonths(dateValue: string, months: number): string {
  const date = new Date(`${dateValue}T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

function isDateBlocked(data: DataRecord, date: string): boolean {
  if (String(data.status || "").toLowerCase() !== "active") return false
  const start = typeof data.startDate === "string" && data.startDate ? data.startDate : String(data.date || "")
  const end = typeof data.endDate === "string" && data.endDate ? data.endDate : start
  return start <= date && date <= end
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    if (user.role !== "client") {
      throw new ApiAuthError(403, "Only client accounts can create bookings.")
    }

    const contentLength = Number(request.headers.get("content-length") || 0)
    if (contentLength > 128 * 1024) {
      throw new ApiAuthError(413, "The booking request is too large.")
    }

    let body: unknown
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 128 * 1024) {
      throw new ApiAuthError(413, "The booking request is too large.")
    }
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in request body.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid booking request.")

    const venueId = readString(body, "venueId", 100, true)
    const requestedOffice = body.isOfficeRental === true || body.bookingCategory === "office"
    const eventName = readString(body, "eventName", 160, true)
    const eventType = readString(body, "eventType", 120, true)
    const date = readString(body, "date", 10, true)
    const specialRequests = readString(body, "specialRequests", 2000)
    const submittedVenue = readString(body, "venue", 200)
    const submittedStartTime = readString(body, "startTime", 30)
    const submittedEndTime = readString(body, "endTime", 30)
    const officeRentalTerm = readString(body, "officeRentalTerm", 20)
    const rentalTerm = readString(body, "rentalTerm", 20)
    const companyName = readString(body, "companyName", 160)
    const natureOfBusiness = readString(body, "natureOfBusiness", 160)
    const customEventType = readString(body, "customEventType", 160)

    const minimumBookingDate = addMonths(getManilaDate(), 1)
    if (!isValidCalendarDate(date) || date < minimumBookingDate) {
      throw new ApiAuthError(400, "Bookings must be scheduled at least one month in advance.")
    }

    const firestore = getAdminFirestore()
    const cmsRef = firestore.collection("cms").doc("data")
    const createdBooking = await firestore.runTransaction(async (transaction) => {
      const cmsSnapshot = await transaction.get(cmsRef)
      if (!cmsSnapshot.exists) {
        throw new ApiAuthError(503, "Booking configuration is temporarily unavailable.")
      }

      const cmsData = cmsSnapshot.data() as DataRecord
      const catalog = getCatalogItem(cmsData, venueId, requestedOffice)
      if (!catalog) throw new ApiAuthError(400, "The selected space is no longer available.")

      const price = getCatalogPrice(catalog.item)
      const roomNumber = catalog.isOffice ? getRoomNumber(submittedVenue) : null
      if (catalog.isOffice) {
        const rooms = Array.isArray(catalog.item.rooms)
          ? catalog.item.rooms.filter((room) => isRecord(room) && room.isArchived !== true)
          : []
        if (!roomNumber || roomNumber < 1 || roomNumber > rooms.length) {
          throw new ApiAuthError(400, "Please choose a valid office room.")
        }
      }

      const guestCount = catalog.isOffice ? 1 : Math.floor(readNumber(body, "guestCount", 1, 1000))
      const capacity = getCatalogCapacity(catalog.item)
      if (!catalog.isOffice && capacity !== null && guestCount > capacity) {
        throw new ApiAuthError(400, `The selected space can accommodate up to ${capacity} guests.`)
      }

      const startTime = catalog.isOffice ? "" : submittedStartTime
      const endTime = catalog.isOffice ? "" : submittedEndTime
      const startMinutes = parseTime(startTime)
      const endMinutes = parseTime(endTime)
      if (!catalog.isOffice && (startMinutes === null || endMinutes === null || endMinutes <= startMinutes)) {
        throw new ApiAuthError(400, "Please choose a valid event time.")
      }

      const existingSnapshot = await transaction.get(
        firestore.collection("bookings").where("venueId", "==", venueId),
      )
      for (const existingDocument of existingSnapshot.docs) {
        const existing = existingDocument.data() as DataRecord
        if (!isActiveBooking(existing) || String(existing.date || "") !== date) continue

        if (catalog.isOffice) {
          const existingRoomNumber = getRoomNumber(String(existing.venue || ""))
          if (existingRoomNumber === null || existingRoomNumber === roomNumber) {
            throw new ApiAuthError(409, "That office room is already reserved for the selected date.")
          }
          continue
        }

        if (
          hasTimeOverlap(
            startMinutes,
            endMinutes,
            parseTime(String(existing.startTime || "")),
            parseTime(String(existing.endTime || "")),
          )
        ) {
          throw new ApiAuthError(409, "That space is already reserved for the selected time.")
        }
      }

      const maintenanceSnapshot = await transaction.get(
        firestore.collection("maintenanceRecords").where("spaceId", "==", venueId),
      )
      if (maintenanceSnapshot.docs.some((document) => isDateBlocked(document.data() as DataRecord, date))) {
        throw new ApiAuthError(409, "That space is under maintenance on the selected date.")
      }

      const bookingNumber = getNextBookingId(cmsData.bookingCounter)
      const downPaymentPercentage = typeof catalog.item.downPaymentPercentage === "number"
        && catalog.item.downPaymentPercentage > 0
        && catalog.item.downPaymentPercentage <= 100
        ? catalog.item.downPaymentPercentage
        : 50
      const downPaymentAmount = price * (downPaymentPercentage / 100)
      const selectedTerm = catalog.isOffice
        ? ["6_months", "1_year", "2_years"].includes(officeRentalTerm)
          ? officeRentalTerm
          : "6_months"
        : ""
      const now = new Date().toISOString()
      const venue = catalog.isOffice && roomNumber
        ? `${String(catalog.item.name || venueId)} - Room ${roomNumber}`
        : String(catalog.item.name || venueId)
      const fullName = user.fullName || "Client"

      const booking = {
        uid: user.uid,
        userId: user.uid,
        venueId,
        venue,
        eventName,
        eventType,
        companyName: catalog.isOffice ? companyName : "",
        natureOfBusiness: catalog.isOffice ? natureOfBusiness : "",
        customEventType: catalog.isOffice ? customEventType : "",
         guestCount,
        date,
        endDate: catalog.isOffice ? addMonths(date, getTermMonths(selectedTerm)) : "",
         time: catalog.isOffice ? "" : `${startTime} - ${endTime}`,
        startTime,
        endTime,
        status: "pending",
        bookingStatus: "Pending Verification",
        isSlotSecured: false,
        paymentStatus: "unpaid",
        paymentType: catalog.isOffice ? "slot_reservation" : "",
        paymentMethod: "",
        amountPaid: 0,
        remainingBalance: catalog.isOffice ? 0 : price,
        remainingBalancePaid: false,
        totalPrice: price,
        downPaymentPercentage,
        downPaymentAmount,
        selectedDownpaymentAmount: catalog.isOffice ? price : downPaymentAmount,
        downpaymentPaid: 0,
        downpaymentRemaining: 0,
        specialRequests,
        userInfo: {
          name: fullName,
          email: user.email || "",
          phone: user.phone || "",
        },
        bookingCategory: catalog.isOffice ? "office" : "venue",
        bookingType: catalog.isOffice ? "office" : "venue",
        isOfficeRental: catalog.isOffice,
        officeRentalTerm: selectedTerm,
        rentalTerm: catalog.isOffice ? selectedTerm : rentalTerm,
        contractTerm: catalog.isOffice ? selectedTerm : "",
        contractSigningRequired: true,
        contractSigned: false,
        contractStatus: catalog.isOffice ? "Not Available" : "Not Available",
        requiresOnsiteContractSigning: catalog.isOffice,
        cancellationRequested: false,
        cancellationStatus: "None",
        refundStatus: "Not Applicable",
        receiptIssued: false,
        verifiedByAdmin: false,
        hasActivePaymentSubmission: false,
        officePaymentNote: catalog.isOffice
          ? "This system payment is for slot reservation only. Succeeding office rental payments are settled onsite by check after contract signing."
          : "",
        adminLogs: [
          {
            action: catalog.isOffice ? "OFFICE_SLOT_RESERVATION_CREATED" : "BOOKING_CREATED",
            message: catalog.isOffice
              ? "Office rental request created. Client must secure the slot first, then visit onsite for contract signing."
              : "Booking request submitted for admin review.",
            createdAt: now,
          },
        ],
        createdAt: now,
        lastActivityAt: now,
        updatedAt: now,
      }

      transaction.set(cmsRef, { bookingCounter: bookingNumber.next }, { merge: true })
      transaction.create(firestore.collection("bookings").doc(bookingNumber.id), booking)
      return { ...booking, id: bookingNumber.id }
    })

    try {
      await firestore.collection("notifications").add({
        type: "booking_submitted",
        title: createdBooking.isOfficeRental ? "New Office Rental" : "New Booking",
        message: createdBooking.isOfficeRental
          ? `A new rental has been submitted for ${createdBooking.venue}.`
          : `A new booking has been submitted for ${createdBooking.venue}.`,
        bookingId: createdBooking.id,
        userId: "admin",
        relatedUserId: user.uid,
        relatedUserName: createdBooking.userInfo.name,
        isRead: false,
        moduleRead: false,
        createdAt: new Date(),
        link: `/dashboard/bookings?highlight=${createdBooking.id}`,
      })
    } catch (error: unknown) {
      console.error(
        "[POST /api/bookings] Notification write failed:",
        error instanceof Error ? error.message : "Unknown error",
      )
    }

    return NextResponse.json({ id: createdBooking.id, booking: createdBooking }, { status: 201 })
  } catch (error: unknown) {
    if (isApiAuthError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error("[POST /api/bookings]", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json({ error: "Unable to create the booking. Please try again." }, { status: 500 })
  }
}
