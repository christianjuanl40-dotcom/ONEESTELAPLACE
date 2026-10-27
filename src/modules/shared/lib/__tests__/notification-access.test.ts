import { describe, expect, it } from "vitest"
import { getAdminNotificationTypes } from "../notification-access"

describe("admin notification access", () => {
  it("leaves the full notification stream available to administrators", () => {
    expect(getAdminNotificationTypes("admin")).toBeNull()
  })

  it("limits booking staff to booking-related notifications", () => {
    expect(getAdminNotificationTypes("staff", { bookings: true })).toEqual([
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
})
