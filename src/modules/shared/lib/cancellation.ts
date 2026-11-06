import { calculatePaymentSummary, type PaymentRecordLike } from "./payment-calculations"

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

const ADMIN_DIRECT_CANCELLATION_STATUSES = new Set([
  "pending",
  "approved",
  "confirmed",
  "fully_paid",
  "reservation_secured",
  "slot_secured",
  "slot_verified",
  "contract_signing_required",
  "active_rental",
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
  metadata: CancellationRecord = {},
): CancellationRecord[] {
  return [
    ...getAdminLogs(booking),
    { action, message, createdAt, ...metadata },
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

/**
 * Direct administrative cancellation uses the existing cancellation/refund
 * policy, but it must never operate on a terminal lifecycle record or an
 * already-released rental. The API still rechecks this inside its transaction.
 */
export function isAdminDirectCancellationStatusEligible(booking: CancellationRecord): boolean {
  return ADMIN_DIRECT_CANCELLATION_STATUSES.has(normalize(booking.status))
}

export function hasActiveModificationForCancellation(booking: CancellationRecord): boolean {
  const status = normalize(booking.status)
  const bookingStatus = normalize(booking.bookingStatus)
  const modificationStatus = normalize(booking.modificationStatus)
  const requestStatus = normalize(booking.modifyRequestStatus)

  return (
    status === "modification_under_review" ||
    status === "modification under review" ||
    bookingStatus === "modification_under_review" ||
    bookingStatus === "modification under review" ||
    booking.modificationRequested === true ||
    booking.modificationUnderReview === true ||
    ["under review", "modification_under_review", "modification under review"].includes(modificationStatus) ||
    ["pending", "under review", "modification_under_review", "modification under review"].includes(requestStatus)
  )
}

export type CancellationEligibility = {
  allowed: boolean
  reason?: string
  daysBeforeEvent: number
}

export function evaluateCancellationEligibility(
  booking: CancellationRecord,
  now = new Date(),
  records: ReadonlyArray<PaymentRecordLike> = [],
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

  const paymentSummary = calculatePaymentSummary(booking, records)
  if (paymentSummary.moneyReceivedTotal <= 0) {
    return { allowed: false, reason: "Cancellation is available after a payment is recorded.", daysBeforeEvent }
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
  records: ReadonlyArray<PaymentRecordLike> = [],
): CancellationRecord {
  const daysBeforeEvent = calculateCancellationDaysBeforeEvent(booking.date, new Date(reviewedAt))
  const paymentSummary = calculatePaymentSummary(booking, records)
  const eligible = daysBeforeEvent >= REFUND_ELIGIBLE_DAYS && paymentSummary.moneyReceivedTotal > 0
  const refundableAmount = eligible ? paymentSummary.moneyReceivedTotal : 0

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
    refundAmount: refundableAmount,
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

export function buildAdminCancellationFields(
  booking: CancellationRecord,
  reason: string,
  reviewedAt: string,
  reviewer: { id?: string; name?: string } = {},
  records: ReadonlyArray<PaymentRecordLike> = [],
): CancellationRecord {
  const approved = buildCancellationApprovalFields(
    {
      ...booking,
      cancellationSource: "admin",
      cancellationType: "admin_action",
      cancellationReason: reason,
      cancellationNotes: reason,
    },
    reviewedAt,
    reviewer,
    records,
  )
  const previousStatus = booking.status || "pending"
  const previousBookingStatus = booking.bookingStatus || getStatusLabel(normalize(previousStatus))
  const previousPaymentStatus = booking.paymentStatus || "unpaid"

  return {
    ...approved,
    previousStatus,
    previousBookingStatus,
    previousPaymentStatus,
    cancellationSource: "admin" as CancellationSource,
    cancellationType: "admin_action" as CancellationType,
    cancellationReason: reason,
    cancelReason: reason,
    cancellationNotes: reason,
    ...(reviewer.id ? {
      cancellationActorId: reviewer.id,
      cancellationRequestedBy: reviewer.id,
      cancelledBy: reviewer.id,
    } : {}),
    ...(reviewer.name ? {
      cancellationActorName: reviewer.name,
      cancellationRequestedByName: reviewer.name,
      cancelledByName: reviewer.name,
    } : {}),
    adminCancelDecision: "approved",
    adminCancelReason: reason,
    adminLogs: appendLog(
      booking,
      "ADMIN_CANCEL_BOOKING",
      `Administrator cancelled the booking. Reason: ${reason}`,
      reviewedAt,
      {
        ...(reviewer.id ? { actorId: reviewer.id } : {}),
        ...(reviewer.name ? { actorName: reviewer.name } : {}),
        previousValues: {
          status: previousStatus,
          bookingStatus: previousBookingStatus,
          paymentStatus: previousPaymentStatus,
        },
        updatedValues: {
          status: "cancelled",
          bookingStatus: "Cancelled",
        },
      },
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
