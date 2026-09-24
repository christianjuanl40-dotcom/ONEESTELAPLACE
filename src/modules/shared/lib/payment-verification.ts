import {
  calculatePaymentSummary,
  getPaymentRecordAmount,
  isVerifiedPaymentRecord,
  toPaymentAmount,
  type BookingLike,
  type PaymentRecordLike,
  type PaymentSummary,
} from "./payment-calculations"
import { normalizeStatus } from "./booking-helpers"

export interface VerifiedPaymentTransition {
  booking: Record<string, unknown>
  payment: PaymentRecordLike
  records: PaymentRecordLike[]
  summary: PaymentSummary
  verifiedAmount: number
  alreadyVerified: boolean
}

interface VerificationOptions {
  verifiedAmount: number
  adminName: string
  adminNote?: string
  now?: string
}

function isOfficeBooking(booking: Record<string, unknown>): boolean {
  return (
    booking.isOfficeRental === true ||
    booking.bookingCategory === "office" ||
    String(booking.venue || "").toLowerCase().includes("office")
  )
}

function appendAdminLog(
  booking: Record<string, unknown>,
  actionOrMessage: string,
  messageOrNow: string,
  actionNow?: string,
): Array<Record<string, string>> {
  const existing = Array.isArray(booking.adminLogs)
    ? booking.adminLogs.filter((entry): entry is Record<string, string> => Boolean(entry && typeof entry === "object"))
    : []

  return [
    ...existing,
    {
      action: actionNow ? actionOrMessage : "VERIFY_PAYMENT",
      message: actionNow ? messageOrNow : actionOrMessage,
      createdAt: actionNow || messageOrNow,
    },
  ]
}

function getPaymentStatus(summary: PaymentSummary): string {
  if (summary.fullyPaid) return "paid"
  if (summary.downpaymentComplete) return "partial"
  if (summary.moneyReceivedTotal > 0) return "incomplete"
  if (summary.overallStatus === "for_review") return "for_review"
  if (summary.overallStatus === "rejected") return "rejected"
  return "incomplete"
}

function isModificationUnderReview(booking: Record<string, unknown>): boolean {
  return [booking.status, booking.bookingStatus].some((value) => {
    const normalized = normalizeStatus(value)
    return normalized === "modification_under_review" || normalized === "modification under review"
  })
}

function isPreviouslySecured(booking: Record<string, unknown>): boolean {
  return booking.isSlotSecured === true || [
    booking.status,
    booking.bookingStatus,
  ].some((value) => [
    "confirmed",
    "reservation_secured",
    "slot secured",
    "contract_signing_required",
    "contract signing required",
    "active_rental",
  ].includes(normalizeStatus(value)))
}

function buildDecisionBookingFields(
  booking: Record<string, unknown>,
  summary: PaymentSummary,
  now: string,
  lastPaymentAmount: number,
  message: string,
  adminName: string,
): Record<string, unknown> {
  const officeBooking = isOfficeBooking(booking)
  const paymentStatus = getPaymentStatus(summary)
  const paymentSecured = officeBooking ? summary.fullyPaid : summary.downpaymentComplete
  const previouslySecured = isPreviouslySecured(booking)
  const modificationUnderReview = isModificationUnderReview(booking)
  const slotSecured = paymentSecured || previouslySecured
  const selectedDownpaymentAmount = toPaymentAmount(booking.selectedDownpaymentAmount) || summary.requiredDownpayment
  const downpaymentPaid = summary.requiredDownpayment > 0
    ? Math.min(summary.acceptedDpPaid, selectedDownpaymentAmount)
    : 0

  const status = modificationUnderReview
    ? String(booking.status || "modification_under_review")
    : officeBooking
      ? paymentSecured ? "reservation_secured" : "pending"
      : slotSecured ? "confirmed" : "pending"
  const bookingStatus = modificationUnderReview
    ? String(booking.bookingStatus || "Modification Under Review")
    : officeBooking
      ? paymentSecured ? "Slot Secured" : "Pending"
      : slotSecured ? "Confirmed" : "Pending"
  const paymentStage = summary.fullyPaid
    ? "Fully Paid"
    : summary.downpaymentComplete
      ? "Settle Remaining Balance"
      : summary.moneyReceivedTotal > 0
        ? "Complete Downpayment"
        : "Initial Payment"
  const contractSigned = booking.contractSigned === true || booking.contractStatus === "Signed"

  return {
    status,
    bookingStatus,
    paymentStatus,
    paymentStage,
    balanceStatus: summary.fullyPaid ? "Settled" : "With Remaining Balance",
    isSlotSecured: slotSecured,
    amountPaid: summary.acceptedTotalPaid,
    lastPaymentAmount,
    downpaymentPaid,
    downpaymentRemaining: summary.remainingDownpayment,
    selectedDownpaymentAmount: selectedDownpaymentAmount || booking.selectedDownpaymentAmount || 0,
    remainingBalance: summary.remainingBalance,
    remainingBalancePaid: summary.fullyPaid,
    hasActivePaymentSubmission: summary.hasPendingSubmission,
    paymentAmount: lastPaymentAmount,
    pendingPaymentAmount: summary.hasPendingSubmission ? summary.pendingCurrentAmount : 0,
    contractSigningRequired: Boolean(booking.contractSigningRequired || summary.acceptedTotalPaid > 0),
    contractStatus: contractSigned
      ? "Signed"
      : summary.acceptedTotalPaid > 0
        ? "Pending Signature"
        : booking.contractStatus || "Not Available",
    contractSigned,
    officeReservationStatus: officeBooking
      ? paymentSecured ? "reservation_secured" : "pending_verification"
      : booking.officeReservationStatus,
    officeContractSigningRequired: officeBooking ? paymentSecured : booking.officeContractSigningRequired,
    paymentReviewedAt: now,
    paymentReviewedBy: adminName,
    lastActivityAt: now,
    updatedAt: now,
    adminLogs: appendAdminLog(booking, "REVIEW_PAYMENT", message, now),
  }
}

export function buildVerifiedPaymentTransition(
  bookingInput: BookingLike & Record<string, unknown>,
  records: PaymentRecordLike[],
  targetInput: PaymentRecordLike,
  options: VerificationOptions,
): VerifiedPaymentTransition {
  const booking = { ...bookingInput }
  const target = { ...targetInput }
  const alreadyVerified = isVerifiedPaymentRecord(target)
  const submittedAmount = getPaymentRecordAmount(target)
  const verifiedAmount = alreadyVerified
    ? submittedAmount
    : options.verifiedAmount || submittedAmount
  const now = options.now || new Date().toISOString()
  const adminNote = options.adminNote?.trim() || ""

  const payment: PaymentRecordLike = {
    ...target,
    amount: verifiedAmount,
    amountPaid: verifiedAmount,
    status: "Verified",
    verificationStatus: "Verified",
    reviewedBy: alreadyVerified ? target.reviewedBy || options.adminName : options.adminName,
    reviewedAt: alreadyVerified ? target.reviewedAt || now : now,
    adminNote: alreadyVerified ? target.adminNote || adminNote : adminNote,
    updatedAt: alreadyVerified ? target.updatedAt || now : now,
  }

  const updatedRecords = records.map((record) => (
    String(record.id || "") === String(target.id || "") ? payment : record
  ))
  const summary = calculatePaymentSummary(booking, updatedRecords)
  const officeBooking = isOfficeBooking(booking)
  const paymentStatus = getPaymentStatus(summary)
  const slotSecured = officeBooking ? summary.fullyPaid : summary.downpaymentComplete
  const contractSigned = booking.contractSigned === true || booking.contractStatus === "Signed"
  const contractStatus = contractSigned
    ? "Signed"
    : alreadyVerified || summary.acceptedTotalPaid > 0
      ? "Pending Signature"
      : booking.contractStatus || "Not Available"
  const selectedDownpaymentAmount = toPaymentAmount(
    booking.selectedDownpaymentAmount,
  ) || summary.requiredDownpayment
  const downpaymentPaid = summary.requiredDownpayment > 0
    ? Math.min(summary.acceptedDpPaid, selectedDownpaymentAmount)
    : 0
  const bookingStatus = officeBooking
     ? summary.fullyPaid ? "Slot Secured" : "Pending"
     : slotSecured ? "Confirmed" : "Pending"
  const status = officeBooking
    ? summary.fullyPaid ? "reservation_secured" : "pending"
    : slotSecured ? "confirmed" : "pending"
  const paymentStage = summary.fullyPaid
    ? "Fully Paid"
    : summary.downpaymentComplete
      ? "Settle Remaining Balance"
      : summary.moneyReceivedTotal > 0
        ? "Complete Downpayment"
        : "Initial Payment"

  // Payment verification must not resolve or hide a separate modification
  // request. The admin still needs to review that request before the booking
  // can return to its previous status.
  const modificationUnderReview =
    normalizeStatus(booking.status) === "modification_under_review" ||
    normalizeStatus(booking.status) === "modification under review" ||
    normalizeStatus(booking.bookingStatus) === "modification under review"
  const nextStatus = modificationUnderReview
    ? String(booking.status || "modification_under_review")
    : status
  const nextBookingStatus = modificationUnderReview
    ? String(booking.bookingStatus || "Modification Under Review")
    : bookingStatus

  const message = summary.fullyPaid
    ? "Admin verified payment. The booking is fully paid."
    : summary.downpaymentComplete
      ? `Admin verified payment. The downpayment is complete and the remaining balance is ${summary.remainingBalance.toLocaleString()}.`
      : `Admin verified payment. Downpayment remaining: ${summary.remainingDownpayment.toLocaleString()}.`

  const updatedBooking: Record<string, unknown> = {
    ...booking,
    status: nextStatus,
    bookingStatus: nextBookingStatus,
    paymentStatus,
    paymentStage,
    balanceStatus: summary.fullyPaid ? "Settled" : "With Remaining Balance",
    isSlotSecured: slotSecured,
    amountPaid: summary.acceptedTotalPaid,
    lastPaymentAmount: verifiedAmount,
    downpaymentPaid,
    downpaymentRemaining: summary.remainingDownpayment,
    selectedDownpaymentAmount: selectedDownpaymentAmount || booking.selectedDownpaymentAmount || 0,
    remainingBalance: summary.remainingBalance,
    remainingBalancePaid: summary.fullyPaid,
    hasActivePaymentSubmission: summary.hasPendingSubmission,
    paymentAmount: verifiedAmount,
    pendingPaymentAmount: summary.hasPendingSubmission ? summary.pendingCurrentAmount : 0,
    paymentVerifiedAt: alreadyVerified ? booking.paymentVerifiedAt || now : now,
    paymentReviewedAt: alreadyVerified ? booking.paymentReviewedAt || now : now,
    paymentVerifiedBy: alreadyVerified ? booking.paymentVerifiedBy || options.adminName : options.adminName,
    paymentReviewedBy: alreadyVerified ? booking.paymentReviewedBy || options.adminName : options.adminName,
    paymentVerifiedAmount: verifiedAmount,
    verifiedByAdmin: true,
    verifiedAt: alreadyVerified ? booking.verifiedAt || now : now,
    contractSigningRequired: Boolean(booking.contractSigningRequired || alreadyVerified || summary.acceptedTotalPaid > 0),
    contractStatus,
    contractSigned,
    officeReservationStatus: officeBooking
      ? summary.fullyPaid ? "reservation_secured" : "pending_verification"
      : booking.officeReservationStatus,
    officeContractSigningRequired: officeBooking ? summary.fullyPaid : booking.officeContractSigningRequired,
    lastActivityAt: alreadyVerified ? booking.lastActivityAt || now : now,
    updatedAt: now,
    adminLogs: alreadyVerified ? booking.adminLogs : appendAdminLog(booking, message, now),
  }

  return {
    booking: updatedBooking,
    payment,
    records: updatedRecords,
    summary,
    verifiedAmount,
    alreadyVerified,
  }
}

export type PaymentDecisionAction = "reject" | "incomplete"

export interface PaymentDecisionOptions {
  verifiedAmount?: number
  adminName: string
  adminNote?: string
  now?: string
}

export function buildPaymentDecisionTransition(
  bookingInput: BookingLike & Record<string, unknown>,
  records: PaymentRecordLike[],
  targetInput: PaymentRecordLike,
  action: PaymentDecisionAction,
  options: PaymentDecisionOptions,
): VerifiedPaymentTransition {
  const booking = { ...bookingInput }
  const target = { ...targetInput }
  const submittedAmount = getPaymentRecordAmount(target)
  const now = options.now || new Date().toISOString()
  const note = options.adminNote?.trim() || ""
  const receivedAmount = action === "incomplete"
    ? options.verifiedAmount || submittedAmount
    : submittedAmount
  const payment: PaymentRecordLike = {
    ...target,
    ...(action === "incomplete"
      ? {
          amount: receivedAmount,
          amountPaid: receivedAmount,
          amountReceived: receivedAmount,
          requestedAmount: target.requestedAmount || submittedAmount,
        }
      : {}),
    status: action === "incomplete" ? "Incomplete" : "Rejected",
    verificationStatus: action === "incomplete" ? "Incomplete" : "Rejected",
    reviewedBy: options.adminName,
    reviewedAt: now,
    updatedAt: now,
    adminNote: note,
    ...(action === "reject" ? { rejectionReason: note } : {}),
  }
  const updatedRecords = records.map((record) => (
    String(record.id || "") === String(target.id || "") ? payment : record
  ))
  const summary = calculatePaymentSummary(booking, updatedRecords)
  const message = action === "incomplete"
    ? `Admin recorded an incomplete payment. Amount received: ${receivedAmount.toLocaleString()}. ${note}`
    : `Admin rejected the payment. ${note}`
  const updatedBooking: Record<string, unknown> = {
    ...booking,
    ...buildDecisionBookingFields(booking, summary, now, receivedAmount, message, options.adminName),
    ...(action === "incomplete"
      ? {
          incompletePaymentNote: note,
          incompletePaymentReason: note,
          paymentVerifiedAmount: receivedAmount,
          paymentVerifiedAt: now,
          paymentVerifiedBy: options.adminName,
          verifiedByAdmin: true,
          verifiedAt: now,
        }
      : {
          paymentRejectedReason: note,
          paymentRejectionReason: note,
          paymentRejectedAt: now,
        }),
  }

  return {
    booking: updatedBooking,
    payment,
    records: updatedRecords,
    summary,
    verifiedAmount: receivedAmount,
    alreadyVerified: false,
  }
}
