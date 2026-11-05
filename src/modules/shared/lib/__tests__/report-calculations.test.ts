import { describe, expect, it } from "vitest"
import {
  buildReportSummary,
  calculateReportBookingFinancials,
  getReportProcessedRefundAmount,
  type ReportBookingLike,
  type ReportSummaryEntry,
} from "../report-calculations"
import type { PaymentRecordLike } from "../payment-calculations"

function makeBooking(overrides: Record<string, unknown> = {}): ReportBookingLike {
  return {
    id: "BK001",
    bookingCode: "BK001",
    status: "confirmed",
    totalAmount: 15000,
    totalPrice: 15000,
    paymentType: "downpayment",
    selectedDownpaymentAmount: 7500,
    downPaymentPercentage: 50,
    ...overrides,
  } as ReportBookingLike
}

function makePayment(overrides: Partial<PaymentRecordLike> = {}): PaymentRecordLike {
  return {
    id: "PAYMENT-1",
    bookingId: "BK001",
    status: "for_review",
    amount: 7500,
    submittedAt: "2026-09-01T10:00:00Z",
    ...overrides,
  }
}

function makeSummaryEntry(
  booking: ReportBookingLike,
  paymentRecords: PaymentRecordLike[],
): ReportSummaryEntry {
  return {
    booking,
    financials: calculateReportBookingFinancials(booking, paymentRecords),
  }
}

describe("report financial calculations", () => {
  it("uses the authoritative booking total and aggregates accepted history only", () => {
    const booking = makeBooking({ totalAmount: "₱15,000", totalPrice: 999 })
    const financials = calculateReportBookingFinancials(booking, [
      makePayment({ id: "PAYMENT-1", status: "verified", amount: 5500 }),
      makePayment({ id: "PAYMENT-2", status: "rejected", amount: 2000 }),
      makePayment({ id: "PAYMENT-3", status: "verified", amount: 2000 }),
      makePayment({ id: "PAYMENT-4", status: "rejected", amount: 7500 }),
    ])

    expect(financials.totalBookingValue).toBe(15000)
    expect(financials.receivedPayments).toBe(7500)
    expect(financials.verifiedPayments).toBe(7500)
    expect(financials.outstandingBalance).toBe(7500)
    expect(financials.paymentStatus).toBe("Partial Payment")
  })

  it("reports booking value, received payments, verified payments, balance, and net cash for a fully paid booking", () => {
    const booking = makeBooking({ paymentType: "full" })
    const financials = calculateReportBookingFinancials(booking, [
      makePayment({ status: "verified", amount: 15000 }),
    ])

    expect(financials.totalBookingValue).toBe(15000)
    expect(financials.receivedPayments).toBe(15000)
    expect(financials.verifiedPayments).toBe(15000)
    expect(financials.outstandingBalance).toBe(0)
    expect(financials.processedRefundAmount).toBe(0)
    expect(financials.netReceivedAmount).toBe(15000)
    expect(financials.totalAmount).toBe(financials.totalBookingValue)
    expect(financials.receivedAmount).toBe(financials.receivedPayments)
  })

  it("keeps booking value separate from received cash for partial and incomplete payments", () => {
    const financials = calculateReportBookingFinancials(makeBooking(), [
      makePayment({ id: "PAYMENT-1", status: "verified", amount: 5000 }),
      makePayment({
        id: "PAYMENT-2",
        status: "incomplete",
        amount: 2000,
        amountReceived: 1250,
        submittedAt: "2026-09-02T10:00:00Z",
      }),
    ])

    expect(financials.totalBookingValue).toBe(15000)
    expect(financials.receivedPayments).toBe(6250)
    expect(financials.verifiedPayments).toBe(5000)
    expect(financials.outstandingBalance).toBe(8750)
    expect(financials.processedRefundAmount).toBe(0)
    expect(financials.netReceivedAmount).toBe(6250)
  })

  it("excludes pending and rejected payment records from received and verified totals", () => {
    const booking = makeBooking()
    const entry = makeSummaryEntry(booking, [
      makePayment({ id: "PENDING", status: "for_review", amount: 7500 }),
      makePayment({ id: "REJECTED", status: "rejected", amount: 7500 }),
    ])

    expect(entry.financials.receivedPayments).toBe(0)
    expect(entry.financials.verifiedPayments).toBe(0)
    expect(entry.financials.outstandingBalance).toBe(15000)
    expect(entry.financials.netReceivedAmount).toBe(0)
    expect(entry.financials.paymentStatus).toBe("Pending Verification")
    expect(buildReportSummary([entry]).receivedPayments).toBe(0)
  })

  it("counts only processed refunds and prefers the authoritative completed amount", () => {
    const refundedBooking = makeBooking({
      id: "BK-REFUNDED",
      bookingCode: "BK-REFUNDED",
      refundStatus: "refunded",
      // The request amount is retained, but completion is authoritative.
      refundAmount: 15000,
      refundedAmount: 12000,
    })
    const eligibleBooking = makeBooking({
      id: "BK-ELIGIBLE",
      bookingCode: "BK-ELIGIBLE",
      refundStatus: "eligible",
      refundAmount: 15000,
    })
    const legacyRefundedBooking = makeBooking({
      id: "BK-LEGACY-REFUND",
      bookingCode: "BK-LEGACY-REFUND",
      refundStatus: "refund_claimed",
      refundAmount: 1000,
    })
    const entries = [
      makeSummaryEntry(refundedBooking, [
        makePayment({ bookingId: "BK-REFUNDED", status: "verified", amount: 15000 }),
      ]),
      makeSummaryEntry(eligibleBooking, [
        makePayment({ bookingId: "BK-ELIGIBLE", status: "verified", amount: 15000 }),
      ]),
    ]

    expect(entries[0].financials.processedRefundAmount).toBe(12000)
    expect(entries[0].financials.netReceivedAmount).toBe(3000)
    expect(entries[1].financials.processedRefundAmount).toBe(0)
    expect(getReportProcessedRefundAmount(eligibleBooking)).toBe(0)
    expect(getReportProcessedRefundAmount(legacyRefundedBooking)).toBe(1000)

    const summary = buildReportSummary(entries)
    expect(summary.receivedPayments).toBe(30000)
    expect(summary.processedRefunds).toBe(12000)
    expect(summary.netReceivedAmount).toBe(18000)
    expect(summary.totalRevenue).toBe(summary.receivedPayments)
    expect(summary.totalRefunds).toBe(summary.processedRefunds)
  })

  it("does not reduce net received cash for a pending refund request", () => {
    const booking = makeBooking({
      refundStatus: "requested",
      refundAmount: 5000,
    })
    const financials = calculateReportBookingFinancials(booking, [
      makePayment({ status: "verified", amount: 15000 }),
    ])

    expect(financials.processedRefundAmount).toBe(0)
    expect(financials.netReceivedAmount).toBe(15000)
  })

  it("retains cancelled-booking lifecycle counts while reporting its completed refund once", () => {
    const booking = makeBooking({
      status: "cancelled",
      refundStatus: "refunded",
      refundedAmount: 7500,
    })
    const summary = buildReportSummary([
      makeSummaryEntry(booking, [makePayment({ status: "verified", amount: 7500 })]),
    ])

    expect(summary.cancelled).toBe(1)
    expect(summary.receivedPayments).toBe(7500)
    expect(summary.processedRefunds).toBe(7500)
    expect(summary.netReceivedAmount).toBe(0)
  })

  it("supports canonical office bookings without importing legacy office-rental records", () => {
    const booking = makeBooking({
      id: "OFFICE-001",
      bookingCode: "OFFICE-001",
      bookingCategory: "office",
      paymentType: "full",
      totalAmount: 10000,
      totalPrice: 10000,
    })
    const financials = calculateReportBookingFinancials(booking, [
      makePayment({ bookingId: "OFFICE-001", status: "verified", amount: 10000 }),
    ])

    expect(financials.totalBookingValue).toBe(10000)
    expect(financials.receivedPayments).toBe(10000)
    expect(financials.outstandingBalance).toBe(0)
  })

  it("matches multiple payment records by exact booking ID or booking code without duplication", () => {
    const bookingA = makeBooking({ id: "BK-A", bookingCode: "CODE-A" })
    const bookingB = makeBooking({ id: "BK-B", bookingCode: "CODE-B" })
    const records = [
      makePayment({ id: "A-BY-CODE", bookingId: "other", bookingCode: "CODE-A", amount: 5000, status: "verified" }),
      makePayment({ id: "B-BY-ID", bookingId: "BK-B", bookingCode: "CODE-B", amount: 3000, status: "verified" }),
      makePayment({ id: "UNRELATED", bookingId: "other", bookingCode: "other", amount: 9000, status: "verified" }),
    ]

    const financialsA = calculateReportBookingFinancials(bookingA, records)
    const financialsB = calculateReportBookingFinancials(bookingB, records)

    expect(financialsA.receivedPayments).toBe(5000)
    expect(financialsB.receivedPayments).toBe(3000)
  })

  it("keeps filtered summary totals equal to the included booking rows", () => {
    const entries = [
      makeSummaryEntry(makeBooking({ id: "INCLUDED", totalAmount: 10000, totalPrice: 10000 }), [
        makePayment({ bookingId: "INCLUDED", status: "verified", amount: 4000 }),
      ]),
      makeSummaryEntry(makeBooking({ id: "EXCLUDED", totalAmount: 20000, totalPrice: 20000 }), [
        makePayment({ bookingId: "EXCLUDED", status: "verified", amount: 20000 }),
      ]),
    ]
    const filteredSummary = buildReportSummary(entries.slice(0, 1))

    expect(filteredSummary.totalBookings).toBe(1)
    expect(filteredSummary.totalBookingValue).toBe(10000)
    expect(filteredSummary.receivedPayments).toBe(4000)
    expect(filteredSummary.netReceivedAmount).toBe(4000)
  })

  it("returns stable zero metrics for an empty report", () => {
    expect(buildReportSummary([])).toEqual({
      totalBookings: 0,
      confirmed: 0,
      pending: 0,
      completed: 0,
      cancelled: 0,
      totalBookingValue: 0,
      receivedPayments: 0,
      verifiedPayments: 0,
      processedRefunds: 0,
      netReceivedAmount: 0,
      outstandingBalance: 0,
      totalRevenue: 0,
      totalRefunds: 0,
    })
  })

  it("uses cent arithmetic for decimal currency totals", () => {
    const booking = makeBooking({
      totalAmount: 0.3,
      totalPrice: 0.3,
      paymentType: "full",
    })
    const financials = calculateReportBookingFinancials(booking, [
      makePayment({ id: "DECIMAL-1", status: "verified", amount: 0.1 }),
      makePayment({ id: "DECIMAL-2", status: "verified", amount: 0.2, submittedAt: "2026-09-02T10:00:00Z" }),
    ])

    expect(financials.totalBookingValue).toBe(0.3)
    expect(financials.receivedPayments).toBe(0.3)
    expect(financials.verifiedPayments).toBe(0.3)
    expect(financials.outstandingBalance).toBe(0)
    expect(financials.netReceivedAmount).toBe(0.3)
  })
})
