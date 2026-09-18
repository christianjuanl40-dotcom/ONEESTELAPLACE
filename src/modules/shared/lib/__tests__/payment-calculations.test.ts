import { describe, it, expect } from "vitest"
import {
  calculatePaymentSummary,
  getPaymentRecordCreditedAmount,
  getRecordsForBooking,
  isAcceptedPaymentRecord,
  isIncompletePaymentRecord,
  isRejectedPaymentRecord,
  isPendingPaymentRecord,
  type BookingLike,
  type PaymentRecordLike,
} from "../payment-calculations"

function makeBooking(overrides: Partial<BookingLike> = {}): BookingLike {
  return {
    id: "BK001",
    totalPrice: 15000,
    totalAmount: 15000,
    paymentType: "downpayment",
    selectedDownpaymentAmount: 7500,
    downPaymentPercentage: 50,
    downpaymentPaid: 0,
    amountPaid: 0,
    paymentStatus: "pending",
    ...overrides,
  }
}

function makeRecord(overrides: Partial<PaymentRecordLike> = {}): PaymentRecordLike {
  return {
    id: "PR001",
    bookingId: "BK001",
    status: "for_review",
    amount: 7500,
    submittedAt: "2026-08-23T10:00:00Z",
    ...overrides,
  }
}

describe("TEST 1 — Normal downpayment: ₱7,500 submitted, ₱7,500 verified", () => {
  const booking = makeBooking()
  const records = [
    makeRecord({ status: "verified", amount: 7500 }),
  ]

  it("overall status is partial", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("partial")
  })

  it("downpayment is complete", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.downpaymentComplete).toBe(true)
  })

  it("remaining balance is ₱7,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingBalance).toBe(7500)
  })

  it("remaining downpayment is ₱0", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingDownpayment).toBe(0)
  })

  it("accepted verified total is ₱7,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.acceptedVerifiedTotal).toBe(7500)
  })

  it("money received total is ₱7,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.moneyReceivedTotal).toBe(7500)
  })

  it("fully paid is false", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.fullyPaid).toBe(false)
  })
})

describe("TEST 2 — Incomplete downpayment: ₱7,500 submitted, ₱5,500 received", () => {
  const booking = makeBooking()
  const records = [
    makeRecord({ status: "incomplete", amount: 7500, amountReceived: 5500, amountPaid: 5500 }),
  ]

  it("overall status is incomplete", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("incomplete")
  })

  it("downpayment is NOT complete", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.downpaymentComplete).toBe(false)
  })

  it("remaining downpayment is ₱2,000", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingDownpayment).toBe(2000)
  })

  it("accepted verified total is ₱0", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.acceptedVerifiedTotal).toBe(0)
  })

  it("money received total is ₱5,500 (incomplete amount received credited)", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.moneyReceivedTotal).toBe(5500)
  })

  it("incomplete record credits ₱5,500", () => {
    const record = makeRecord({ status: "incomplete", amount: 7500, amountReceived: 5500, amountPaid: 5500 })
    expect(getPaymentRecordCreditedAmount(record)).toBe(5500)
  })

  it("incomplete record is NOT accepted", () => {
    const record = makeRecord({ status: "incomplete", amount: 7500 })
    expect(isAcceptedPaymentRecord(record)).toBe(false)
  })

  it("incomplete record is NOT pending", () => {
    const record = makeRecord({ status: "incomplete", amount: 7500 })
    expect(isPendingPaymentRecord(record)).toBe(false)
  })
})

describe("Authoritative record edge cases", () => {
  it("matches records by booking id or booking code", () => {
    const records = [
      makeRecord({ id: "BY_ID", bookingId: "BK001" }),
      makeRecord({ id: "BY_CODE", bookingId: "other", bookingCode: "bk001" }),
      makeRecord({ id: "OTHER", bookingId: "BK999" }),
    ]

    expect(getRecordsForBooking(records, " BK001 ").map((record) => record.id)).toEqual([
      "BY_ID",
      "BY_CODE",
    ])
  })

  it("does not let stale booking fields override a partial payment history", () => {
    const booking = makeBooking({
      amountPaid: 15000,
      remainingBalance: 0,
      paymentStatus: "paid",
    })
    const summary = calculatePaymentSummary(booking, [
      makeRecord({ status: "verified", amount: 7500 }),
    ])

    expect(summary.moneyReceivedTotal).toBe(7500)
    expect(summary.remainingBalance).toBe(7500)
    expect(summary.overallStatus).toBe("partial")
  })

  it("clamps overpayment to the booking total for displayed money and balance", () => {
    const summary = calculatePaymentSummary(makeBooking(), [
      makeRecord({ status: "verified", amount: 17000 }),
    ])

    expect(summary.moneyReceivedTotal).toBe(15000)
    expect(summary.remainingBalance).toBe(0)
    expect(summary.fullyPaid).toBe(true)
    expect(summary.overallStatus).toBe("completed")
  })

  it("does not treat a pending paymentAmount as money paid on a legacy booking", () => {
    const summary = calculatePaymentSummary(
      makeBooking({ amountPaid: 0, paymentAmount: 7500, paymentStatus: "for_review" }),
      [],
    )

    expect(summary.moneyReceivedTotal).toBe(0)
    expect(summary.remainingBalance).toBe(15000)
    expect(summary.overallStatus).toBe("for_review")
  })

  it("does not treat paymentAmount as cumulative legacy money without acceptance", () => {
    const summary = calculatePaymentSummary(
      makeBooking({ amountPaid: undefined, paidAmount: undefined, paymentAmount: 7500, paymentStatus: "pending" }),
      [],
    )

    expect(summary.moneyReceivedTotal).toBe(0)
    expect(summary.remainingBalance).toBe(15000)
  })

  it("uses an accepted legacy paymentAmount when amountPaid is still zero", () => {
    const summary = calculatePaymentSummary(
      makeBooking({ amountPaid: 0, paymentAmount: 7500, paymentStatus: "paid" }),
      [],
    )

    expect(summary.moneyReceivedTotal).toBe(7500)
    expect(summary.overallStatus).toBe("partial")
  })

  it("supports older verified records that only stored amountPaid", () => {
    const summary = calculatePaymentSummary(makeBooking(), [
      makeRecord({ status: "verified", amount: undefined, amountPaid: 7500 }),
    ])

    expect(summary.acceptedVerifiedTotal).toBe(7500)
    expect(summary.remainingBalance).toBe(7500)
  })

  it("keeps legacy downpayment fields internally consistent", () => {
    const summary = calculatePaymentSummary(
      makeBooking({ amountPaid: 0, downpaymentPaid: 7500 }),
      [],
    )

    expect(summary.moneyReceivedTotal).toBe(7500)
    expect(summary.remainingBalance).toBe(7500)
    expect(summary.overallStatus).toBe("partial")
  })
})

describe("TEST 3 — Complete incomplete downpayment: ₱5,500 incomplete + ₱2,000 verified", () => {
  const booking = makeBooking()
  const records = [
    makeRecord({ id: "PR001", status: "incomplete", amount: 7500, amountReceived: 5500, amountPaid: 5500, submittedAt: "2026-08-20T10:00:00Z" }),
    makeRecord({ id: "PR002", status: "verified", amount: 2000, submittedAt: "2026-08-23T10:00:00Z" }),
  ]

  it("overall status is partial", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("partial")
  })

  it("downpayment is complete (5500 + 2000 = 7500)", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.downpaymentComplete).toBe(true)
  })

  it("remaining downpayment is ₱0", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingDownpayment).toBe(0)
  })

  it("accepted verified total is ₱2,000", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.acceptedVerifiedTotal).toBe(2000)
  })

  it("money received total is ₱7,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.moneyReceivedTotal).toBe(7500)
  })

  it("remaining balance is ₱7,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingBalance).toBe(7500)
  })

  it("fully paid is false", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.fullyPaid).toBe(false)
  })
})

describe("TEST 4 — Rejected payment: ₱7,500 submitted, rejected", () => {
  const booking = makeBooking()
  const records = [
    makeRecord({ status: "rejected", amount: 7500 }),
  ]

  it("overall status is rejected", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("rejected")
  })

  it("accepted verified total is ₱0", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.acceptedVerifiedTotal).toBe(0)
  })

  it("money received total is ₱0", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.moneyReceivedTotal).toBe(0)
  })

  it("downpayment is NOT complete", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.downpaymentComplete).toBe(false)
  })

  it("rejected record credits ₱0", () => {
    const record = makeRecord({ status: "rejected", amount: 7500 })
    expect(getPaymentRecordCreditedAmount(record)).toBe(0)
  })

  it("rejected record is NOT accepted", () => {
    const record = makeRecord({ status: "rejected", amount: 7500 })
    expect(isAcceptedPaymentRecord(record)).toBe(false)
  })
})

describe("TEST 5 — Incomplete settlement: downpayment verified, settlement incomplete (₱5,500 of ₱7,500)", () => {
  const booking = makeBooking()
  const records = [
    makeRecord({ id: "PR001", status: "verified", amount: 7500, submittedAt: "2026-08-20T10:00:00Z" }),
    makeRecord({ id: "PR002", status: "incomplete", amount: 7500, amountReceived: 5500, amountPaid: 5500, submittedAt: "2026-08-23T10:00:00Z" }),
  ]

  it("overall status is partial", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("partial")
  })

  it("downpayment is complete (7500 verified + 5500 incomplete = 13000 >= 7500)", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.downpaymentComplete).toBe(true)
  })

  it("remaining balance is ₱2,000", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingBalance).toBe(2000)
  })

  it("remaining downpayment is ₱0 (already complete)", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingDownpayment).toBe(0)
  })

  it("money received total is ₱13,000", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.moneyReceivedTotal).toBe(13000)
  })
})

describe("TEST 6 — Full payment: ₱7,500 downpayment + ₱7,500 settlement = ₱15,000", () => {
  const booking = makeBooking()
  const records = [
    makeRecord({ id: "PR001", status: "verified", amount: 7500, submittedAt: "2026-08-20T10:00:00Z" }),
    makeRecord({ id: "PR002", status: "verified", amount: 7500, submittedAt: "2026-08-23T10:00:00Z" }),
  ]

  it("overall status is completed", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("completed")
  })

  it("fully paid is true", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.fullyPaid).toBe(true)
  })

  it("remaining balance is ₱0", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingBalance).toBe(0)
  })

  it("remaining downpayment is ₱0", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingDownpayment).toBe(0)
  })
})

describe("TEST 7 — Failed payment after partial: ₱7,500 verified + ₱2,000 rejected", () => {
  const booking = makeBooking()
  const records = [
    makeRecord({ id: "PR001", status: "verified", amount: 7500, submittedAt: "2026-08-20T10:00:00Z" }),
    makeRecord({ id: "PR002", status: "rejected", amount: 2000, submittedAt: "2026-08-23T10:00:00Z" }),
  ]

  it("overall status remains partial", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("partial")
  })

  it("remaining balance is ₱7,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingBalance).toBe(7500)
  })

  it("downpayment remains complete", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.downpaymentComplete).toBe(true)
  })

  it("accepted verified total is ₱7,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.acceptedVerifiedTotal).toBe(7500)
  })

  it("money received total is ₱7,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.moneyReceivedTotal).toBe(7500)
  })
})

describe("TEST 8 — Multiple payments: ₱5,500 verified + ₱2,000 verified + ₱1,000 rejected + ₱1,000 verified", () => {
  const booking = makeBooking()
  const records = [
    makeRecord({ id: "PR001", status: "verified", amount: 5500, submittedAt: "2026-08-18T10:00:00Z" }),
    makeRecord({ id: "PR002", status: "verified", amount: 2000, submittedAt: "2026-08-20T10:00:00Z" }),
    makeRecord({ id: "PR003", status: "rejected", amount: 1000, submittedAt: "2026-08-22T10:00:00Z" }),
    makeRecord({ id: "PR004", status: "verified", amount: 1000, submittedAt: "2026-08-23T10:00:00Z" }),
  ]

  it("overall status is partial", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("partial")
  })

  it("accepted verified total is ₱8,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.acceptedVerifiedTotal).toBe(8500)
  })

  it("remaining balance is ₱6,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.remainingBalance).toBe(6500)
  })

  it("downpayment is complete (8500 >= 7500)", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.downpaymentComplete).toBe(true)
  })

  it("rejected ₱1,000 contributes ₱0", () => {
    const record = makeRecord({ status: "rejected", amount: 1000 })
    expect(getPaymentRecordCreditedAmount(record)).toBe(0)
    expect(isAcceptedPaymentRecord(record)).toBe(false)
  })

  it("money received total is ₱8,500", () => {
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.moneyReceivedTotal).toBe(8500)
  })
})

describe("Downpayment detail ledger", () => {
  it("does not count a pending downpayment or reduce its remaining balance", () => {
    const summary = calculatePaymentSummary(makeBooking(), [
      makeRecord({ status: "For Verification", term: "Down Payment", amount: 2000 }),
    ])

    expect(summary.verifiedDownpaymentPaid).toBe(0)
    expect(summary.remainingVerifiedDownpayment).toBe(7500)
  })

  it("counts a verified downpayment and reduces its remaining balance", () => {
    const summary = calculatePaymentSummary(makeBooking(), [
      makeRecord({ status: "Verified", term: "Down Payment", amount: 2000 }),
    ])

    expect(summary.verifiedDownpaymentPaid).toBe(2000)
    expect(summary.remainingVerifiedDownpayment).toBe(5500)
  })

  it("does not count an incomplete payment toward Total DP Paid", () => {
    const summary = calculatePaymentSummary(makeBooking(), [
      makeRecord({
        status: "Incomplete",
        term: "Down Payment",
        amount: 7500,
        amountPaid: 5500,
        amountReceived: 5500,
      }),
    ])

    expect(summary.verifiedDownpaymentPaid).toBe(0)
    expect(summary.remainingVerifiedDownpayment).toBe(7500)
    expect(summary.downpaymentCreditedTotal).toBe(5500)
  })

  it("does not count a rejected payment toward Total DP Paid", () => {
    const summary = calculatePaymentSummary(makeBooking(), [
      makeRecord({ status: "Rejected", term: "Down Payment", amount: 2000 }),
    ])

    expect(summary.verifiedDownpaymentPaid).toBe(0)
    expect(summary.remainingVerifiedDownpayment).toBe(7500)
  })

  it("sums multiple verified downpayments without counting a later balance payment", () => {
    const summary = calculatePaymentSummary(makeBooking(), [
      makeRecord({ id: "DP001", status: "Verified", term: "Down Payment", amount: 3000 }),
      makeRecord({ id: "DP002", status: "Verified", term: "Down Payment", amount: 2000 }),
      makeRecord({ id: "BAL001", status: "Verified", term: "Full Payment", amount: 7500 }),
    ])

    expect(summary.verifiedDownpaymentPaid).toBe(5000)
    expect(summary.remainingVerifiedDownpayment).toBe(2500)
    expect(summary.acceptedVerifiedTotal).toBe(12500)
  })
})

describe("Edge cases", () => {
  it("for_review record has ₱0 credit and is pending", () => {
    const record = makeRecord({ status: "for_review", amount: 7500 })
    expect(getPaymentRecordCreditedAmount(record)).toBe(0)
    expect(isPendingPaymentRecord(record)).toBe(true)
    expect(isAcceptedPaymentRecord(record)).toBe(false)
  })

  it("incomplete record with no amountReceived falls back to submitted amount", () => {
    const record = makeRecord({ status: "incomplete", amount: 7500, amountReceived: undefined })
    expect(getPaymentRecordCreditedAmount(record)).toBe(7500)
  })

  it("incomplete record with amountReceived=0 falls back to submitted amount", () => {
    const record = makeRecord({ status: "incomplete", amount: 7500, amountReceived: 0 })
    expect(getPaymentRecordCreditedAmount(record)).toBe(7500)
  })

  it("full payment booking (no downpayment) completes when total is paid", () => {
    const booking = makeBooking({
      paymentType: "full",
      selectedDownpaymentAmount: 0,
      downPaymentPercentage: 0,
    })
    const records = [
      makeRecord({ status: "verified", amount: 15000 }),
    ]
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("completed")
    expect(summary.fullyPaid).toBe(true)
    expect(summary.downpaymentComplete).toBe(true)
    expect(summary.remainingBalance).toBe(0)
  })

  it("booking with no payment records falls back to legacy fields", () => {
    const booking = makeBooking({ amountPaid: 7500, downpaymentPaid: 7500 })
    const summary = calculatePaymentSummary(booking, [])
    expect(summary.overallStatus).toBe("partial")
    expect(summary.downpaymentComplete).toBe(true)
    expect(summary.remainingBalance).toBe(7500)
  })

  it("priority: PARTIAL over FOR_REVIEW when downpayment is complete", () => {
    const booking = makeBooking()
    const records = [
      makeRecord({ id: "PR001", status: "verified", amount: 7500, submittedAt: "2026-08-20T10:00:00Z" }),
      makeRecord({ id: "PR002", status: "for_review", amount: 3000, submittedAt: "2026-08-23T10:00:00Z" }),
    ]
    const summary = calculatePaymentSummary(booking, records)
    expect(summary.overallStatus).toBe("partial")
    expect(summary.hasPendingSubmission).toBe(true)
  })
})
