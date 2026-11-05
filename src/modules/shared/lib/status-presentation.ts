/**
 * Presentation-only status classes shared by booking, payment, and report
 * surfaces. Persisted status values and workflow transitions remain owned by
 * their respective domain helpers.
 */

const normalize = (value?: string) => String(value || "").trim().toLowerCase()
const normalizeToken = (value?: string) => normalize(value).replace(/[\s-]+/g, "_")

const STATUS_CLASSES = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  pending: "border-orange-200 bg-orange-50 text-orange-700",
  attention: "border-yellow-200 bg-yellow-50 text-yellow-700",
  cancellation: "border-rose-200 bg-rose-50 text-rose-700",
  danger: "border-red-200 bg-red-50 text-red-700",
  purple: "border-purple-200 bg-purple-50 text-purple-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  neutralMuted: "border-slate-200 bg-slate-50 text-slate-600",
} as const

export function getBookingStatusPresentationClass(status?: string) {
  const value = normalize(status)

  if (["confirmed", "reservation_secured", "slot_secured", "slot_verified", "active_rental"].includes(value)) {
    return value === "active_rental" ? STATUS_CLASSES.sky : STATUS_CLASSES.success
  }
  if (["completed", "complete"].includes(value)) return STATUS_CLASSES.info
  if (["pending", "verifying"].includes(value)) return STATUS_CLASSES.pending
  if (["cancellation_requested", "cancellation requested"].includes(value)) return STATUS_CLASSES.warning
  if (value === "modification_under_review") return STATUS_CLASSES.purple
  if (value === "contract_signing_required") return STATUS_CLASSES.attention
  if (["cancelled", "declined", "rejected"].includes(value)) return STATUS_CLASSES.cancellation
  if (value === "rental_expired") return STATUS_CLASSES.danger
  return STATUS_CLASSES.neutralMuted
}

/** Presentation-only timing state; it never replaces the persisted lifecycle badge. */
export function getBookingSchedulePresentationClass(classification?: string) {
  const value = normalizeToken(classification)
  if (value === "upcoming") return STATUS_CLASSES.info
  if (value === "active") return STATUS_CLASSES.success
  if (value === "completed") return STATUS_CLASSES.info
  if (value === "cancelled") return STATUS_CLASSES.cancellation
  if (value === "rejected") return STATUS_CLASSES.danger
  return STATUS_CLASSES.neutralMuted
}

/** Report rows intentionally use the narrower report status vocabulary. */
export function getReportBookingStatusPresentationClass(status?: string) {
  const value = normalize(status || "pending")
  if (value === "confirmed") return STATUS_CLASSES.success
  if (["pending", "verifying", "pencil booking", "for review", "for verification", "awaiting payment"].includes(value)) {
    return STATUS_CLASSES.warning
  }
  if (["cancelled", "canceled", "declined", "rejected"].includes(value)) return STATUS_CLASSES.cancellation
  return STATUS_CLASSES.neutral
}

export function getPaymentStatusPresentationClass(paymentStatus?: string, refundStatus?: string) {
  const payment = normalizeToken(paymentStatus)
  const refund = normalizeToken(refundStatus)

  if (refund === "refunded") return STATUS_CLASSES.neutral
  if (["requested", "refund_requested"].includes(refund)) return STATUS_CLASSES.pending
  if (["rejected", "declined", "cancelled"].includes(payment)) return STATUS_CLASSES.cancellation
  if (["completed", "paid", "fully_paid", "verified", "slot_verified"].includes(payment)) return STATUS_CLASSES.success
  if (["partial", "for_review", "pending_verification", "cash_pending", "slot_pending", "incomplete", "pending", "verifying"].includes(payment)) {
    return STATUS_CLASSES.warning
  }
  return STATUS_CLASSES.neutral
}

export function getReportPaymentStatusPresentationClass(status?: string) {
  const value = normalize(status || "pending")
  if (["paid", "fully paid", "completed", "verified", "received"].includes(value)) return STATUS_CLASSES.success
  if (value.includes("review") || value.includes("pending") || value.includes("incomplete") || value.includes("partial")) {
    return STATUS_CLASSES.warning
  }
  if (["rejected", "declined"].includes(value)) return STATUS_CLASSES.cancellation
  return STATUS_CLASSES.neutral
}

export function getRefundStatusPresentationClass(status?: string) {
  const value = normalizeToken(status || "pending")
  if (["refunded", "refund_claimed"].includes(value)) return STATUS_CLASSES.success
  if (["requested", "pending"].includes(value)) return STATUS_CLASSES.warning
  if (value === "eligible") return STATUS_CLASSES.info
  return STATUS_CLASSES.neutral
}

export { STATUS_CLASSES }
