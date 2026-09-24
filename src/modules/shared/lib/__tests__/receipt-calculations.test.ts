import { describe, expect, it } from "vitest"
import {
  calculateReceiptPaymentSummary,
  getReceiptPaymentNumber,
  getReceiptPresentation,
  sortReceiptPaymentRecords,
  type BookingLike,
  type PaymentRecordLike,
} from "../payment-calculations"

const booking: BookingLike = {
  id: "BK-RECEIPT-1",
  totalPrice: 15000,
  totalAmount: 15000,
  paymentType: "downpayment",
  selectedDownpaymentAmount: 7500,
  downPaymentPercentage: 50,
}

function makePayment(overrides: Partial<PaymentRecordLike>): PaymentRecordLike {
  return {
    id: "PAYMENT-1",
    bookingId: "BK-RECEIPT-1",
    paymentNumber: 1,
    term: "Down Payment",
    status: "verified",
    amount: 5500,
    submittedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  }
}

function makeCanonicalPayments(): PaymentRecordLike[] {
  return [
    makePayment({
      id: "PAYMENT-1",
      paymentNumber: 1,
      amount: 5500,
      submittedAt: "2026-09-01T10:00:00.000Z",
    }),
    makePayment({
      id: "PAYMENT-2",
      paymentNumber: 2,
      amount: 2000,
      status: "rejected",
      submittedAt: "2026-09-02T10:00:00.000Z",
    }),
    makePayment({
      id: "PAYMENT-3",
      paymentNumber: 3,
      amount: 2000,
      submittedAt: "2026-09-03T10:00:00.000Z",
    }),
  ]
}

describe("receipt-specific historical calculations", () => {
  it("keeps Payment #1 historical context at ₱5,500", () => {
    const payments = makeCanonicalPayments()
    const presentation = getReceiptPresentation(booking, [...payments].reverse(), payments[0])

    expect(presentation.transaction.paymentNumber).toBe(1)
    expect(presentation.transaction.amount).toBe(5500)
    expect(presentation.transaction.statusLabel).toBe("Verified")
    expect(presentation.transaction.paymentTypeLabel).toBe("Down Payment")
    expect(presentation.summary.totalVerifiedDpPaid).toBe(5500)
    expect(presentation.summary.remainingDp).toBe(2000)
    expect(presentation.summary.remainingBalance).toBe(9500)
  })

  it("does not count the rejected Payment #2 in its own summary", () => {
    const payments = makeCanonicalPayments()
    const presentation = getReceiptPresentation(booking, payments, payments[1])

    expect(presentation.transaction.paymentNumber).toBe(2)
    expect(presentation.transaction.amount).toBe(2000)
    expect(presentation.transaction.statusLabel).toBe("Rejected")
    expect(presentation.summary.totalVerifiedDpPaid).toBe(5500)
    expect(presentation.summary.remainingDp).toBe(2000)
    expect(presentation.summary.remainingBalance).toBe(9500)
  })

  it("includes verified Payment #3 without replacing its transaction amount", () => {
    const payments = makeCanonicalPayments()
    const presentation = getReceiptPresentation(booking, payments, payments[2])

    expect(presentation.transaction.paymentNumber).toBe(3)
    expect(presentation.transaction.amount).toBe(2000)
    expect(presentation.summary.totalVerifiedDpPaid).toBe(7500)
    expect(presentation.summary.remainingDp).toBe(0)
    expect(presentation.summary.remainingBalance).toBe(7500)
  })

  it("keeps a pending transaction amount visible but excludes it from verified totals", () => {
    const payments = [
      ...makeCanonicalPayments(),
      makePayment({
        id: "PAYMENT-4",
        paymentNumber: 4,
        amount: 1000,
        status: "for_review",
        submittedAt: "2026-09-04T10:00:00.000Z",
      }),
    ]
    const presentation = getReceiptPresentation(booking, payments, payments[3])

    expect(presentation.transaction.amount).toBe(1000)
    expect(presentation.transaction.statusLabel).toBe("For Review")
    expect(presentation.summary.totalVerifiedDpPaid).toBe(7500)
    expect(presentation.summary.remainingDp).toBe(0)
    expect(presentation.summary.remainingBalance).toBe(7500)
  })

  it("uses deterministic payment sequence instead of input array order", () => {
    const payments = [
      makePayment({ id: "PAYMENT-3", paymentSequence: 3, paymentNumber: undefined }),
      makePayment({ id: "PAYMENT-1", paymentSequence: 1, paymentNumber: undefined }),
      makePayment({ id: "PAYMENT-2", paymentSequence: 2, paymentNumber: undefined }),
    ]
    const ordered = sortReceiptPaymentRecords(payments)

    expect(ordered.map((payment) => payment.id)).toEqual([
      "PAYMENT-1",
      "PAYMENT-2",
      "PAYMENT-3",
    ])
    expect(getReceiptPaymentNumber(payments[0], payments)).toBe(3)
  })

  it("preserves settlement type and calculates verified booking progress", () => {
    const payments = [
      ...makeCanonicalPayments(),
      makePayment({
        id: "PAYMENT-4",
        paymentNumber: 4,
        term: "Remaining Balance",
        amount: 7500,
        submittedAt: "2026-09-04T10:00:00.000Z",
      }),
    ]
    const presentation = getReceiptPresentation(booking, payments, payments[3])

    expect(presentation.transaction.amount).toBe(7500)
    expect(presentation.transaction.paymentTypeLabel).toBe("Remaining Balance")
    expect(presentation.summary.totalVerifiedDpPaid).toBe(7500)
    expect(presentation.summary.totalVerifiedPaid).toBe(15000)
    expect(presentation.summary.remainingBalance).toBe(0)
  })

  it("never produces negative receipt balances", () => {
    const payment = makePayment({ amount: 20000 })
    const summary = calculateReceiptPaymentSummary(booking, [payment], payment)

    expect(summary.remainingDp).toBe(0)
    expect(summary.remainingBalance).toBe(0)
  })
})
