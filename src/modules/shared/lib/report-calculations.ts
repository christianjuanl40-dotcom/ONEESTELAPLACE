import {
  calculatePaymentSummary,
  centsToPaymentAmount,
  getPaymentOverallStatusLabel,
  getRecordsForBooking,
  toPaymentAmount,
  toPaymentCents,
  type BookingLike,
  type PaymentRecordLike,
  type PaymentSummary,
} from "./payment-calculations"
import { getBookingLifecycleLabel } from "./booking-helpers"

export type ReportBookingLike = BookingLike & Record<string, unknown>

export type ReportBookingFinancials = {
  summary: PaymentSummary
  /** The booking's face value, independent of collected cash. */
  totalBookingValue: number
  /** Canonical cash ledger: verified money plus received incomplete money. */
  receivedPayments: number
  /** Verified payment records only; this is a diagnostic distinct from receipts. */
  verifiedPayments: number
  /** Canonical outstanding booking balance before any refund presentation. */
  outstandingBalance: number
  paymentStatus: string
  refundStatus: string
  /** Refunds completed/claimed by the existing refund workflow only. */
  processedRefundAmount: number
  /** Received cash less the processed refund, never below zero. */
  netReceivedAmount: number
  /**
   * Compatibility aliases for callers that consumed the pre-Phase-1A shape.
   * They are assigned from the canonical fields above, not recalculated.
   */
  totalAmount: number
  receivedAmount: number
  remainingBalance: number
  refundAmount: number
}

export type ReportSummary = {
  totalBookings: number
  confirmed: number
  pending: number
  completed: number
  cancelled: number
  totalBookingValue: number
  receivedPayments: number
  verifiedPayments: number
  processedRefunds: number
  netReceivedAmount: number
  outstandingBalance: number
  /** Deprecated aliases retained for compatibility with existing consumers. */
  totalRevenue: number
  totalRefunds: number
}

export type ReportSummaryEntry = {
  booking: ReportBookingLike
  financials: ReportBookingFinancials
}

export function isProcessedRefundStatus(status: unknown) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")

  return normalized === "refunded" || normalized === "refund_claimed"
}

export function getReportRefundAmount(booking: ReportBookingLike) {
  // Completion writes `refundedAmount`; older/refund-request records only have
  // `refundAmount`. Prefer the completion field when it is present, and never
  // use `refundLedgerAmount` because that is the received-payment ledger at the
  // time of the refund, not the refund itself.
  const completedAmount = booking.refundedAmount
  const source = completedAmount === undefined || completedAmount === null || completedAmount === ""
    ? booking.refundAmount
    : completedAmount
  const amount = toPaymentAmount(source)
  return amount > 0 ? amount : 0
}

export function getReportProcessedRefundAmount(booking: ReportBookingLike) {
  return isProcessedRefundStatus(booking.refundStatus)
    ? getReportRefundAmount(booking)
    : 0
}

export function calculateReportBookingFinancials(
  booking: ReportBookingLike,
  paymentRecords: ReadonlyArray<PaymentRecordLike> | null | undefined,
): ReportBookingFinancials {
  const records = getRecordsForBooking(paymentRecords, booking)
  const summary = calculatePaymentSummary(booking, records)
  const totalBookingValue = summary.bookingTotal
  const receivedPayments = summary.moneyReceivedTotal
  const verifiedPayments = summary.acceptedVerifiedTotal
  const outstandingBalance = summary.remainingBalance
  const refundStatus = String(booking.refundStatus || "N/A")
  const processedRefundAmount = getReportProcessedRefundAmount(booking)
  const netReceivedAmount = centsToPaymentAmount(Math.max(
    toPaymentCents(receivedPayments) - toPaymentCents(processedRefundAmount),
    0,
  ))

  return {
    summary,
    totalBookingValue,
    receivedPayments,
    verifiedPayments,
    outstandingBalance,
    paymentStatus: getPaymentOverallStatusLabel(summary.overallStatus),
    refundStatus,
    processedRefundAmount,
    netReceivedAmount,
    totalAmount: totalBookingValue,
    receivedAmount: receivedPayments,
    remainingBalance: outstandingBalance,
    refundAmount: processedRefundAmount,
  }
}

export function buildReportSummary(entries: ReadonlyArray<ReportSummaryEntry>): ReportSummary {
  const totals = entries.reduce(
    (summary, entry) => {
      const lifecycle = getBookingLifecycleLabel(entry.booking)

      if (lifecycle === "Confirmed") summary.confirmed += 1
      if (lifecycle === "Pending") summary.pending += 1
      if (lifecycle === "Completed") summary.completed += 1
      if (lifecycle === "Cancelled") summary.cancelled += 1

      summary.totalBookingValueCents += toPaymentCents(entry.financials.totalBookingValue)
      summary.receivedPaymentsCents += toPaymentCents(entry.financials.receivedPayments)
      summary.verifiedPaymentsCents += toPaymentCents(entry.financials.verifiedPayments)
      summary.processedRefundsCents += toPaymentCents(entry.financials.processedRefundAmount)
      summary.netReceivedAmountCents += toPaymentCents(entry.financials.netReceivedAmount)
      summary.outstandingBalanceCents += toPaymentCents(entry.financials.outstandingBalance)

      return summary
    },
    {
      totalBookings: entries.length,
      confirmed: 0,
      pending: 0,
      completed: 0,
      cancelled: 0,
      totalBookingValueCents: 0,
      receivedPaymentsCents: 0,
      verifiedPaymentsCents: 0,
      processedRefundsCents: 0,
      netReceivedAmountCents: 0,
      outstandingBalanceCents: 0,
    },
  )

  const totalBookingValue = centsToPaymentAmount(totals.totalBookingValueCents)
  const receivedPayments = centsToPaymentAmount(totals.receivedPaymentsCents)
  const verifiedPayments = centsToPaymentAmount(totals.verifiedPaymentsCents)
  const processedRefunds = centsToPaymentAmount(totals.processedRefundsCents)
  const netReceivedAmount = centsToPaymentAmount(totals.netReceivedAmountCents)
  const outstandingBalance = centsToPaymentAmount(totals.outstandingBalanceCents)

  return {
    totalBookings: totals.totalBookings,
    confirmed: totals.confirmed,
    pending: totals.pending,
    completed: totals.completed,
    cancelled: totals.cancelled,
    totalBookingValue,
    receivedPayments,
    verifiedPayments,
    processedRefunds,
    netReceivedAmount,
    outstandingBalance,
    // Existing consumers used these names for received cash and processed
    // refunds. Keep them as exact aliases while the UI uses explicit names.
    totalRevenue: receivedPayments,
    totalRefunds: processedRefunds,
  }
}
