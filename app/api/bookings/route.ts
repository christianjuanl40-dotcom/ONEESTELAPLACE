import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { readResourceAvailabilityLock, commitEventAvailabilityLock } from "@/lib/event-availability-lock"
import { commitExpiredAvailabilityHolds, readResourceAvailability } from "@/lib/resource-availability"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
} from "@/lib/server-auth"
import { formatDisplayName } from "@/src/modules/shared/lib/name-utils"
import {
  calculateAvailabilityForDate,
  isAvailabilitySlotOpen,
  getAvailabilityRangeStatus,
  isValidEventSlot,
  parseAvailabilityTime,
  getOfficeRentalEndDate,
  getMinimumBookingDate,
} from "@/src/modules/shared/lib/availability"
import { getCatalogAvailabilitySpace } from "@/src/modules/shared/lib/resource-identity"
import { isCatalogPublished } from "@/src/modules/shared/lib/catalog-status"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function getCatalogItem(cmsData: DataRecord, venueId: string, requestedOffice: boolean) {
  const venues = Array.isArray(cmsData.venues) ? cmsData.venues.filter(isRecord) : []
  const offices = Array.isArray(cmsData.offices) ? cmsData.offices.filter(isRecord) : []
  const isBookable = (item: DataRecord) => (
    item.isArchived !== true
    && isCatalogPublished(item)
    && item.isBookable !== false
  )
  const venue = venues.find((item) => String(item.id || "") === venueId && isBookable(item))
  const office = offices.find((item) => String(item.id || "") === venueId && isBookable(item))

  if (requestedOffice && office) return { item: office, isOffice: true }
  if (!requestedOffice && venue) return { item: venue, isOffice: false }
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
    const submittedOfficeId = readString(body, "officeId", 100)
    const submittedSpaceId = readString(body, "spaceId", 100)
    const submittedStartTime = readString(body, "startTime", 30)
    const submittedEndTime = readString(body, "endTime", 30)
    const officeRentalTerm = readString(body, "officeRentalTerm", 20)
    const rentalTerm = readString(body, "rentalTerm", 20)
    const companyName = readString(body, "companyName", 160)
    const natureOfBusiness = readString(body, "natureOfBusiness", 160)
    const customEventType = readString(body, "customEventType", 160)

    const minimumBookingDate = getMinimumBookingDate()
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
      const rooms = catalog.isOffice
        ? Array.isArray(catalog.item.rooms)
          ? catalog.item.rooms.filter((room) => isRecord(room) && room.isArchived !== true)
          : []
        : []
      if (catalog.isOffice && submittedOfficeId && submittedOfficeId !== venueId) {
        throw new ApiAuthError(400, "The selected office is invalid.")
      }

      const room = catalog.isOffice ? rooms.find((entry) => entry.id === submittedSpaceId) : null
      if (catalog.isOffice && (!room || room.isHidden === true || room.isBookable === false)) {
        throw new ApiAuthError(400, "Please choose a valid office room.")
      }

      const guestCount = catalog.isOffice ? 1 : Math.floor(readNumber(body, "guestCount", 1, 1000))
      const capacity = getCatalogCapacity(catalog.item)
      if (!catalog.isOffice && capacity !== null && guestCount > capacity) {
        throw new ApiAuthError(400, `The selected space can accommodate up to ${capacity} guests.`)
      }

      const startTime = catalog.isOffice ? "" : submittedStartTime
      const endTime = catalog.isOffice ? "" : submittedEndTime
      const selectedTerm = catalog.isOffice ? officeRentalTerm || rentalTerm || "6_months" : ""
      if (catalog.isOffice && !["6_months", "1_year", "2_years"].includes(selectedTerm)) {
        throw new ApiAuthError(400, "Please choose a valid office rental term.")
      }
      const officeEndDate = catalog.isOffice ? getOfficeRentalEndDate(date, selectedTerm) : ""
      const startMinutes = parseAvailabilityTime(startTime)
      const endMinutes = parseAvailabilityTime(endTime)
      if (!catalog.isOffice && (startMinutes === null || endMinutes === null || endMinutes <= startMinutes)) {
        throw new ApiAuthError(400, "Please choose a valid event time.")
      }

      const roomName = String(room?.name || "")
      const space = getCatalogAvailabilitySpace(cmsData, catalog.isOffice ? "office" : "venue", venueId,
        catalog.isOffice ? submittedSpaceId : undefined)
      if (!space) throw new ApiAuthError(400, "The selected resource ID is invalid or ambiguous.")
      const eventLock = await readResourceAvailabilityLock(transaction, firestore, space, date)
      const { bookings: existingBookings, maintenanceRecords, officeRentals: officeRentalRecords, expiredBookings } = await readResourceAvailability(
        firestore, space, date, officeEndDate || date, transaction,
      )

      if (!catalog.isOffice && !isValidEventSlot(startMinutes, endMinutes, catalog.item)) {
        throw new ApiAuthError(400, "Please choose a valid event time.")
      }
      const availability = calculateAvailabilityForDate(
        space,
        date,
        existingBookings,
        maintenanceRecords,
        officeRentalRecords,
        catalog.item,
      )
      if (availability.status === "maintenance") {
        throw new ApiAuthError(409, "That space is under maintenance on the selected date.")
      }
      if (catalog.isOffice) {
        const rangeStatus = getAvailabilityRangeStatus(
          space,
          date,
          officeEndDate,
            existingBookings,
            maintenanceRecords,
            officeRentalRecords,
        )
        if (rangeStatus === "maintenance") {
          throw new ApiAuthError(409, "That office room is under maintenance during the selected rental term.")
        }
        if (rangeStatus !== "available") {
          throw new ApiAuthError(409, "That office room is already reserved or occupied. It must be released before another rental can be booked.")
        }
      }
      if (!catalog.isOffice && !isAvailabilitySlotOpen(
        space,
        date,
        startMinutes as number,
        endMinutes as number,
        existingBookings,
        maintenanceRecords,
        catalog.item,
      )) {
        throw new ApiAuthError(409, "That space is already reserved for the selected time.")
      }

      const bookingNumber = getNextBookingId(cmsData.bookingCounter)
      const downPaymentPercentage = typeof catalog.item.downPaymentPercentage === "number"
        && catalog.item.downPaymentPercentage > 0
        && catalog.item.downPaymentPercentage <= 100
        ? catalog.item.downPaymentPercentage
        : 50
      const downPaymentAmount = price * (downPaymentPercentage / 100)
      const now = new Date().toISOString()
      const venue = catalog.isOffice
        ? `${String(catalog.item.name || venueId)} - ${roomName}`
        : String(catalog.item.name || venueId)
      const fullName = formatDisplayName(user, user.fullName || "Client")

      const booking = {
        uid: user.uid,
        userId: user.uid,
        venueId,
        officeId: catalog.isOffice ? venueId : "",
        spaceId: catalog.isOffice ? String(room?.id || submittedSpaceId || "") : venueId,
        venue,
        eventName,
        eventType,
        companyName: catalog.isOffice ? companyName : "",
        natureOfBusiness: catalog.isOffice ? natureOfBusiness : "",
        customEventType: catalog.isOffice ? customEventType : "",
        guestCount,
        date,
        endDate: officeEndDate,
        time: catalog.isOffice ? "" : `${startTime} - ${endTime}`,
        startTime,
        endTime,
        status: "pending",
        bookingStatus: "Pending",
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
      commitExpiredAvailabilityHolds(transaction, firestore, expiredBookings)
      commitEventAvailabilityLock(transaction, eventLock)
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
