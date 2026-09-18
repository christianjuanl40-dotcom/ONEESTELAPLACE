import { describe, expect, it } from "vitest"
import { hasActiveModificationRequest } from "../booking-helpers"

describe("modification request state", () => {
  it("recognizes each active modification representation", () => {
    expect(hasActiveModificationRequest({ status: "modification_under_review" })).toBe(true)
    expect(hasActiveModificationRequest({ bookingStatus: "Modification Under Review" })).toBe(true)
    expect(hasActiveModificationRequest({ modificationStatus: "Under Review" })).toBe(true)
    expect(hasActiveModificationRequest({ modificationRequested: true })).toBe(true)
    expect(hasActiveModificationRequest({ modificationUnderReview: true })).toBe(true)
    expect(hasActiveModificationRequest({ modifyRequestStatus: "Pending" })).toBe(true)
  })

  it("does not block a booking after an explicit modification decision", () => {
    expect(
      hasActiveModificationRequest({
        status: "confirmed",
        bookingStatus: "Confirmed",
        modificationStatus: "Approved",
        modificationRequested: true,
        modificationUnderReview: true,
        modifyRequestStatus: "Pending",
      }),
    ).toBe(false)
    expect(
      hasActiveModificationRequest({
        status: "confirmed",
        modificationStatus: "Declined",
        modificationUnderReview: true,
        modifyRequestStatus: "Pending",
      }),
    ).toBe(false)
  })

  it("uses the canonical booking status to repair stale request aliases", () => {
    expect(
      hasActiveModificationRequest({
        status: "confirmed",
        bookingStatus: "Confirmed",
        modificationStatus: "Under Review",
        modificationRequested: true,
        modificationUnderReview: true,
        modifyRequestStatus: "Pending",
      }),
    ).toBe(false)
  })
})
