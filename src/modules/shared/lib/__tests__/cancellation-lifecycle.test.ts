import { describe, expect, it } from "vitest"
import {
  bookingBelongsToUser,
  buildCancellationApprovalFields,
  buildCancellationDeclineFields,
  buildCancellationRequestFields,
  evaluateCancellationEligibility,
  hasPendingCancellation,
} from "../cancellation"

const now = new Date(2026, 8, 16, 12, 0, 0)
const reviewedAt = now.toISOString()

function makeBooking() {
  return {
    id: "BK55",
    userId: "client-1",
    status: "confirmed",
    bookingStatus: "Confirmed",
    paymentStatus: "paid",
    isSlotSecured: true,
    amountPaid: 5000,
    totalPrice: 10000,
    date: "2026-10-01",
    cancellationRequested: false,
    cancellationStatus: "None",
    refundStatus: "Not Applicable",
    refundEligible: false,
  }
}

describe("cancellation lifecycle", () => {
  it("allows only the booking owner to act on a booking", () => {
    const booking = makeBooking()

    expect(bookingBelongsToUser(booking, "client-1")).toBe(true)
    expect(bookingBelongsToUser(booking, "another-client")).toBe(false)
  })

  it("persists a pending request without changing refund fields", () => {
    const booking = makeBooking()
    const eligibility = evaluateCancellationEligibility(booking, now)
    const fields = buildCancellationRequestFields(booking, "Schedule changed", reviewedAt)

    expect(eligibility.allowed).toBe(true)
    expect(fields.status).toBe("cancellation_requested")
    expect(fields.cancellationRequested).toBe(true)
    expect(fields.cancellationStatus).toBe("Pending")
    expect(fields.cancellationRequestedAt).toBe(reviewedAt)
    expect(fields.cancellationReason).toBe("Schedule changed")
    expect(fields).not.toHaveProperty("refundStatus")
    expect(fields).not.toHaveProperty("refundEligible")
    expect(hasPendingCancellation({ ...booking, ...fields })).toBe(true)
  })

  it("blocks a duplicate pending request", () => {
    const booking = makeBooking()
    expect(
      evaluateCancellationEligibility(
        { ...booking, status: "cancellation_requested", cancellationRequested: true },
        now,
      ).allowed,
    ).toBe(false)
    expect(
      evaluateCancellationEligibility(
        { ...booking, cancellationStatus: "Pending" },
        now,
      ).allowed,
    ).toBe(false)
  })

  it("approves the request and applies refund policy only during admin review", () => {
    const pending = {
      ...makeBooking(),
      ...buildCancellationRequestFields(makeBooking(), "Schedule changed", reviewedAt),
    }
    const fields = buildCancellationApprovalFields(pending, reviewedAt)

    expect(fields.status).toBe("cancelled")
    expect(fields.cancellationStatus).toBe("Approved")
    expect(fields.refundStatus).toBe("eligible")
    expect(fields.refundEligible).toBe(true)
  })

  it("rejects the request and restores the prior booking state", () => {
    const pending = {
      ...makeBooking(),
      ...buildCancellationRequestFields(makeBooking(), "Schedule changed", reviewedAt),
    }
    const fields = buildCancellationDeclineFields(pending, "Date is reserved for maintenance", reviewedAt)

    expect(fields.status).toBe("confirmed")
    expect(fields.bookingStatus).toBe("Confirmed")
    expect(fields.cancellationStatus).toBe("Declined")
    expect(fields.cancellationDeclineReason).toBe("Date is reserved for maintenance")
    expect(fields.refundStatus).toBe("Not Applicable")
  })

  it("does not allow an unsecured or too-near booking to request cancellation", () => {
    const booking = makeBooking()

    expect(
      evaluateCancellationEligibility({ ...booking, isSlotSecured: false, verifiedByAdmin: false }, now).allowed,
    ).toBe(false)
    expect(
      evaluateCancellationEligibility({ ...booking, date: "2026-09-20" }, now).allowed,
    ).toBe(false)
  })
})
