import { normalizePaymentStatusValue, type PaymentRecordLike } from "./payment-calculations"

/** Payment documents use id; receipt/history projections carry paymentId. */
export function getPaymentSubmissionId(record: PaymentRecordLike | null | undefined): string {
  return String(record?.paymentId || record?.id || "").trim()
}

export function getPaymentHistoryKey(record: PaymentRecordLike): string {
  const paymentId = getPaymentSubmissionId(record)
  if (paymentId) return `payment:${paymentId}`
  const receiptNumber = String(record.receiptNumber || "").trim()
  return receiptNumber ? `receipt:${receiptNumber}` : ""
}

function readReviewNote(record: PaymentRecordLike): string {
  const note = typeof record.adminNote === "string" ? record.adminNote.trim() : ""
  if (note) return note

  // rejectionReason is a legacy alias on THIS record, only for a rejection.
  // Conflicting/newer states must never resurrect an old rejection reason.
  const states = [record.status, record.verificationStatus, record.paymentStatus]
    .map(normalizePaymentStatusValue)
    .filter(Boolean)
  const isRejected = states.length > 0 && states.every((state) => state === "rejected")
  return isRejected && typeof record.rejectionReason === "string"
    ? record.rejectionReason.trim()
    : ""
}

/**
 * The exact payment document is authoritative, including an empty/missing note.
 * A legacy projection may supply its own note only when it has a stable payment
 * ID and no authoritative document is available. Booking-level notes are not
 * transaction notes and deliberately are not accepted as a fallback source.
 */
export function resolvePaymentReviewNote(
  selected: PaymentRecordLike | null | undefined,
  records: ReadonlyArray<PaymentRecordLike> = [],
): string {
  const paymentId = getPaymentSubmissionId(selected)
  if (!selected || !paymentId) return ""
  const authoritative = records.find((record) => getPaymentSubmissionId(record) === paymentId)
  return readReviewNote(authoritative || selected)
}
