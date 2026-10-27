import "server-only"

import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { getAdminFirestore } from "@/lib/firebase-admin"
import { commitExpiredAvailabilityHolds, evaluateAvailabilityHolds } from "@/lib/resource-availability"
import { readResourceAvailabilityLock, commitEventAvailabilityLock } from "@/lib/event-availability-lock"
import { ApiAuthError, isApiAuthError, requireBackofficeUser } from "@/lib/server-auth"
import {
  bookingCoversAvailabilityDate,
  bookingMatchesAvailabilitySpace,
  getAvailabilityDates,
  maintenanceCoversAvailabilityDate,
  maintenanceMatchesAvailabilitySpace,
  officeRentalBlocksAvailability,
  officeRentalMatchesAvailabilitySpace,
  isAvailabilityBlockingOfficeRental,
  isAvailabilityBlockingOfficeBooking,
  type AvailabilityRecord,
} from "@/src/modules/shared/lib/availability"
import { isAvailabilityBlockingBooking } from "@/src/modules/shared/lib/booking-helpers"
import { ambiguousResourceAffectsSpace, unresolvedResourceAffectsSpace, getCatalogAvailabilitySpace } from "@/src/modules/shared/lib/resource-identity"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const MAX_DATES = 180
const MAX_DELETIONS = 500
const resourceId = z.string().trim().min(1).max(128).refine((id) => !id.includes("/") && id !== "." && id !== "..")
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
})
const recordSchema = z.object({
  type: z.enum(["venue", "office"]),
  scope: z.enum(["venue", "room", "building"]),
  venueId: resourceId.optional(),
  officeId: resourceId.optional(),
  spaceId: resourceId,
  date: calendarDate,
  startDate: calendarDate.optional(),
  endDate: calendarDate.optional(),
  reason: z.string().trim().max(2000).optional(),
}).strict()

async function readBody(request: NextRequest): Promise<unknown> {
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > 128 * 1024) {
    throw new ApiAuthError(413, "The maintenance request is too large.")
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiAuthError(400, "Invalid JSON in request body.")
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireBackofficeUser(request, { permission: "bookings" })
    const parsed = z.object({ records: z.array(recordSchema).min(1).max(MAX_DATES) }).strict().safeParse(await readBody(request))
    if (!parsed.success) throw new ApiAuthError(400, "Provide valid maintenance records with an explicit resource scope and calendar dates.")

    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date())
    let totalDates = 0
    const inputs = parsed.data.records.map((record) => {
      const start = record.startDate || record.date
      const end = record.endDate || start
      if (start !== record.date || start < today || end < start
        || (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 >= MAX_DATES) {
        throw new ApiAuthError(400, `Maintenance must start today or later and cover at most ${MAX_DATES} days.`)
      }
      const dates = getAvailabilityDates(start, end)
      totalDates += dates.length
      if (totalDates > MAX_DATES) throw new ApiAuthError(400, `Select at most ${MAX_DATES} maintenance days per request.`)
      return { id: `maint_${randomUUID()}`, record, dates, start, end }
    })

    const firestore = getAdminFirestore()
    const records = await firestore.runTransaction(async (transaction) => {
      const catalogSnapshot = await transaction.get(firestore.collection("cms").doc("data"))
      if (!catalogSnapshot.exists) throw new ApiAuthError(503, "The resource catalog is temporarily unavailable.")
      const catalog = catalogSnapshot.data() as Record<string, unknown>
      const now = new Date().toISOString()
      const proposed = inputs.map(({ id: maintenanceId, record, dates, start, end }) => {
        const isOffice = record.type === "office"
        const id = isOffice ? record.officeId : record.venueId
        if (!id || (isOffice
          ? record.scope === "venue" || (record.venueId && record.venueId !== id)
            || (record.scope === "building" ? record.spaceId !== id : record.spaceId === id)
          : record.scope !== "venue" || record.officeId !== undefined || record.spaceId !== id)) {
          throw new ApiAuthError(400, "The maintenance scope and resource IDs do not match.")
        }
        const entries = catalog[isOffice ? "offices" : "venues"]
        const item = Array.isArray(entries) ? entries.find((entry) => entry && entry.id === id) : null
        const room = isOffice && record.scope === "room" && Array.isArray(item?.rooms)
          ? item.rooms.find((entry: Record<string, unknown>) => entry?.id === record.spaceId)
          : null
        const space = getCatalogAvailabilitySpace(catalog, record.type, id,
          record.scope === "room" ? record.spaceId : undefined, record.scope === "building")
        if (!space || !item || item.isArchived === true || (record.scope === "room" && (!room || room.isArchived === true))) {
          throw new ApiAuthError(400, "Select an existing, non-archived venue, office building, or room.")
        }
        const data = {
          type: record.type,
          scope: record.scope,
          venueId: space.venueId,
          officeId: isOffice ? id : "",
          spaceId: record.spaceId,
          spaceName: space.roomName ? `${space.name} - ${space.roomName}` : space.name,
          venueName: isOffice ? "" : space.name,
          officeName: isOffice ? space.name : "",
          roomName: space.roomName || "",
          date: start,
          startDate: start,
          endDate: end,
          reason: record.reason || "",
          status: "active",
          createdAt: now,
          updatedAt: now,
          createdBy: user.uid,
          createdByName: user.fullName || user.uid,
          updatedBy: user.uid,
          updatedByName: user.fullName || user.uid,
        }
        return { id: maintenanceId, data, dates, space }
      })

      const lockInputs = new Map<string, { space: typeof proposed[number]["space"]; date: string }>()
      for (const { space, dates } of proposed) {
        for (const date of dates) {
          // All rooms share the building's all-dates lock; venues lock every covered day.
          const key = JSON.stringify(space.category === "office" ? ["office", space.officeId] : ["venue", space.venueId, date])
          lockInputs.set(key, { space, date })
        }
      }
      const locks = await Promise.all([...lockInputs.values()].map(({ space, date }) => (
        readResourceAvailabilityLock(transaction, firestore, space, date)
      )))
      // Unordered full reads retain legacy rows without createdAt or canonical ID fields.
      const [bookingSnapshot, maintenanceSnapshot, rentalSnapshot] = await Promise.all([
        transaction.get(firestore.collection("bookings")),
        transaction.get(firestore.collection("maintenanceRecords")),
        proposed.some(({ space }) => space.category === "office") ? transaction.get(firestore.collection("officeRentals")) : null,
      ])
      const needsIdentityReview = (record: AvailabilityRecord, space: typeof proposed[number]["space"], kind: "booking" | "maintenance" | "rental") =>
        ambiguousResourceAffectsSpace(catalog, record, space, kind) || unresolvedResourceAffectsSpace(catalog, record, space, kind)
      const { bookings, expiredBookings } = await evaluateAvailabilityHolds(firestore,
        bookingSnapshot.docs.map((document) => ({ ...document.data(), id: document.id }) as AvailabilityRecord)
          .filter((record) => proposed.some(({ space, dates }) => (space.category === "office" || dates.some((date) => bookingCoversAvailabilityDate(record, date)))
            && (bookingMatchesAvailabilitySpace(record, space) || needsIdentityReview(record, space, "booking")))), transaction)
      const maintenance = maintenanceSnapshot.docs.map((document) => ({ ...document.data(), id: document.id }) as AvailabilityRecord)
      const rentals = rentalSnapshot?.docs.map((document) => document.data() as AvailabilityRecord) || []
      for (const { id, data, dates, space } of proposed) {
        const blockingBooking = (record: AvailabilityRecord) => space.category === "office"
          ? isAvailabilityBlockingOfficeBooking(record)
          : isAvailabilityBlockingBooking(record) && dates.some((date) => bookingCoversAvailabilityDate(record, date))
        if (bookings.some((record) => blockingBooking(record)
          && needsIdentityReview(record, space, "booking"))
          || maintenance.some((record) => dates.some((date) => maintenanceCoversAvailabilityDate(record, date))
            && needsIdentityReview(record, space, "maintenance"))
          || rentals.some((record) => isAvailabilityBlockingOfficeRental(record)
            && dates.some((date) => officeRentalBlocksAvailability(record, date))
            && needsIdentityReview(record, space, "rental"))) {
          throw new ApiAuthError(409, "An ambiguous or unresolved legacy schedule reference affects this resource. Resolve its resource ID before scheduling maintenance.")
        }
        if (maintenance.some((existing) => existing.id === id || (maintenanceMatchesAvailabilitySpace(existing, space)
          && dates.some((date) => maintenanceCoversAvailabilityDate(existing, date))))) {
          throw new ApiAuthError(409, "Maintenance already blocks one or more selected dates for this resource.")
        }
        if (bookings.some((booking) => blockingBooking(booking) && bookingMatchesAvailabilitySpace(booking, space))
          || (space.category === "office" && rentals.some((rental) => officeRentalMatchesAvailabilitySpace(rental, space)
            && dates.some((date) => officeRentalBlocksAvailability(rental, date))))) {
          throw new ApiAuthError(409, "A booking or office rental overlaps the selected maintenance dates. Existing reservations were not changed.")
        }
        maintenance.push({ ...data, id })
      }

      // Complete every read and conflict check before writing any part of the batch.
      locks.forEach((lock) => commitEventAvailabilityLock(transaction, lock))
      commitExpiredAvailabilityHolds(transaction, firestore, expiredBookings)
      proposed.forEach(({ id, data }) => transaction.create(firestore.collection("maintenanceRecords").doc(id), data))
      return proposed.map(({ id, data }) => ({ ...data, id }))
    })
    return NextResponse.json({ records }, { status: 201 })
  } catch (error: unknown) {
    if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("[POST /api/maintenance]", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json({ error: "Unable to save maintenance. Please try again." }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireBackofficeUser(request, { permission: "bookings" })
    const parsed = z.object({ ids: z.array(resourceId).min(1).max(MAX_DELETIONS) }).strict().safeParse(await readBody(request))
    if (!parsed.success || new Set(parsed.data.ids).size !== parsed.data.ids.length) {
      throw new ApiAuthError(400, `Specify between 1 and ${MAX_DELETIONS} distinct maintenance record IDs. Filter larger selections before deleting.`)
    }
    const ids = parsed.data.ids
    const firestore = getAdminFirestore()
    await firestore.runTransaction(async (transaction) => {
      const refs = ids.map((id) => firestore.collection("maintenanceRecords").doc(id))
      const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
      if (snapshots.some((snapshot) => !snapshot.exists)) throw new ApiAuthError(404, "A selected maintenance record no longer exists. Refresh and try again.")
      // Removal only releases availability. It also permits cleanup of unresolvable legacy resources.
      refs.forEach((ref) => transaction.delete(ref))
    })
    return NextResponse.json({ ids })
  } catch (error: unknown) {
    if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("[DELETE /api/maintenance]", error instanceof Error ? error.message : "Unknown error")
    return NextResponse.json({ error: "Unable to remove maintenance. Please try again." }, { status: 500 })
  }
}
