export function normalizeStatus(value: unknown): string {
  return String(value || "").toLowerCase().trim()
}

export function getAmount(value: unknown): number {
  if (typeof value === "number") return value
  const cleaned = String(value || "0").replace(/[^0-9.-]+/g, "")
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : 0
}

export function getTotalAmount(booking: Record<string, unknown>): number {
  return getAmount(booking.totalAmount || booking.totalPrice || booking.amount || booking.price)
}

export function getAmountPaid(booking: Record<string, unknown>): number {
  return getAmount(booking.amountPaid || booking.paymentAmount || booking.paidAmount)
}

export function getRemainingBalance(booking: Record<string, unknown>): number {
  const stored = getAmount(booking.remainingBalance)
  if (stored > 0) return stored
  return Math.max(getTotalAmount(booking) - getAmountPaid(booking), 0)
}

export function isFullyPaid(booking: Record<string, unknown>): boolean {
  const amountPaid = getAmountPaid(booking)
  const total = getTotalAmount(booking)
  const remaining = getRemainingBalance(booking)
  return amountPaid >= total && remaining === 0
}

export function hasActivePaymentSubmission(booking: Record<string, unknown>): boolean {
  const normalizedStatus = normalizeStatus(booking.paymentStatus || booking.status)
  return (
    booking.hasActivePaymentSubmission === true ||
    normalizedStatus === "for_review" ||
    normalizedStatus === "for review" ||
    normalizedStatus === "pending_verification" ||
    normalizedStatus === "pending verification" ||
    normalizedStatus === "incomplete" ||
    Boolean(booking.paymentSubmittedAt)
  )
}

export function hasPaymentProof(booking: Record<string, unknown>): boolean {
  return Boolean(
    booking.proofUrl ||
      booking.paymentProof ||
      booking.proofOfPayment ||
      booking.paymentReference ||
      booking.referenceNumber ||
      booking.proofImage ||
      booking.receiptImage
  )
}

export function hasActiveCancellationRequest(booking: Record<string, unknown>): boolean {
  return normalizeStatus(booking.cancellationStatus) === "under review"
}

export function hasActiveModificationRequest(booking: Record<string, unknown>): boolean {
  return normalizeStatus(booking.modificationStatus) === "under review"
}

export function isForVerificationStatus(booking: Record<string, unknown>): boolean {
  const normStatus = normalizeStatus(booking.status)
  const paymentStatus = normalizeStatus(booking.paymentStatus)
  if (normStatus === "verifying") return true
  return ["for_review", "cash_pending", "slot_pending", "pending_verification", "pending verification", "for verification"].includes(paymentStatus)
}

export function isPencilBooking(booking: Record<string, unknown>): boolean {
  const normStatus = normalizeStatus(booking.status)
  const paymentStatus = normalizeStatus(booking.paymentStatus)
  return normStatus === "pending" && !["for_review", "cash_pending", "slot_pending", "pending_verification", "pending verification", "for verification"].includes(paymentStatus)
}

export function isApprovedOrConfirmed(booking: Record<string, unknown>): boolean {
  const normStatus = normalizeStatus(booking.status)
  return ["confirmed", "reservation_secured"].includes(normStatus)
}

export function canRecordOnsitePayment(booking: Record<string, unknown>): boolean {
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  if (isForVerificationStatus(booking)) return false
  if (isFullyPaid(booking)) return false
  if (hasActivePaymentSubmission(booking)) return false
  if (hasPaymentProof(booking)) return false
  return getRemainingBalance(booking) > 0
}

export function canSendBalanceReminder(booking: Record<string, unknown>): boolean {
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  if (!isApprovedOrConfirmed(booking)) return false
  return getRemainingBalance(booking) > 0
}

export function canMarkContractSigned(booking: Record<string, unknown>): boolean {
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  if (normalizeStatus(booking.contractStatus) === "signed" || booking.contractSigned === true) return false
  const normStatus = normalizeStatus(booking.status)
  return ["confirmed", "reservation_secured"].includes(normStatus) || isFullyPaid(booking)
}

export function isEventFinished(booking: Record<string, unknown>): boolean {
  const dateStr = booking.date as string | undefined
  const endDateStr = (booking.endDate as string | undefined) || dateStr
  const endTimeStr = booking.endTime as string | undefined
  if (!endDateStr && !dateStr) return false
  const targetDate = endDateStr || dateStr
  try {
    const dateObj = new Date(targetDate + "T23:59:59")
    if (!isNaN(dateObj.getTime())) {
      if (endTimeStr) {
        const [hours, minutes] = String(endTimeStr).split(":").map(Number)
        if (!isNaN(hours)) dateObj.setHours(hours, minutes || 0, 0, 0)
      }
      return dateObj.getTime() < Date.now()
    }
  } catch {}
  return false
}

export function canMarkAsCompleted(booking: Record<string, unknown>): boolean {
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  return isFullyPaid(booking)
}

export function isMarkCompletedEnabled(booking: Record<string, unknown>): boolean {
  return canMarkAsCompleted(booking) && isEventFinished(booking)
}

export function canShowPayNow(booking: Record<string, unknown>): boolean {
  if (hasActiveCancellationRequest(booking)) return false
  if (hasActiveModificationRequest(booking)) return false
  if (hasActivePaymentSubmission(booking)) return false
  if (hasPaymentProof(booking)) return false
  const completed = normalizeStatus(booking.status) === "completed"
  const cancelled = normalizeStatus(booking.status) === "cancelled"
  if (completed || cancelled) return false
  const paymentStatus = normalizeStatus(booking.paymentStatus)
  if (["verified", "paid", "slot_verified"].includes(paymentStatus)) return false
  return true
}

export function isCompleted(booking: Record<string, unknown>): boolean {
  return normalizeStatus(booking.status) === "completed"
}

export function isCancelled(booking: Record<string, unknown>): boolean {
  return normalizeStatus(booking.status) === "cancelled"
}

export function isCancellationRequested(booking: Record<string, unknown>): boolean {
  return normalizeStatus(booking.status) === "cancellation_requested"
}

export function isModificationUnderReview(booking: Record<string, unknown>): boolean {
  return normalizeStatus(booking.modificationStatus) === "modification_under_review"
}

const ACTIVE_BOOKING_STATUSES = [
  "pending",
  "verifying",
  "approved",
  "confirmed",
  "contract_signing_required",
  "reservation_secured",
  "active_rental",
  "modification_under_review",
  "cancellation_requested",
]

export function isActiveBooking(booking: {
  status?: string
  bookingStatus?: string
}): boolean {
  const status = normalizeStatus(String(booking.status || booking.bookingStatus || ""))
  return (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(status)
}

export function getCurrentBooking<T extends {
  status?: string
  bookingStatus?: string
  createdAt?: string
}>(bookings: T[]): T | null {
  const sorted = [...bookings].sort(
    (a, b) =>
      new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime(),
  )
  const active = sorted.filter(isActiveBooking)
  return active.length > 0 ? active[0] : sorted[0] || null
}
