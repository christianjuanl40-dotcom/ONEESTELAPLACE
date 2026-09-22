import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
} from "@/lib/server-auth"
import {
  calculateAvailabilityRange,
  getAvailabilityDates,
  getEventSchedule,
  type AvailabilityRecord,
  type AvailabilitySpace,
} from "@/src/modules/shared/lib/availability"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 62
const NON_BOOKABLE_VENUE_NAMES = new Set(["Grand Ballroom", "Intimate Lounge"])

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null
}

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function readParam(request: NextRequest, key: string, required = false): string {
  const value = String(request.nextUrl.searchParams.get(key) || "").trim()
  if (required && !value) throw new ApiAuthError(400, `A valid ${key} is required.`)
  if (value.length > 160) throw new ApiAuthError(400, `${key} is too long.`)
  return value
}

function isBookable(item: DataRecord): boolean {
  return item.isArchived !== true
    && item.isHidden !== true
    && !NON_BOOKABLE_VENUE_NAMES.has(String(item.name || ""))
}

function getCatalogItem(
  cmsData: DataRecord,
  category: "venue" | "office",
  id: string,
): DataRecord | null {
  const key = category === "office" ? "offices" : "venues"
  const items = Array.isArray(cmsData[key]) ? cmsData[key].filter(isRecord) : []
  return items.find((item) => String(item.id || "") === id && isBookable(item)) || null
}

function addSnapshotRecords(
  target: Map<string, AvailabilityRecord>,
  snapshot: FirebaseFirestore.QuerySnapshot,
) {
  snapshot.forEach((document) => {
    target.set(document.id, { ...(document.data() as AvailabilityRecord), id: document.id })
  })
}

async function collectRecords(
  queries: FirebaseFirestore.Query[],
): Promise<AvailabilityRecord[]> {
  const records = new Map<string, AvailabilityRecord>()
  const snapshots = await Promise.all(queries.map((query) => query.get()))
  snapshots.forEach((snapshot) => addSnapshotRecords(records, snapshot))
  return [...records.values()]
}

function buildSpace(
  category: "venue" | "office",
  venueId: string,
  item: DataRecord,
  officeId: string,
  spaceId: string,
): AvailabilitySpace {
  const name = String(item.name || venueId)
  if (category === "venue") {
    return { category, venueId, spaceId: venueId, name }
  }

  const rooms = Array.isArray(item.rooms)
    ? item.rooms.filter((room) => isRecord(room) && room.isArchived !== true)
    : []
  const room = rooms.find((entry) => String(entry.id || "") === spaceId)
  if (!room) throw new ApiAuthError(400, "Please choose a valid office room.")

  return {
    category,
    venueId: officeId,
    officeId,
    spaceId,
    name,
    roomName: String(room.name || `Room ${rooms.indexOf(room) + 1}`),
  }
}

async function loadRelevantRecords(
  firestore: FirebaseFirestore.Firestore,
  space: AvailabilitySpace,
  from: string,
  to: string,
  excludeBookingId: string,
) {
  const bookingsRef = firestore.collection("bookings")
  const bookingQueries: FirebaseFirestore.Query[] = [
    bookingsRef.where("venueId", "==", space.venueId),
    bookingsRef.where("date", ">=", from).where("date", "<=", to),
  ]
  if (space.category === "office") bookingQueries.push(bookingsRef.where("endDate", ">=", from))
  const bookings = (await collectRecords(bookingQueries)).filter((booking) => booking.id !== excludeBookingId)

  const maintenanceIds = [space.spaceId, space.officeId, space.venueId].filter(Boolean) as string[]
  const maintenanceQueries: FirebaseFirestore.Query[] = [
    firestore.collection("maintenanceRecords").where("date", ">=", from).where("date", "<=", to),
    firestore.collection("maintenanceRecords").where("endDate", ">=", from),
    ...[...new Set(maintenanceIds)].map((id) => (
      firestore.collection("maintenanceRecords").where("spaceId", "==", id)
    )),
  ]
  const maintenanceRecords = await collectRecords(maintenanceQueries)

  let officeRentals: AvailabilityRecord[] = []
  if (space.category === "office") {
    const officeIds = [...new Set([space.spaceId, space.officeId, space.venueId].filter(Boolean))] as string[]
    officeRentals = await collectRecords(officeIds.map((id) => (
      firestore.collection("officeRentals").where("officeSpaceId", "==", id)
    )))
  }

  return { bookings, maintenanceRecords, officeRentals }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    if (user.role !== "client" && user.role !== "admin" && user.role !== "staff") {
      throw new ApiAuthError(403, "This account is not authorized.")
    }

    const category = readParam(request, "category", true)
    if (category !== "venue" && category !== "office") {
      throw new ApiAuthError(400, "Invalid availability category.")
    }
    const venueId = readParam(request, "venueId", true)
    const officeId = readParam(request, "officeId") || venueId
    const spaceId = readParam(request, "spaceId")
    const from = readParam(request, "from", true)
    const to = readParam(request, "to", true)
    const excludeBookingId = readParam(request, "excludeBookingId")

    if (!isValidCalendarDate(from) || !isValidCalendarDate(to) || from > to) {
      throw new ApiAuthError(400, "Please choose a valid availability date range.")
    }
    const dates = getAvailabilityDates(from, to)
    if (dates.length === 0 || dates.length > MAX_RANGE_DAYS) {
      throw new ApiAuthError(400, "The availability date range is too large.")
    }
    if (category === "office" && !spaceId) {
      throw new ApiAuthError(400, "A valid office room is required.")
    }

    const firestore = getAdminFirestore()
    const cmsSnapshot = await firestore.collection("cms").doc("data").get()
    if (!cmsSnapshot.exists) throw new ApiAuthError(503, "Booking configuration is temporarily unavailable.")
    const cmsData = cmsSnapshot.data() as DataRecord
    const item = getCatalogItem(cmsData, category, category === "office" ? officeId : venueId)
    if (!item) throw new ApiAuthError(400, "The selected space is no longer available.")

    const space = buildSpace(category, venueId, item, officeId, spaceId || venueId)
    const records = await loadRelevantRecords(firestore, space, from, to, excludeBookingId)
    const schedule = category === "venue" ? getEventSchedule(item) : undefined
    const availability = calculateAvailabilityRange(
      space,
      from,
      to,
      records.bookings,
      records.maintenanceRecords,
      records.officeRentals,
      item,
    )

    return NextResponse.json({
      space: {
        category: space.category,
        venueId: space.venueId,
        officeId: space.officeId,
        spaceId: space.spaceId,
      },
      ...(schedule ? { schedule } : {}),
      dates: availability,
    })
  } catch (error: unknown) {
    if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("[GET /api/availability]", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json({ error: "Unable to load space availability." }, { status: 500 })
  }
}
