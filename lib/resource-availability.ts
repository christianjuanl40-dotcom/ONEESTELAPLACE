import "server-only"

import { ApiAuthError } from "./server-auth"
import { isAvailabilityBlockingBooking } from "@/src/modules/shared/lib/booking-helpers"
import { ambiguousResourceAffectsSpace, unresolvedResourceAffectsSpace } from "@/src/modules/shared/lib/resource-identity"
import { bookingMatchesAvailabilitySpace, getAvailabilityDateBounds, isAvailabilityBlockingOfficeBooking, isAvailabilityBlockingOfficeRental, type AvailabilityRecord, type AvailabilitySpace } from "@/src/modules/shared/lib/availability"
import { automaticBookingExpiryFields, canAutomaticallyExpireBooking, isHoldExpiryCandidate } from "@/src/modules/shared/lib/booking-lifecycle"
import { AVAILABILITY_READ_FIELDS, AVAILABILITY_PAYMENT_FIELDS } from "@/src/modules/shared/lib/availability-read-fields"
import type { PaymentRecordLike } from "@/src/modules/shared/lib/payment-calculations"

export async function evaluateAvailabilityHolds(
  firestore: FirebaseFirestore.Firestore,
  bookings: AvailabilityRecord[],
  transaction?: FirebaseFirestore.Transaction,
  report?: (stage: string, ms: number, docs?: number) => void,
) {
  const expiredBookings: AvailabilityRecord[] = []
  const effectiveBookings = await Promise.all(bookings.map(async (booking) => {
    if (!booking.id || !isHoldExpiryCandidate(booking)) return booking
    const records = new Map<string, PaymentRecordLike>()
    const ids = [...new Set([booking.id, String(booking.bookingCode || "")].filter(Boolean))]
    const started = performance.now()
    const snapshots = await Promise.all(ids.flatMap(id => ["bookingId", "bookingCode"].map(async field => {
      const query = firestore.collection("payments").where(field, "==", id)
      return transaction ? transaction.get(query) : query.select(...AVAILABILITY_PAYMENT_FIELDS).get()
    })))
    for (const snapshot of snapshots) {
      snapshot.docs.forEach((document) => records.set(document.id, { ...document.data(), id: document.id }))
    }
    report?.("ledger", performance.now() - started, records.size)
    if (!canAutomaticallyExpireBooking(booking, [...records.values()])) return booking
    expiredBookings.push(booking)
    return { ...booking, ...automaticBookingExpiryFields(booking) }
  }))
  return { bookings: effectiveBookings, expiredBookings }
}

export function commitExpiredAvailabilityHolds(
  transaction: FirebaseFirestore.Transaction,
  firestore: FirebaseFirestore.Firestore,
  expiredBookings: AvailabilityRecord[],
) {
  expiredBookings.forEach((booking) => transaction.update(firestore.collection("bookings").doc(booking.id!), automaticBookingExpiryFields(booking)))
}

/** Legacy rows may have only startDate/names, or no rental dates at all. Until the
 * identity migration is complete, do not silently omit them with an ID/date query. */
export async function readResourceAvailability(
  firestore: FirebaseFirestore.Firestore,
  space: AvailabilitySpace,
  from: string,
  to: string,
  transaction?: FirebaseFirestore.Transaction,
  excludeBookingId = "",
  validateIdentity = true,
  report?: (stage: string, ms: number, docs?: number) => void,
) {
  const read = async (collection: string) => {
    const query = firestore.collection(collection)
    const started = performance.now()
    const snapshot = await (transaction ? transaction.get(query) : query.select(...AVAILABILITY_READ_FIELDS).get())
    report?.(collection, performance.now() - started, snapshot.size)
    return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }) as AvailabilityRecord)
  }
  const bookingsRead = read("bookings")
  const maintenanceRead = read("maintenanceRecords")
  const rentalsRead = space.category === "office" ? read("officeRentals") : Promise.resolve([])
  const overlaps = (record: AvailabilityRecord) => {
    const { start, end } = getAvailabilityDateBounds(record)
    return !start || (start <= to && from <= end)
  }
  const catalog = space.catalog || {}
  const identityNeedsReview = (record: AvailabilityRecord, kind: "booking" | "maintenance" | "rental") =>
    ambiguousResourceAffectsSpace(catalog, record, space, kind) || unresolvedResourceAffectsSpace(catalog, record, space, kind)
  // Office exclusivity is lifecycle-based across ALL dates, including dated
  // legacy leases and reservations outside the requested calendar/term.
  // Ledger checks depend on bookings, not on maintenance/lease reads. Pipeline
  // them instead of adding their network latency after the slowest collection.
  const holdsRead = bookingsRead.then(bookings => evaluateAvailabilityHolds(firestore, bookings.filter((record) => record.id !== excludeBookingId && (space.category === "office" || overlaps(record))
     && (bookingMatchesAvailabilitySpace(record, space) || identityNeedsReview(record, "booking"))), transaction, report))
  const [holds, maintenanceRecords, officeRentals] = await Promise.all([holdsRead, maintenanceRead, rentalsRead])
  const relevantBookings = holds.bookings
  const relevantMaintenance = maintenanceRecords.filter(overlaps)
  const relevantRentals = officeRentals
  if (validateIdentity && (relevantBookings.some((record) => (space.category === "office" ? isAvailabilityBlockingOfficeBooking(record) : isAvailabilityBlockingBooking(record))
    && identityNeedsReview(record, "booking"))
    || relevantMaintenance.some((record) => String(record.status).toLowerCase() === "active"
      && identityNeedsReview(record, "maintenance"))
    || relevantRentals.some((record) => isAvailabilityBlockingOfficeRental(record)
      && identityNeedsReview(record, "rental")))) {
    throw new ApiAuthError(409, "This resource has an ambiguous or unresolved legacy schedule reference. An administrator must resolve its resource ID before scheduling.")
  }
  return { bookings: relevantBookings, maintenanceRecords: relevantMaintenance, officeRentals: relevantRentals, expiredBookings: holds.expiredBookings }
}
