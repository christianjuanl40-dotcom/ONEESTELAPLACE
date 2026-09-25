import {
  calculatePaymentSummary,
  getPaymentOverallStatusLabel,
  getRecordsForBooking,
  toPaymentAmount,
  type BookingLike,
  type PaymentRecordLike,
  type PaymentSummary,
} from "./payment-calculations"
import { getBookingLifecycleLabel } from "./booking-helpers"

export type ReportBookingLike = BookingLike & Record<string, unknown>

export type ReportBookingFinancials = {
  summary: PaymentSummary
  totalAmount: number
  receivedAmount: number
  remainingBalance: number
  paymentStatus: string
  refundStatus: string
  refundAmount: number
}

export type ReportSummary = {
  totalBookings: number
  confirmed: number
  pending: number
  completed: number
  cancelled: number
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
  const amount = toPaymentAmount(booking.refundAmount)
  return amount > 0 ? amount : 0
}

export function calculateReportBookingFinancials(
  booking: ReportBookingLike,
  paymentRecords: ReadonlyArray<PaymentRecordLike> | null | undefined,
): ReportBookingFinancials {
  const records = getRecordsForBooking(paymentRecords, booking)
  const summary = calculatePaymentSummary(booking, records)

  return {
    summary,
    totalAmount: summary.bookingTotal,
    receivedAmount: summary.moneyReceivedTotal,
    remainingBalance: summary.remainingBalance,
    paymentStatus: getPaymentOverallStatusLabel(summary.overallStatus),
    refundStatus: String(booking.refundStatus || "N/A"),
    refundAmount: getReportRefundAmount(booking),
  }
}

export function buildReportSummary(entries: ReadonlyArray<ReportSummaryEntry>): ReportSummary {
  return entries.reduce(
    (summary, entry) => {
      const lifecycle = getBookingLifecycleLabel(entry.booking)

      if (lifecycle === "Confirmed") summary.confirmed += 1
      if (lifecycle === "Pending") summary.pending += 1
      if (lifecycle === "Completed") summary.completed += 1
      if (lifecycle === "Cancelled") summary.cancelled += 1

      // Revenue is actual accepted/received money, not the booking face value.
      summary.totalRevenue += entry.financials.receivedAmount

      if (
        isProcessedRefundStatus(entry.financials.refundStatus)
      ) {
        summary.totalRefunds += entry.financials.refundAmount
      }

      return summary
    },
    {
      totalBookings: entries.length,
      confirmed: 0,
      pending: 0,
      completed: 0,
      cancelled: 0,
      totalRevenue: 0,
      totalRefunds: 0,
    },
  )
}
