import { describe, expect, it } from "vitest"
import {
  calculateBookingVerifiedPaymentSummary,
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

describe("booking-wide payment summary calculations", () => {
  it("uses the booking-wide summary when Payment #1 is selected", () => {
    const payments = makeCanonicalPayments()
    const presentation = getReceiptPresentation(booking, [...payments].reverse(), payments[0])

    expect(presentation.transaction.paymentNumber).toBe(1)
    expect(presentation.transaction.amount).toBe(5500)
    expect(presentation.transaction.statusLabel).toBe("Verified")
    expect(presentation.transaction.paymentTypeLabel).toBe("Down Payment")
    expect(presentation.summary.totalVerifiedDpPaid).toBe(7500)
    expect(presentation.summary.remainingDp).toBe(0)
    expect(presentation.summary.remainingBalance).toBe(7500)
  })

  it("keeps the booking-wide summary when the rejected Payment #2 is selected", () => {
    const payments = makeCanonicalPayments()
    const presentation = getReceiptPresentation(booking, payments, payments[1])

    expect(presentation.transaction.paymentNumber).toBe(2)
    expect(presentation.transaction.amount).toBe(2000)
    expect(presentation.transaction.statusLabel).toBe("Rejected")
    expect(presentation.summary.totalVerifiedDpPaid).toBe(7500)
    expect(presentation.summary.remainingDp).toBe(0)
    expect(presentation.summary.remainingBalance).toBe(7500)
  })

  it("keeps the booking-wide summary when verified Payment #3 is selected", () => {
    const payments = makeCanonicalPayments()
    const presentation = getReceiptPresentation(booking, payments, payments[2])

    expect(presentation.transaction.paymentNumber).toBe(3)
    expect(presentation.transaction.amount).toBe(2000)
    expect(presentation.transaction.statusLabel).toBe("Verified")
    expect(presentation.summary.totalVerifiedDpPaid).toBe(7500)
    expect(presentation.summary.totalVerifiedPaid).toBe(7500)
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

  it("keeps the four-payment summary identical for every selected transaction", () => {
    const payments = [
      makePayment({
        id: "PAYMENT-1",
        paymentNumber: 1,
        amount: 5500,
        paymentMethod: "bank",
        referenceNo: "REF-1",
        submittedAt: "2026-09-01T10:00:00.000Z",
      }),
      makePayment({
        id: "PAYMENT-2",
        paymentNumber: 2,
        amount: 2000,
        status: "rejected",
        paymentMethod: "bank",
        referenceNo: "REF-2",
        submittedAt: "2026-09-02T10:00:00.000Z",
      }),
      makePayment({
        id: "PAYMENT-3",
        paymentNumber: 3,
        amount: 2000,
        paymentMethod: "bank",
        referenceNo: "REF-3",
        submittedAt: "2026-09-03T10:00:00.000Z",
      }),
      makePayment({
        id: "PAYMENT-4",
        paymentNumber: 4,
        term: "Remaining Balance",
        amount: 7500,
        status: "rejected",
        paymentMethod: "cash",
        referenceNo: "REF-4",
        submittedAt: "2026-09-04T10:00:00.000Z",
      }),
    ]
    const expectedSummary = {
      totalBookingAmount: 15000,
      requiredDpAmount: 7500,
      totalVerifiedDpPaid: 7500,
      remainingDp: 0,
      totalVerifiedPaid: 7500,
      remainingBalance: 7500,
    }
    const expectedTransactions = [
      { amount: 5500, statusLabel: "Verified", paymentType: "downpayment", paymentMethod: "bank", bankReference: "REF-1" },
      { amount: 2000, statusLabel: "Rejected", paymentType: "downpayment", paymentMethod: "bank", bankReference: "REF-2" },
      { amount: 2000, statusLabel: "Verified", paymentType: "downpayment", paymentMethod: "bank", bankReference: "REF-3" },
      { amount: 7500, statusLabel: "Rejected", paymentType: "remaining_balance", paymentMethod: "cash", bankReference: "REF-4" },
    ] as const

    payments.forEach((selected, index) => {
      const presentation = getReceiptPresentation(booking, payments, selected)
      expect(presentation.summary).toEqual(expectedSummary)
      expect(presentation.transaction).toMatchObject(expectedTransactions[index])
    })
  })

  it("updates the booking-wide summary when a later payment becomes verified", () => {
    const payments = [
      ...makeCanonicalPayments(),
      makePayment({
        id: "PAYMENT-4",
        paymentNumber: 4,
        term: "Remaining Balance",
        amount: 3000,
        status: "verified",
        submittedAt: "2026-09-04T10:00:00.000Z",
      }),
    ]
    const presentation = getReceiptPresentation(booking, payments, payments[0])

    expect(presentation.transaction.amount).toBe(5500)
    expect(presentation.summary.totalVerifiedPaid).toBe(10500)
    expect(presentation.summary.remainingBalance).toBe(4500)
    expect(presentation.summary.totalVerifiedDpPaid).toBe(7500)
    expect(presentation.summary.remainingDp).toBe(0)
  })

  it("excludes pending, failed, and void transactions from verified totals", () => {
    const payments = [
      makePayment({ id: "VERIFIED", amount: 5500, status: "Verified" }),
      makePayment({ id: "PENDING", amount: 2000, status: "For Verification" }),
      makePayment({ id: "FAILED", amount: 3000, status: "failed" }),
      makePayment({ id: "VOIDED", amount: 4000, status: "voided" }),
    ]
    const summary = calculateBookingVerifiedPaymentSummary(booking, payments)

    expect(summary.totalVerifiedPaid).toBe(5500)
    expect(summary.totalVerifiedDpPaid).toBe(5500)
    expect(summary.remainingDp).toBe(2000)
    expect(summary.remainingBalance).toBe(9500)
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
    const summary = calculateBookingVerifiedPaymentSummary(booking, [payment])

    expect(summary.totalVerifiedDpPaid).toBe(7500)
    expect(summary.totalVerifiedPaid).toBe(20000)
    expect(summary.remainingDp).toBe(0)
    expect(summary.remainingBalance).toBe(0)
  })

  it("keeps the compatibility summary helper booking-wide even with a selected argument", () => {
    const payments = makeCanonicalPayments()
    const summary = calculateReceiptPaymentSummary(booking, payments, payments[0])

    expect(summary.totalVerifiedPaid).toBe(7500)
    expect(summary.remainingBalance).toBe(7500)
  })
})
