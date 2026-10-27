import { describe, expect, it } from "vitest"
import {
  buildReportSummary,
  calculateReportBookingFinancials,
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
    const records = [
      makePayment({ id: "PAYMENT-1", status: "verified", amount: 5500 }),
      makePayment({ id: "PAYMENT-2", status: "rejected", amount: 2000 }),
      makePayment({ id: "PAYMENT-3", status: "verified", amount: 2000 }),
      makePayment({ id: "PAYMENT-4", status: "rejected", amount: 7500 }),
    ]

    const financials = calculateReportBookingFinancials(booking, records)

    expect(financials.totalAmount).toBe(15000)
    expect(financials.receivedAmount).toBe(7500)
    expect(financials.remainingBalance).toBe(7500)
    expect(financials.paymentStatus).toBe("Partial Payment")
  })

  it("keeps earlier accepted money when the latest transaction is rejected", () => {
    const financials = calculateReportBookingFinancials(makeBooking(), [
      makePayment({ id: "PAYMENT-1", status: "verified", amount: 7500 }),
      makePayment({ id: "PAYMENT-2", status: "rejected", amount: 7500 }),
    ])

    expect(financials.receivedAmount).toBe(7500)
    expect(financials.remainingBalance).toBe(7500)
    expect(financials.paymentStatus).toBe("Partial Payment")
  })

  it("does not credit pending money to balance or revenue", () => {
    const booking = makeBooking()
    const entry = makeSummaryEntry(booking, [makePayment({ status: "for_review", amount: 7500 })])

    expect(entry.financials.receivedAmount).toBe(0)
    expect(entry.financials.remainingBalance).toBe(15000)
    expect(entry.financials.paymentStatus).toBe("For Review")
    expect(buildReportSummary([entry]).totalRevenue).toBe(0)
  })

  it("counts actual processed refunds but excludes merely eligible refunds", () => {
    const refundedBooking = makeBooking({
      id: "BK-REFUNDED",
      bookingCode: "BK-REFUNDED",
      refundStatus: "refunded",
      refundAmount: "₱15,000",
    })
    const eligibleBooking = makeBooking({
      id: "BK-ELIGIBLE",
      bookingCode: "BK-ELIGIBLE",
      refundStatus: "eligible",
      refundAmount: 15000,
    })
    const entries = [
      makeSummaryEntry(refundedBooking, [
        makePayment({ bookingId: "BK-REFUNDED", status: "verified", amount: 15000 }),
      ]),
      makeSummaryEntry(eligibleBooking, [
        makePayment({ bookingId: "BK-ELIGIBLE", status: "verified", amount: 15000 }),
      ]),
    ]

    const summary = buildReportSummary(entries)

    expect(summary.totalRevenue).toBe(30000)
    expect(summary.totalRefunds).toBe(15000)
  })

  it("matches payment records to the booking identifiers without crossing clients", () => {
    const bookingA = makeBooking({ id: "BK-A", bookingCode: "CODE-A" })
    const bookingB = makeBooking({ id: "BK-B", bookingCode: "CODE-B" })
    const records = [
      makePayment({ id: "A-BY-CODE", bookingId: "other", bookingCode: "CODE-A", amount: 5000, status: "verified" }),
      makePayment({ id: "B-BY-ID", bookingId: "BK-B", bookingCode: "CODE-B", amount: 3000, status: "verified" }),
    ]

    const financialsA = calculateReportBookingFinancials(bookingA, records)
    const financialsB = calculateReportBookingFinancials(bookingB, records)

    expect(financialsA.receivedAmount).toBe(5000)
    expect(financialsB.receivedAmount).toBe(3000)
  })
})
