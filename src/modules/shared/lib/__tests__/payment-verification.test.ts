import { describe, expect, it } from "vitest"
import {
  buildPaymentDecisionTransition,
  buildVerifiedPaymentTransition,
} from "../payment-verification"
import type { PaymentRecordLike } from "../payment-calculations"

function makeBooking() {
  return {
    id: "BK001",
    totalPrice: 15000,
    paymentType: "downpayment",
    selectedDownpaymentAmount: 7500,
    downPaymentPercentage: 50,
    amountPaid: 0,
    downpaymentPaid: 0,
    status: "verifying",
    bookingStatus: "Pending Verification",
  }
}

function makeRecord(overrides: Partial<PaymentRecordLike> = {}): PaymentRecordLike {
  return {
    id: "PAY001",
    bookingId: "BK001",
    status: "For Verification",
    verificationStatus: "Pending",
    amount: 7500,
    submittedAt: "2026-09-18T10:00:00.000Z",
    ...overrides,
  }
}

describe("authoritative payment verification transition", () => {
  it("moves an unverified downpayment to the existing partial stage", () => {
    const record = makeRecord()
    const result = buildVerifiedPaymentTransition(makeBooking(), [record], record, {
      verifiedAmount: 7500,
      adminName: "Administrator",
      now: "2026-09-18T11:00:00.000Z",
    })

    expect(result.payment.status).toBe("Verified")
    expect(result.summary.acceptedVerifiedTotal).toBe(7500)
    expect(result.summary.overallStatus).toBe("partial")
    expect(result.booking.status).toBe("confirmed")
    expect(result.booking.paymentStatus).toBe("partial")
    expect(result.booking.paymentStage).toBe("Settle Remaining Balance")
  })

  it("is idempotent when the selected payment is already verified", () => {
    const verified = makeRecord({ status: "Verified", verificationStatus: "Verified" })
    const result = buildVerifiedPaymentTransition(makeBooking(), [verified], verified, {
      verifiedAmount: 7500,
      adminName: "Administrator",
    })

    expect(result.alreadyVerified).toBe(true)
    expect(result.summary.acceptedVerifiedTotal).toBe(7500)
    expect(result.summary.moneyReceivedTotal).toBe(7500)
    expect(result.booking.amountPaid).toBe(7500)
  })

  it("does not mark a booking fully paid when verified totals are partial", () => {
    const record = makeRecord({ amount: 3000 })
    const result = buildVerifiedPaymentTransition(makeBooking(), [record], record, {
      verifiedAmount: 3000,
      adminName: "Administrator",
    })

    expect(result.summary.fullyPaid).toBe(false)
    expect(result.summary.remainingBalance).toBe(12000)
    expect(result.booking.status).toBe("verifying")
    expect(result.booking.paymentStatus).toBe("incomplete")
  })

  it("reaches fully paid only after the verified balance payment", () => {
    const first = makeRecord({ id: "PAY001", status: "Verified", verificationStatus: "Verified" })
    const second = makeRecord({
      id: "PAY002",
      amount: 7500,
      submittedAt: "2026-09-19T10:00:00.000Z",
    })
    const result = buildVerifiedPaymentTransition(makeBooking(), [first, second], second, {
      verifiedAmount: 7500,
      adminName: "Administrator",
    })

    expect(result.summary.acceptedVerifiedTotal).toBe(15000)
    expect(result.summary.fullyPaid).toBe(true)
    expect(result.summary.overallStatus).toBe("completed")
    expect(result.booking.status).toBe("confirmed")
    expect(result.booking.paymentStatus).toBe("paid")
    expect(result.booking.paymentStage).toBe("Fully Paid")
  })

  it("keeps an active modification request visible while verifying payment", () => {
    const result = buildVerifiedPaymentTransition(
      {
        ...makeBooking(),
        status: "modification_under_review",
        bookingStatus: "Modification Under Review",
        modificationRequested: true,
        modificationStatus: "Under Review",
      },
      [makeRecord()],
      makeRecord(),
      {
        verifiedAmount: 7500,
        adminName: "Administrator",
      },
    )

    expect(result.booking.status).toBe("modification_under_review")
    expect(result.booking.bookingStatus).toBe("Modification Under Review")
    expect(result.booking.paymentStatus).toBe("partial")
  })

  it("rejects only the selected pending record and preserves the secured booking", () => {
    const verified = makeRecord({
      id: "PAY001",
      status: "Verified",
      verificationStatus: "Verified",
      submittedAt: "2026-09-17T10:00:00.000Z",
    })
    const pending = makeRecord({
      id: "PAY002",
      amount: 3000,
      submittedAt: "2026-09-18T10:00:00.000Z",
    })
    const result = buildPaymentDecisionTransition(
      makeBooking(),
      [verified, pending],
      pending,
      "reject",
      { adminName: "Reviewer", adminNote: "Proof is unreadable.", now: "2026-09-18T11:00:00.000Z" },
    )

    expect(result.payment.status).toBe("Rejected")
    expect(result.summary.acceptedVerifiedTotal).toBe(7500)
    expect(result.summary.remainingBalance).toBe(7500)
    expect(result.booking.status).toBe("confirmed")
    expect(result.booking.isSlotSecured).toBe(true)
    expect(result.booking.paymentStatus).toBe("partial")
    expect(result.booking.paymentReviewedBy).toBe("Reviewer")
  })

  it("credits an incomplete received amount without treating it as accepted", () => {
    const pending = makeRecord({ amount: 7500 })
    const result = buildPaymentDecisionTransition(
      makeBooking(),
      [pending],
      pending,
      "incomplete",
      { verifiedAmount: 5500, adminName: "Reviewer", adminNote: "Short by ₱2,000." },
    )

    expect(result.payment.status).toBe("Incomplete")
    expect(result.payment.amount).toBe(5500)
    expect(result.payment.requestedAmount).toBe(7500)
    expect(result.summary.acceptedVerifiedTotal).toBe(0)
    expect(result.summary.moneyReceivedTotal).toBe(5500)
    expect(result.summary.remainingDownpayment).toBe(2000)
    expect(result.booking.amountPaid).toBe(5500)
    expect(result.booking.remainingBalance).toBe(9500)
    expect(result.booking.status).toBe("verifying")
  })

  it("lets incomplete received money complete the downpayment without counting it as verified", () => {
    const verified = makeRecord({ id: "PAY001", status: "Verified", verificationStatus: "Verified" })
    const pending = makeRecord({ id: "PAY002", amount: 7500, submittedAt: "2026-09-19T10:00:00.000Z" })
    const result = buildPaymentDecisionTransition(
      makeBooking(),
      [verified, pending],
      pending,
      "incomplete",
      { verifiedAmount: 5500, adminName: "Reviewer", adminNote: "Short payment." },
    )

    expect(result.summary.acceptedVerifiedTotal).toBe(7500)
    expect(result.summary.moneyReceivedTotal).toBe(13000)
    expect(result.summary.overallStatus).toBe("partial")
    expect(result.booking.status).toBe("confirmed")
    expect(result.booking.remainingBalance).toBe(2000)
  })
})
