import { describe, expect, it } from "vitest"
import { getPaymentHistoryKey, resolvePaymentReviewNote } from "../payment-review"
import type { PaymentRecordLike } from "../payment-calculations"
import { buildVerifiedPaymentTransition } from "../payment-verification"

const booking = {
  id: "BOOKING-1",
  totalPrice: 10000,
  paymentType: "downpayment",
  selectedDownpaymentAmount: 5000,
  incompletePaymentNote: "Payment 1 was short.",
  incompletePaymentReason: "Payment 1 was short.",
  paymentRejectedReason: "Payment 2 proof was unreadable.",
}

const history: PaymentRecordLike[] = [
  { id: "PAY-1", bookingId: booking.id, status: "Incomplete", amountReceived: 1500, adminNote: "Payment 1 was short." },
  { id: "PAY-2", bookingId: booking.id, status: "Rejected", rejectionReason: "Payment 2 proof was unreadable." },
  { id: "PAY-3", bookingId: booking.id, status: "Verified", amount: 1000, adminNote: "" },
]

describe("submission-scoped review notes", () => {
  it("keeps an empty Payment 3 note empty while earlier notes and booking fields exist", () => {
    expect(resolvePaymentReviewNote(history[2], history)).toBe("")
    expect(resolvePaymentReviewNote({ paymentId: "PAY-3", adminNote: booking.incompletePaymentNote }, history)).toBe("")
  })

  it("gives the authoritative document precedence over a stale receipt projection", () => {
    expect(resolvePaymentReviewNote({ paymentId: "PAY-1", adminNote: "stale receipt note" }, history))
      .toBe("Payment 1 was short.")
    expect(resolvePaymentReviewNote({ paymentId: "PAY-3", adminNote: "stale receipt note" }, [
      { ...history[2], adminNote: undefined },
    ])).toBe("")
  })

  it("resolves identical notes for admin records and client history projections on repeated switches", () => {
    for (const index of [2, 0, 1, 2, 1, 0, 2]) {
      const adminSelected = history[index]
      const clientSelected = { paymentId: adminSelected.id, adminNote: "untrusted projection" }
      const expected = ["Payment 1 was short.", "Payment 2 proof was unreadable.", ""][index]
      expect(resolvePaymentReviewNote(adminSelected, history)).toBe(expected)
      expect(resolvePaymentReviewNote(clientSelected, [...history].reverse())).toBe(expected)
    }
  })

  it("allows a legacy rejection reason only on that record's current rejected state", () => {
    expect(resolvePaymentReviewNote(history[1])).toBe("Payment 2 proof was unreadable.")
    for (const status of ["Verified", "Incomplete", "Pending", "For Verification"]) {
      expect(resolvePaymentReviewNote({ ...history[1], status, adminNote: "" })).toBe("")
    }
    expect(resolvePaymentReviewNote({ ...history[1], verificationStatus: "Verified" })).toBe("")
    expect(resolvePaymentReviewNote({ ...history[1], paymentStatus: "Verified" })).toBe("")
  })

  it("uses a legacy projection's own note only with an explicit payment identity", () => {
    expect(resolvePaymentReviewNote({ paymentId: "LEGACY-PAY", status: "Incomplete", adminNote: "Legacy note" })).toBe("Legacy note")
    expect(resolvePaymentReviewNote({ receiptNumber: "ER-1", adminNote: "Unlinked note" })).toBe("")
    expect(resolvePaymentReviewNote(null, history)).toBe("")
  })

  it("keys payment projections by payment ID and receipt-only legacy entries by receipt identity", () => {
    expect(getPaymentHistoryKey(history[2])).toBe("payment:PAY-3")
    expect(getPaymentHistoryKey({ paymentId: "PAY-3", receiptNumber: "ER-3" })).toBe("payment:PAY-3")
    expect(getPaymentHistoryKey({ receiptNumber: "ER-LEGACY" })).toBe("receipt:ER-LEGACY")
  })

  it("preserves historical payment and booking notes through verification of a later submission", () => {
    const before = structuredClone({ booking, history })
    const pending = { ...history[2], status: "For Verification" }
    const result = buildVerifiedPaymentTransition(booking, [history[0], history[1], pending], pending, {
      verifiedAmount: 1000,
      adminName: "Reviewer",
      adminNote: "",
    })
    expect(result.payment.adminNote).toBe("")
    expect(result.records[0]).toEqual(before.history[0])
    expect(result.records[1]).toEqual(before.history[1])
    expect(result.booking).toMatchObject(booking)
    expect({ booking, history }).toEqual(before)
  })

  it("does not attach a new draft to an already-verified empty note on a retry", () => {
    const result = buildVerifiedPaymentTransition(booking, history, history[2], {
      verifiedAmount: 1000,
      adminName: "Reviewer",
      adminNote: "Unrelated retry draft",
    })
    expect(result.payment.adminNote).toBe("")
    expect(resolvePaymentReviewNote(result.payment, result.records)).toBe("")
  })
})
