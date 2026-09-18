import {
  calculatePaymentSummary,
  getPaymentRecordAmount,
  isVerifiedPaymentRecord,
  toPaymentAmount,
  type BookingLike,
  type PaymentRecordLike,
  type PaymentSummary,
} from "./payment-calculations"

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
  message: string,
  now: string,
): Array<Record<string, string>> {
  const existing = Array.isArray(booking.adminLogs)
    ? booking.adminLogs.filter((entry): entry is Record<string, string> => Boolean(entry && typeof entry === "object"))
    : []

  return [
    ...existing,
    { action: "VERIFY_PAYMENT", message, createdAt: now },
  ]
}

function getPaymentStatus(summary: PaymentSummary): string {
  if (summary.fullyPaid) return "paid"
  if (summary.downpaymentComplete) return "partial"
  if (summary.moneyReceivedTotal > 0) return "incomplete"
  return summary.overallStatus === "for_review" ? "for_review" : "incomplete"
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
    : alreadyVerified || summary.acceptedVerifiedTotal > 0
      ? "Pending Signature"
      : booking.contractStatus || "Not Available"
  const selectedDownpaymentAmount = toPaymentAmount(
    booking.selectedDownpaymentAmount,
  ) || summary.requiredDownpayment
  const downpaymentPaid = summary.requiredDownpayment > 0
    ? Math.min(summary.downpaymentCreditedTotal, selectedDownpaymentAmount)
    : 0
  const bookingStatus = officeBooking
    ? summary.fullyPaid ? "Slot Secured" : "Pending Verification"
    : slotSecured ? "Confirmed" : "Pending Verification"
  const status = officeBooking
    ? summary.fullyPaid ? "reservation_secured" : "verifying"
    : slotSecured ? "confirmed" : "verifying"
  const paymentStage = summary.fullyPaid
    ? "Fully Paid"
    : summary.downpaymentComplete
      ? "Settle Remaining Balance"
      : summary.moneyReceivedTotal > 0
        ? "Complete Downpayment"
        : "Initial Payment"

  const message = summary.fullyPaid
    ? "Admin verified payment. The booking is fully paid."
    : summary.downpaymentComplete
      ? `Admin verified payment. The downpayment is complete and the remaining balance is ${summary.remainingBalance.toLocaleString()}.`
      : `Admin verified payment. Downpayment remaining: ${summary.remainingDownpayment.toLocaleString()}.`

  const updatedBooking: Record<string, unknown> = {
    ...booking,
    status,
    bookingStatus,
    paymentStatus,
    paymentStage,
    balanceStatus: summary.fullyPaid ? "Settled" : "With Remaining Balance",
    isSlotSecured: slotSecured,
    amountPaid: summary.acceptedVerifiedTotal,
    lastPaymentAmount: verifiedAmount,
    downpaymentPaid,
    downpaymentRemaining: summary.remainingDownpayment,
    selectedDownpaymentAmount: selectedDownpaymentAmount || booking.selectedDownpaymentAmount || 0,
    remainingBalance: summary.remainingBalance,
    remainingBalancePaid: summary.fullyPaid,
    hasActivePaymentSubmission: summary.hasPendingSubmission,
    paymentAmount: verifiedAmount,
    pendingPaymentAmount: summary.hasPendingSubmission
      ? booking.pendingPaymentAmount || 0
      : 0,
    paymentVerifiedAt: alreadyVerified ? booking.paymentVerifiedAt || now : now,
    paymentReviewedAt: alreadyVerified ? booking.paymentReviewedAt || now : now,
    paymentVerifiedBy: alreadyVerified ? booking.paymentVerifiedBy || options.adminName : options.adminName,
    paymentReviewedBy: alreadyVerified ? booking.paymentReviewedBy || options.adminName : options.adminName,
    paymentVerifiedAmount: verifiedAmount,
    verifiedByAdmin: true,
    verifiedAt: alreadyVerified ? booking.verifiedAt || now : now,
    contractSigningRequired: Boolean(booking.contractSigningRequired || alreadyVerified || summary.acceptedVerifiedTotal > 0),
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
