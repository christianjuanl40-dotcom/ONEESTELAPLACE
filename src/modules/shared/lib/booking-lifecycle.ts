import { calculatePaymentSummary, isVerifiedPaymentRecord, type PaymentRecordLike } from "./payment-calculations"
import { hasActivePaymentSubmission } from "./booking-helpers"

export const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000

export function isPaymentWindowExpired(
  createdAt: unknown,
  now = Date.now(),
): boolean {
  const dateValue = createdAt && typeof createdAt === "object" && "toDate" in createdAt && typeof createdAt.toDate === "function"
    ? createdAt.toDate()
    : createdAt
  const timestamp = dateValue instanceof Date
    ? dateValue.getTime()
    : new Date(String(dateValue || "")).getTime()

  return Number.isFinite(timestamp) && now - timestamp >= PAYMENT_WINDOW_MS
}

/** Expire only abandoned, unpaid holds; never release a secured or reviewed slot. */
export function isHoldExpiryCandidate(booking: Record<string, unknown>, now = Date.now()): boolean {
  return !(String(booking.status || "").trim().toLowerCase() !== "pending" || !isPaymentWindowExpired(booking.createdAt, now)
    || booking.isSlotSecured === true || booking.verifiedByAdmin === true || booking.contractSigned === true
    || booking.cancellationRequested === true || booking.modificationRequested === true || hasActivePaymentSubmission(booking))
}

export function canAutomaticallyExpireBooking(booking: Record<string, unknown>, records: PaymentRecordLike[], now = Date.now()): boolean {
  if (!isHoldExpiryCandidate(booking, now)) return false
  const summary = calculatePaymentSummary(booking, records)
  return !summary.hasPendingSubmission && summary.moneyReceivedTotal <= 0 && !records.some(isVerifiedPaymentRecord)
}

export function automaticBookingExpiryFields(booking: Record<string, unknown>, now = new Date().toISOString()) {
  const logs = Array.isArray(booking.adminLogs) ? booking.adminLogs.slice(-49) : []
  return {
    status: "cancelled", bookingStatus: "Cancelled", paymentStatus: "cancelled",
    cancellationRequested: false, cancellationStatus: "Automatic Expiry", cancellationStatusLabel: "Automatically Cancelled",
    cancellationSource: "system", cancellationType: "automatic_expiry", cancellationActorId: "system", cancellationActorName: "System",
    cancellationReason: "Payment window expired", cancellationNotes: "Automatically cancelled after the 24-hour payment window expired.",
    cancelledAt: now, adminCancelDecision: "automatic_expiry", lastActivityAt: now, updatedAt: now,
    adminLogs: [...logs, { action: "AUTO_EXPIRE_BOOKING", message: "Booking was automatically cancelled after the 24-hour payment window expired.", createdAt: now }],
  }
}
