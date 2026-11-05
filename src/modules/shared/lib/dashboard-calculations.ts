import {
  calculatePaymentSummary,
  getPendingPaymentTotal,
  getRecordsForBooking,
  type BookingLike,
  type PaymentRecordLike,
} from "./payment-calculations"

export type DashboardBookingLike = BookingLike & { status?: unknown }

export interface AdminDashboardMetrics {
  bookedValue: number
  receivedPayments: number
  pendingPaymentTotal: number
  outstandingBalance: number
  pending: number
  verifying: number
  confirmed: number
  cancelled: number
  cancellationRequests: number
  modificationRequests: number
  total: number
}

export interface ClientPaymentOverview {
  totalBookingValue: number
  receivedPayments: number
  pendingVerification: number
  outstandingBalance: number
}

function getStatus(booking: DashboardBookingLike): string {
  return String(booking.status || "").trim().toLowerCase()
}

function getPaymentValues(booking: BookingLike, paymentRecords: PaymentRecordLike[]) {
  const records = getRecordsForBooking(paymentRecords, booking)
  const summary = calculatePaymentSummary(booking, records)
  return {
    records,
    summary,
    pendingVerification: getPendingPaymentTotal(records),
  }
}

export function calculateAdminDashboardMetrics(
  bookings: DashboardBookingLike[],
  paymentRecords: PaymentRecordLike[],
  paymentReviewCount: number,
): AdminDashboardMetrics {
  return bookings.reduce<AdminDashboardMetrics>((metrics, booking) => {
    const status = getStatus(booking)
    const { summary, pendingVerification } = getPaymentValues(booking, paymentRecords)

    metrics.total += 1
    metrics.receivedPayments += summary.moneyReceivedTotal
    metrics.pendingPaymentTotal += pendingVerification
    metrics.outstandingBalance += summary.remainingBalance

    if (status === "confirmed" || status === "completed") {
      metrics.bookedValue += summary.bookingTotal
    }
    if (status === "pending" || status === "verifying") metrics.pending += 1
    if (status === "confirmed") metrics.confirmed += 1
    if (status === "cancelled" || status === "declined") metrics.cancelled += 1
    if (status === "cancellation_requested") metrics.cancellationRequests += 1
    if (status === "modification_under_review") metrics.modificationRequests += 1
    return metrics
  }, {
    bookedValue: 0,
    receivedPayments: 0,
    pendingPaymentTotal: 0,
    outstandingBalance: 0,
    pending: 0,
    verifying: paymentReviewCount,
    confirmed: 0,
    cancelled: 0,
    cancellationRequests: 0,
    modificationRequests: 0,
    total: 0,
  })
}

export function calculateClientPaymentOverview(
  bookings: DashboardBookingLike[],
  paymentRecords: PaymentRecordLike[],
): ClientPaymentOverview {
  return bookings.reduce<ClientPaymentOverview>((overview, booking) => {
    const { summary, pendingVerification } = getPaymentValues(booking, paymentRecords)
    overview.totalBookingValue += summary.bookingTotal
    overview.receivedPayments += summary.moneyReceivedTotal
    overview.pendingVerification += pendingVerification
    overview.outstandingBalance += summary.remainingBalance
    return overview
  }, {
    totalBookingValue: 0,
    receivedPayments: 0,
    pendingVerification: 0,
    outstandingBalance: 0,
  })
}
