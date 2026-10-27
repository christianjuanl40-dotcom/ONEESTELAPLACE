import "server-only"

import { createHash } from "node:crypto"
import type { AvailabilitySpace } from "@/src/modules/shared/lib/availability"

export type EventAvailabilityLock = {
  ref: FirebaseFirestore.DocumentReference
  revision: number
  venueId: string
  date: string
}

/** All event schedule writers contend on the same venue/date document, even
 * when their booking queries are empty. Read before any transaction writes. */
export async function readEventAvailabilityLock(
  transaction: FirebaseFirestore.Transaction,
  firestore: FirebaseFirestore.Firestore,
  venueId: string,
  date: string,
): Promise<EventAvailabilityLock> {
  const key = createHash("sha256").update(JSON.stringify([venueId, date])).digest("hex")
  const ref = firestore.collection("eventAvailabilityLocks").doc(key)
  const snapshot = await transaction.get(ref)
  return { ref, revision: Number(snapshot.data()?.revision || 0), venueId, date }
}

/** Office terms and building-wide maintenance contend across every date and room.
 * Events retain the shipped venue/date lock shared with schedule modifications. */
export async function readResourceAvailabilityLock(
  transaction: FirebaseFirestore.Transaction,
  firestore: FirebaseFirestore.Firestore,
  space: AvailabilitySpace,
  date: string,
): Promise<EventAvailabilityLock> {
  return readEventAvailabilityLock(transaction, firestore,
    space.category === "office" ? `office:${space.officeId || space.venueId}` : space.venueId,
    space.category === "office" ? "all-dates" : date)
}

export function commitEventAvailabilityLock(
  transaction: FirebaseFirestore.Transaction,
  lock: EventAvailabilityLock | undefined,
) {
  if (lock) transaction.set(lock.ref, {
    venueId: lock.venueId, date: lock.date, revision: lock.revision + 1,
  })
}
