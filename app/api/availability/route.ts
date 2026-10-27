import "server-only"
import { randomUUID } from "node:crypto"

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { readResourceAvailability } from "@/lib/resource-availability"
import { ApiAuthError, isApiAuthError, requireAuthenticatedUser } from "@/lib/server-auth"
import {
  calculateAvailabilityRange, findEarliestOfficeStartDate, getMinimumBookingDate,
  getEventSchedule, getOfficeRentalEndDate, getOfficeRoomStatus, MAX_OFFICE_SEARCH_DAYS, type OfficeAvailabilityTerm,
} from "@/src/modules/shared/lib/availability"
import { getCatalogAvailabilitySpace } from "@/src/modules/shared/lib/resource-identity"
import { isCatalogPublished, isCatalogUnderRenovation } from "@/src/modules/shared/lib/catalog-status"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

function readParam(request: NextRequest, key: string, required = false): string {
  const value = String(request.nextUrl.searchParams.get(key) || "").trim()
  if (required && !value) throw new ApiAuthError(400, `A valid ${key} is required.`)
  if (value.length > 160) throw new ApiAuthError(400, `${key} is too long.`)
  return value
}

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export async function GET(request: NextRequest) {
  const started = performance.now()
  const requestId = randomUUID()
  const timings: Record<string, number> = {}
  const counts: Record<string, number> = {}
  const report = (stage: string, ms: number, docs?: number) => {
    timings[stage] = (timings[stage] || 0) + ms
    if (docs !== undefined) counts[stage] = (counts[stage] || 0) + docs
  }
  const respond = (body: unknown, status = 200) => {
    const response = NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } })
    timings.total = performance.now() - started
    response.headers.set("Server-Timing", Object.entries(timings).map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`).join(", "))
    if (process.env.NEXT_PUBLIC_PERF_TRACE === "1") console.info("[availability read]", { requestId, status, timings, counts })
    return response
  }
  try {
    const user = await requireAuthenticatedUser(request)
    report("auth", performance.now() - started)
    const category = readParam(request, "category", true)
    if (category !== "venue" && category !== "office") throw new ApiAuthError(400, "Invalid availability category.")
    const venueId = readParam(request, "venueId", true)
    const officeId = readParam(request, "officeId") || venueId
    const spaceId = readParam(request, "spaceId")
    const roomSummary = readParam(request, "scope") === "rooms"
    const from = readParam(request, "from", true)
    const to = readParam(request, "to", true)
    const excludeBookingId = readParam(request, "excludeBookingId")
    const rentalTerm = readParam(request, "rentalTerm")
    const searchFrom = readParam(request, "searchFrom")
    const searchTo = readParam(request, "searchTo")
    if (!isValidCalendarDate(from) || !isValidCalendarDate(to) || from > to
      || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 >= 62) {
      throw new ApiAuthError(400, "Please choose a valid availability range of at most 62 days.")
    }
    if ((roomSummary && (category !== "office" || spaceId || excludeBookingId || rentalTerm || searchFrom || searchTo))
      || (category === "office" && ((!spaceId && !roomSummary) || officeId !== venueId))) throw new ApiAuthError(400, "A valid office and room are required.")
    if (rentalTerm && (category !== "office" || !["6_months", "1_year", "2_years"].includes(rentalTerm))) {
      throw new ApiAuthError(400, "Please choose a valid office rental term.")
    }
    if ((searchFrom || searchTo) && (category !== "office" || !rentalTerm
      || !isValidCalendarDate(searchFrom) || !isValidCalendarDate(searchTo) || searchFrom > searchTo
      || (Date.parse(searchTo) - Date.parse(searchFrom)) / 86400000 >= MAX_OFFICE_SEARCH_DAYS)) {
      throw new ApiAuthError(400, "Please choose an office start-date search of at most 1096 days and a valid rental term.")
    }

    const firestore = getAdminFirestore()
    const catalogStarted = performance.now()
    const cmsSnapshot = await firestore.collection("cms").doc("data").get()
    report("catalog", performance.now() - catalogStarted)
    if (!cmsSnapshot.exists) throw new ApiAuthError(503, "Booking configuration is temporarily unavailable.")
    const catalog = cmsSnapshot.data() as DataRecord
    const building = category === "office" && (roomSummary || spaceId === officeId)
    if (building && !roomSummary && user.role !== "admin" && !(user.role === "staff" && user.permissions?.bookings)) {
      throw new ApiAuthError(403, "Whole-building availability requires bookings permission.")
    }
    const entries = catalog[category === "office" ? "offices" : "venues"]
    const item = Array.isArray(entries) ? entries.find((entry) => entry?.id === venueId) : null
    const space = getCatalogAvailabilitySpace(catalog, category, venueId, category === "office" && !building ? spaceId : undefined, building)
    const room = category === "office" && Array.isArray(item?.rooms) ? item.rooms.find((entry: DataRecord) => entry.id === spaceId) : null
    if (item && item.isArchived !== true && isCatalogUnderRenovation(item)) {
      throw new ApiAuthError(409, "The selected space is under renovation and cannot accept new bookings.")
    }
    if (!space || !item || item.isArchived || !isCatalogPublished(item) || item.isBookable === false
      || (category === "office" && !building && (!room || room.isArchived || room.isHidden || room.isBookable === false))) {
      throw new ApiAuthError(400, "The selected space is no longer available.")
    }
    if (roomSummary) {
      // One complete read per building, with identity-review isolation per room.
      // This returns no customer, booking, or lease data and grants no building lookup.
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
      const records = await readResourceAvailability(firestore, space, today, today, undefined, "", false, report)
      const calculationStarted = performance.now()
      const rooms: DataRecord[] = Array.isArray(item.rooms) ? item.rooms : []
      const officeRooms = Object.fromEntries(rooms.filter((entry) => !entry.isArchived && !entry.isHidden).map((entry) => {
        const target = getCatalogAvailabilitySpace(catalog, "office", venueId, String(entry.id || ""))
        return [String(entry.id || ""), target && entry.isBookable !== false
          ? getOfficeRoomStatus(target, today, records.bookings, records.maintenanceRecords, records.officeRentals) : "unavailable"]
      }))
      report("calculate", performance.now() - calculationStarted)
      return respond({ officeId, officeRooms })
    }
    if (excludeBookingId) {
      const booking = await firestore.collection("bookings").doc(excludeBookingId).get()
      const data = booking.data()
      if (!booking.exists || (user.role !== "admin" && !(user.role === "staff" && user.permissions?.bookings)
        && String(data?.userId || data?.uid || "") !== user.uid)) {
        throw new ApiAuthError(403, "You cannot exclude this reservation from availability.")
      }
    }
    const readFrom = searchFrom && searchFrom < from ? searchFrom : from
    const readTo = searchTo && searchTo > to ? searchTo : to
    const records = await readResourceAvailability(firestore, space, readFrom,
      rentalTerm ? getOfficeRentalEndDate(readTo, rentalTerm) : readTo, undefined, excludeBookingId, true, report)
    const calculationStarted = performance.now()
    const dates = calculateAvailabilityRange(space, from, to, records.bookings, records.maintenanceRecords, records.officeRentals, item,
      rentalTerm as OfficeAvailabilityTerm || undefined)
    const minimumDate = getMinimumBookingDate()
    const eligibleFrom = searchFrom > minimumDate ? searchFrom : minimumDate
    const officeSearch = searchFrom ? {
      from: searchFrom, to: searchTo,
      earliestAvailableStartDate: findEarliestOfficeStartDate(space, eligibleFrom, searchTo, rentalTerm as OfficeAvailabilityTerm,
        records.bookings, records.maintenanceRecords, records.officeRentals),
    } : undefined
    report("calculate", performance.now() - calculationStarted)
    // Only schedule primitives leave the server; no booking/customer documents or identifiers.
    return respond({
      space: { category: space.category, venueId: space.venueId, officeId: space.officeId, spaceId: space.spaceId },
      ...(category === "venue" ? { schedule: getEventSchedule(item) } : {}),
      dates,
      ...(officeSearch ? { officeSearch } : {}),
    })
  } catch (error: unknown) {
    if (isApiAuthError(error)) return respond({ error: error.message, requestId }, error.status)
    console.error("[GET /api/availability]", { requestId }, error instanceof Error ? error.message : "Unknown error")
    return respond({ error: "Unable to load space availability. Check your connection and retry.", requestId }, 500)
  }
}
