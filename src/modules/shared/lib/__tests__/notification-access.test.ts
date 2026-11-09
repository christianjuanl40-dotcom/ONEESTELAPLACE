import { describe, expect, it } from "vitest"
import { getAdminNotificationTypes } from "../notification-access"
import firestoreIndexes from "../../../../../firestore.indexes.json"

describe("admin notification access", () => {
  it("leaves the full notification stream available to administrators", () => {
    expect(getAdminNotificationTypes("admin")).toBeNull()
  })

  it("limits booking staff to booking-related notifications", () => {
    expect(getAdminNotificationTypes("staff", { bookings: true })).toEqual([
      "booking_submitted",
      "cancellation_requested",
      "modification_requested",
      "refund_requested",
    ])
  })

  it("does not give dashboard-only staff access to internal refund requests", () => {
    expect(getAdminNotificationTypes("staff", { dashboard: true })).toEqual([
      "booking_submitted",
      "cancellation_requested",
      "modification_requested",
    ])
  })

  it("limits payment staff to payment-related notifications", () => {
    expect(getAdminNotificationTypes("staff", { payments: true })).toEqual([
      "payment_submitted",
      "remaining_balance_submitted",
    ])
  })

  it("does not create an admin stream for unrelated staff permissions", () => {
    expect(getAdminNotificationTypes("staff", {})).toEqual([])
  })

  it("declares the ordered staff type-filter notification index", () => {
    const index = firestoreIndexes.indexes.find((candidate) => (
      candidate.collectionGroup === "notifications"
      && candidate.fields.map((field) => field.fieldPath).join(",") === "userId,type,createdAt"
    ))
    expect(index).toMatchObject({
      collectionGroup: "notifications",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "type", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
      ],
    })
  })
})
