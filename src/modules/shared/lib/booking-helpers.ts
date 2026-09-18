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
  const amountPaid = getAmount(booking.amountPaid)
  if (amountPaid > 0) return amountPaid
  const paidAmount = getAmount(booking.paidAmount)
  if (paidAmount > 0) return paidAmount

  const paymentStatus = normalizeStatus(booking.paymentStatus)
  if (
    [
      "verified",
      "paid",
      "completed",
      "fully paid",
      "fully_paid",
      "partial",
      "slot_verified",
      "reservation secured",
      "reservation_secured",
    ].includes(paymentStatus)
  ) {
    return getAmount(booking.paymentAmount)
  }

  return 0
}

export function getRemainingBalance(booking: Record<string, unknown>): number {
  return Math.max(getTotalAmount(booking) - getAmountPaid(booking), 0)
}

export function isFullyPaid(booking: Record<string, unknown>): boolean {
  const amountPaid = getAmountPaid(booking)
  const total = getTotalAmount(booking)
  const remaining = getRemainingBalance(booking)
  return total > 0 && amountPaid >= total && remaining === 0
}

export function hasActivePaymentSubmission(booking: Record<string, unknown>): boolean {
  const normalizedStatus = normalizeStatus(booking.paymentStatus || booking.status)
  return (
    booking.hasActivePaymentSubmission === true ||
    normalizedStatus === "for_review" ||
    normalizedStatus === "for review" ||
    normalizedStatus === "pending_verification" ||
    normalizedStatus === "pending verification"
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
  const cancellationStatus = normalizeStatus(booking.cancellationStatus)
  return Boolean(
    booking.cancellationRequested === true ||
      normalizeStatus(booking.status) === "cancellation_requested" ||
      ["pending", "under review", "requested"].includes(cancellationStatus) ||
      normalizeStatus(booking.cancelRequestStatus) === "pending",
  )
}

export function hasActiveModificationRequest(booking: Record<string, unknown>): boolean {
  const bookingStatus = normalizeStatus(booking.bookingStatus)
  const status = normalizeStatus(booking.status)
  const modificationStatus = normalizeStatus(booking.modificationStatus)
  const modifyRequestStatus = normalizeStatus(booking.modifyRequestStatus)
  const canonicalReviewStatus =
    status === "modification_under_review" ||
    status === "modification under review" ||
    bookingStatus === "modification_under_review" ||
    bookingStatus === "modification under review"

  if (canonicalReviewStatus) return true

  // `status`/`bookingStatus` are the canonical lifecycle fields. If either
  // field is present and has already left review, older request aliases are
  // stale and must not keep a resolved booking locked.
  if (status || bookingStatus) return false

  // These fields were introduced at different points in the modification
  // flow. Treat all active representations as blocking a second request,
  // while an explicit admin decision makes stale legacy flags harmless.
  if (["approved", "declined"].includes(modificationStatus)) return false

  return (
    modificationStatus === "under review" ||
    modificationStatus === "modification_under_review" ||
    booking.modificationRequested === true ||
    booking.modificationUnderReview === true ||
    modifyRequestStatus === "pending" ||
    modifyRequestStatus === "under review" ||
    modifyRequestStatus === "modification under review"
  )
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
  return hasActiveCancellationRequest(booking)
}

export function isModificationUnderReview(booking: Record<string, unknown>): boolean {
  return hasActiveModificationRequest(booking)
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
  return active.length > 0 ? active[0] : null
}
