export type CancellationRecord = Record<string, unknown>

export type CancellationSource = "client" | "admin" | "system"
export type CancellationType = "client_request" | "admin_action" | "automatic_expiry"

export interface CancellationAuditView {
  source: string
  actorName: string
  type: string
  reason: string
  notes: string
  date: string
}

const CANCELLATION_CLOSED_DAYS = 7
const REFUND_ELIGIBLE_DAYS = 14

const TERMINAL_STATUSES = new Set([
  "cancelled",
  "completed",
  "declined",
  "rental_expired",
])

const PAYMENT_UNAVAILABLE_STATUSES = new Set([
  "",
  "unpaid",
  "pending",
  "for_review",
  "cash_pending",
  "slot_pending",
  "pending_verification",
  "pending verification",
  "for verification",
  "rejected",
])

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase()
}

function isRecord(value: unknown): value is CancellationRecord {
  return typeof value === "object" && value !== null
}

function getNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getStatusLabel(status: string): string {
  if (status === "pending" || status === "verifying") return "Pending"
  if (status === "confirmed") return "Confirmed"
  if (status === "reservation_secured") return "Slot Secured"
  if (status === "contract_signing_required") return "Contract Signing Required"
  if (status === "active_rental") return "Active Rental"
  if (status === "rental_expired") return "Rental Expired"
  if (status === "completed") return "Completed"
  if (status === "cancelled") return "Cancelled"
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function getAdminLogs(booking: CancellationRecord): CancellationRecord[] {
  return Array.isArray(booking.adminLogs)
    ? booking.adminLogs.filter(isRecord).slice(-49)
    : []
}

function appendLog(
  booking: CancellationRecord,
  action: string,
  message: string,
  createdAt: string,
): CancellationRecord[] {
  return [
    ...getAdminLogs(booking),
    { action, message, createdAt },
  ]
}

function parseEventDate(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function calculateCancellationDaysBeforeEvent(
  eventDate: unknown,
  now = new Date(),
): number {
  const selected = parseEventDate(eventDate)
  if (!selected) return 0

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  selected.setHours(0, 0, 0, 0)
  return Math.ceil((selected.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export function hasPendingCancellation(booking: CancellationRecord): boolean {
  const cancellationStatus = normalize(booking.cancellationStatus)
  return (
    booking.cancellationRequested === true ||
    normalize(booking.status) === "cancellation_requested" ||
    cancellationStatus === "pending" ||
    cancellationStatus === "under review" ||
    cancellationStatus === "requested" ||
    normalize(booking.cancelRequestStatus) === "pending"
  )
}

export function bookingBelongsToUser(booking: CancellationRecord, userId: string): boolean {
  return String(booking.userId || booking.uid || "") === userId
}

export type CancellationEligibility = {
  allowed: boolean
  reason?: string
  daysBeforeEvent: number
}

export function evaluateCancellationEligibility(
  booking: CancellationRecord,
  now = new Date(),
): CancellationEligibility {
  const status = normalize(booking.status)
  const cancellationStatus = normalize(booking.cancellationStatus)
  const daysBeforeEvent = calculateCancellationDaysBeforeEvent(booking.date, now)

  if (hasPendingCancellation(booking)) {
    return { allowed: false, reason: "This booking already has a cancellation request under review.", daysBeforeEvent }
  }

  if (TERMINAL_STATUSES.has(status)) {
    return { allowed: false, reason: "This booking is no longer eligible for cancellation.", daysBeforeEvent }
  }

  if (cancellationStatus === "approved") {
    return { allowed: false, reason: "This booking has already been cancelled.", daysBeforeEvent }
  }

  const cooldownUntil = typeof booking.cancellationCooldownUntil === "string"
    ? new Date(booking.cancellationCooldownUntil).getTime()
    : 0
  if (cancellationStatus === "declined" && Number.isFinite(cooldownUntil) && cooldownUntil > now.getTime()) {
    return { allowed: false, reason: "Please wait before submitting another cancellation request.", daysBeforeEvent }
  }

  const paymentStatus = normalize(booking.paymentStatus)
  if (PAYMENT_UNAVAILABLE_STATUSES.has(paymentStatus)) {
    return { allowed: false, reason: "Cancellation is available after the booking payment is secured.", daysBeforeEvent }
  }

  if (booking.isSlotSecured !== true && booking.verifiedByAdmin !== true) {
    return { allowed: false, reason: "Cancellation is available after the booking is secured.", daysBeforeEvent }
  }

  if (daysBeforeEvent <= CANCELLATION_CLOSED_DAYS) {
    return { allowed: false, reason: "Cancellation is no longer available because the event is within 7 days.", daysBeforeEvent }
  }

  return { allowed: true, daysBeforeEvent }
}

export function buildCancellationRequestFields(
  booking: CancellationRecord,
  reason: string,
  requestedAt: string,
  metadata: { actorId?: string; actorName?: string; notes?: string } = {},
): CancellationRecord {
  const status = normalize(booking.status)
  const previousBookingStatus = String(booking.bookingStatus || "").trim() || getStatusLabel(status)
  const previousPaymentStatus = String(booking.paymentStatus || "").trim() || "unpaid"

  return {
    previousStatus: booking.status || "pending",
    previousBookingStatus,
    previousPaymentStatus,
    status: "cancellation_requested",
    bookingStatus: "Cancellation Under Review",
    cancellationRequested: true,
    cancellationRequestedAt: requestedAt,
    cancellationStatus: "Pending",
    cancellationStatusLabel: "Pending Review",
    cancellationSource: "client" as CancellationSource,
    cancellationType: "client_request" as CancellationType,
    ...(metadata.actorId ? {
      cancellationActorId: metadata.actorId,
      cancellationRequestedBy: metadata.actorId,
    } : {}),
    ...(metadata.actorName ? {
      cancellationActorName: metadata.actorName,
      cancellationRequestedByName: metadata.actorName,
    } : {}),
    ...(metadata.notes ? { cancellationNotes: metadata.notes } : {}),
    cancellationReason: reason,
    cancellationReviewedAt: null,
    cancellationDeclineReason: null,
    cancellationDeclinedAt: null,
    cancellationUnderReview: true,
    cancelRequestStatus: "Pending",
    cancelReason: reason,
    cancelRequestedAt: requestedAt,
    adminCancelDecision: null,
    adminCancelReason: "",
    lastActivityAt: requestedAt,
    updatedAt: requestedAt,
    adminLogs: appendLog(
      booking,
      "REQUEST_CANCELLATION",
      `Client requested cancellation. Reason: ${reason}`,
      requestedAt,
    ),
  }
}

function hasVerifiedPayment(booking: CancellationRecord): boolean {
  return getNumber(booking.amountPaid) > 0 || [
    "verified",
    "paid",
    "partial",
    "slot_verified",
  ].includes(normalize(booking.paymentStatus))
}

function addDaysToIso(value: string, days: number): string {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date.toISOString()
}

function addHoursToIso(value: string, hours: number): string {
  return new Date(new Date(value).getTime() + hours * 60 * 60 * 1000).toISOString()
}

export function buildCancellationApprovalFields(
  booking: CancellationRecord,
  reviewedAt: string,
  reviewer: { id?: string; name?: string } = {},
): CancellationRecord {
  const daysBeforeEvent = calculateCancellationDaysBeforeEvent(booking.date, new Date(reviewedAt))
  const eligible = daysBeforeEvent >= REFUND_ELIGIBLE_DAYS && hasVerifiedPayment(booking)
  const totalPrice = getNumber(booking.totalPrice)

  return {
    status: "cancelled",
    bookingStatus: "Cancelled",
    cancellationRequested: false,
    cancellationStatus: "Approved",
    cancellationStatusLabel: "Cancellation Approved",
    cancellationSource: booking.cancellationSource || "client",
    cancellationType: booking.cancellationType || "client_request",
    cancellationReviewedAt: reviewedAt,
    cancellationApprovedAt: reviewedAt,
    cancelledAt: reviewedAt,
    cancellationUnderReview: false,
    cancelRequestStatus: null,
    adminCancelDecision: "approved",
    adminCancelReason: "",
    ...(reviewer.id ? {
      cancellationReviewedBy: reviewer.id,
      cancellationApprovedBy: reviewer.id,
    } : {}),
    ...(reviewer.name ? {
      cancellationReviewedByName: reviewer.name,
      cancellationApprovedByName: reviewer.name,
    } : {}),
    refundEligible: eligible,
    refundMethod: eligible ? "Cash" : null,
    refundMode: eligible ? "Cash" : null,
    refundStatus: eligible ? "eligible" : "not_eligible",
    refundAmount: eligible ? totalPrice : 0,
    refundReadyDate: eligible ? addDaysToIso(reviewedAt, 7) : null,
    refundEligibilityNote: eligible ? "May be eligible for refund" : "Non-refundable based on policy",
    refundClaimNote: eligible
      ? "Refund may be claimed onsite in cash within the allowed processing period."
      : "No refund will be processed based on the venue cancellation policy.",
    refundInstructions: eligible
      ? "Refund may be claimed onsite in cash within the allowed processing period."
      : "No refund will be processed based on the venue cancellation policy.",
    daysBeforeEventAtCancellation: daysBeforeEvent,
    lastActivityAt: reviewedAt,
    updatedAt: reviewedAt,
    adminLogs: appendLog(
      booking,
      "APPROVE_CANCELLATION",
      eligible
        ? "Admin approved cancellation. Refund is eligible and can be claimed onsite in cash."
        : "Admin approved cancellation. Booking is non-refundable based on policy.",
      reviewedAt,
    ),
  }
}

export function buildCancellationDeclineFields(
  booking: CancellationRecord,
  reason: string,
  reviewedAt: string,
  reviewer: { id?: string; name?: string } = {},
): CancellationRecord {
  const previousStatus = normalize(String(booking.previousStatus || ""))
  const restoredStatus = previousStatus && previousStatus !== "cancellation_requested"
    ? previousStatus === "verifying"
      ? "pending"
      : previousStatus === "fully_paid"
        ? "confirmed"
        : previousStatus
    : "confirmed"
  const previousBookingStatus = String(booking.previousBookingStatus || "").trim()
  const normalizedPreviousBookingStatus = normalize(previousBookingStatus)
  const restoredBookingStatus = previousBookingStatus &&
    !["pending verification", "verifying"].includes(normalizedPreviousBookingStatus) &&
    normalizedPreviousBookingStatus !== restoredStatus
    ? previousBookingStatus
    : getStatusLabel(restoredStatus)
  const restoredPaymentStatus = String(
    booking.previousPaymentStatus || booking.paymentStatus || "paid",
  ).trim()
  const restoredSlotSecured = booking.isSlotSecured === true || booking.verifiedByAdmin === true || [
    "confirmed",
    "reservation_secured",
    "contract_signing_required",
    "active_rental",
  ].includes(restoredStatus)

  return {
    status: restoredStatus,
    bookingStatus: restoredBookingStatus,
    paymentStatus: restoredPaymentStatus,
    isSlotSecured: restoredSlotSecured,
    cancellationRequested: false,
    cancellationStatus: "Declined",
    cancellationStatusLabel: "Cancellation Declined",
    cancellationSource: booking.cancellationSource || "client",
    cancellationType: booking.cancellationType || "client_request",
    cancellationReviewedAt: reviewedAt,
    cancellationUnderReview: false,
    cancellationDeclinedAt: reviewedAt,
    cancellationDeclineReason: reason,
    cancelRequestStatus: null,
    adminCancelDecision: "declined",
    adminCancelReason: reason,
    cancellationNotes: booking.cancellationNotes || reason,
    ...(reviewer.id ? { cancellationReviewedBy: reviewer.id } : {}),
    ...(reviewer.name ? { cancellationReviewedByName: reviewer.name } : {}),
    cancellationCooldownUntil: addHoursToIso(reviewedAt, 1),
    refundEligible: false,
    refundMethod: null,
    refundMode: null,
    refundStatus: "Not Applicable",
    refundAmount: 0,
    refundRequestedAt: null,
    refundReadyDate: null,
    refundEligibilityNote: null,
    refundClaimNote: null,
    refundInstructions: null,
    daysBeforeEventAtCancellation: null,
    previousStatus: null,
    previousBookingStatus: null,
    previousPaymentStatus: null,
    lastActivityAt: reviewedAt,
    updatedAt: reviewedAt,
    adminLogs: appendLog(
      booking,
      "DECLINE_CANCELLATION_REQUEST",
      `Cancellation request declined. Reason: ${reason}`,
      reviewedAt,
    ),
  }
}

function formatAuditValue(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "Not recorded"
}

function formatCancellationSource(value: unknown): string {
  if (value === "client") return "Client"
  if (value === "admin") return "Admin"
  if (value === "system") return "System"
  return "Not recorded"
}

function formatCancellationType(value: unknown): string {
  if (value === "client_request") return "Client request"
  if (value === "admin_action") return "Admin action"
  if (value === "automatic_expiry") return "Automatic payment-window expiry"
  return "Not recorded"
}

/** Returns only explicitly stored audit data; legacy gaps remain visible. */
export function getCancellationAudit(booking: CancellationRecord): CancellationAuditView {
  return {
    source: formatCancellationSource(booking.cancellationSource),
    actorName: formatAuditValue(
      booking.cancellationActorName ||
        booking.cancellationApprovedByName ||
        booking.cancellationReviewedByName ||
        booking.cancellationRequestedByName ||
        booking.cancelledByName,
    ),
    type: formatCancellationType(booking.cancellationType),
    reason: formatAuditValue(booking.cancellationReason || booking.cancelReason),
    notes: formatAuditValue(
      booking.cancellationNotes || booking.adminCancelReason || booking.cancellationDeclineReason,
    ),
    date: formatAuditValue(
      booking.cancelledAt ||
        booking.cancellationReviewedAt ||
        booking.cancellationRequestedAt ||
        booking.cancelRequestedAt,
    ),
  }
}
