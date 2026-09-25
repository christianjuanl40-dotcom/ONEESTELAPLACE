// CANONICAL PAYMENT CALCULATIONS
// ---------------------------------------------------------------------------
// Single source of truth for payment state. Both the Admin (Payment
// Verification) and Client (My Transactions) surfaces must derive their
// payment state from these functions so they can never disagree.
//
// Rules:
//  - A payment counts as ACCEPTED only when its individual payment record was
//    explicitly marked "verified" by Admin. Rejected and pending records
//    contribute nothing and never reset or reduce any total.
//  - acceptedVerifiedTotal = Σ(amount of VERIFIED records only) — the
//    officially verified-money diagnostic.
//  - acceptedTotalPaid / moneyReceivedTotal = verified amounts + received
//    amounts of INCOMPLETE payments (admin-entered amountReceived; falls back
//    to the submitted amount). An INCOMPLETE record keeps its own
//    status/receipt forever, but its actually-received money is real and MUST
//    reduce what the client still owes. This ledger drives balances,
//    downpayment completion and the stage flow.
//  - remainingBalance = max(0, bookingTotal − moneyReceivedTotal)
//    (the Settle Remaining Balance amount)
//  - requiredDownpayment = bookingTotal × (downPaymentPercentage || 50) / 100
//    (or the booking's selectedDownpaymentAmount when present)
//  - acceptedDpPaid = credited money applied to the downpayment, capped at the
//    required DP; remainingDownpayment = max(0, requiredDownpayment − acceptedDpPaid)
//    (the Complete Your Downpayment amount)
//  - downpaymentComplete = moneyReceivedTotal >= requiredDownpayment
//    (cumulative across records; a single record never needs to equal the
//    whole downpayment)
//  - Overall status priority (record-based):
//      1. "completed"  — moneyReceivedTotal >= bookingTotal (FULLY PAID)
//      2. "partial"    — downpaymentComplete AND remainingBalance > 0
//      3. "for_review" — a payment is waiting for Admin review and no
//                        received amount has completed the downpayment yet
//      4. "rejected"/"incomplete" — the most recent marked record (scanned
//                        newest→oldest, stopping at the first accepted
//                        payment) has not been resolved by a later accepted
//                        payment
//      5. "incomplete" — received amounts exist but the required downpayment
//                        is not complete
//  - Individual record statuses are INDEPENDENT of the overall status:
//    Payment #1 ₱5,500 INCOMPLETE + Payment #2 ₱2,000 VERIFIED → booking
//    PARTIAL while record #1 stays INCOMPLETE in history.
//  - Bookings with no payment records fall back to their own stored fields
//    (legacy bookings created before the per-payment records pipeline).
// ---------------------------------------------------------------------------

export type PaymentOverallStatus =
  | "for_review"
  | "incomplete"
  | "partial"
  | "completed"
  | "rejected"

export interface PaymentRecordLike {
  id?: string
  paymentId?: unknown
  paymentNumber?: unknown
  paymentSequence?: unknown
  bookingId?: unknown
  bookingCode?: unknown
  customerId?: unknown
  customerName?: unknown
  eventName?: unknown
  venueName?: unknown
  term?: unknown
  paymentType?: unknown
  paymentPurpose?: unknown
  paymentStatus?: unknown
  status?: unknown
  verificationStatus?: unknown
  method?: unknown
  paymentMethod?: unknown
  referenceNo?: unknown
  referenceNumber?: unknown
  bankReferenceNumber?: unknown
  proofUrl?: unknown
  amount?: unknown
  amountPaid?: unknown
  paymentAmount?: unknown
  // Money the admin confirmed was ACTUALLY RECEIVED on an INCOMPLETE payment
  // (written by markIncompletePayment). Incomplete money is never ACCEPTED
  // ledger money, but it WAS received and must still be credited toward
  // completing the required downpayment.
  amountReceived?: unknown
  // Original REQUESTED amount preserved when Mark as Incomplete rewrites
  // amount/amountPaid to the actual money received. Informational only.
  requestedAmount?: unknown
  submittedAt?: unknown
  paymentDate?: unknown
  createdAt?: unknown
  timestamp?: unknown
  dateGenerated?: unknown
  dateIssued?: unknown
  updatedAt?: unknown
  reviewedAt?: unknown
  reviewedBy?: unknown
  adminNote?: unknown
  rejectionReason?: unknown
  receiptNumber?: unknown
  isRemainingDownPayment?: unknown
}

export interface BookingLike {
  id?: unknown
  bookingCode?: unknown
  totalPrice?: unknown
  totalAmount?: unknown
  amount?: unknown
  price?: unknown
  paymentType?: unknown
  selectedDownpaymentAmount?: unknown
  downPaymentPercentage?: unknown
  downpaymentPaid?: unknown
  paymentStatus?: unknown
  amountPaid?: unknown
  paymentAmount?: unknown
  paidAmount?: unknown
  remainingBalance?: unknown
}

export interface PaymentSummary {
  // Canonical names used by the client and admin surfaces.
  totalBookingAmount: number
  requiredDpAmount: number
  // Accepted/credited money includes verified records and amounts that Admin
  // recorded as received on incomplete records. Pending and rejected records
  // remain excluded.
  acceptedTotalPaid: number
  acceptedDpPaid: number
  remainingDpBalance: number
  remainingBookingBalance: number
  // The newest transaction and newest unresolved transaction are exposed for
  // transaction-specific displays; they never affect the booking ledger.
  currentTransactionAmount: number
  pendingCurrentAmount: number
  bookingTotal: number
  requiredDownpayment: number
  // Officially VERIFIED money only. Incomplete, rejected, and pending records
  // never count here; acceptedTotalPaid is the customer-facing ledger total.
  acceptedVerifiedTotal: number
  // Officially VERIFIED down-payment money only. acceptedDpPaid is the
  // customer-facing DP ledger, including accepted incomplete money.
  verifiedDownpaymentPaid: number
  remainingVerifiedDownpayment: number
  // ALL valid money actually held: verified + received amounts of INCOMPLETE
  // payments. This drives balances, downpayment completion and stage flow.
  moneyReceivedTotal: number
  remainingBalance: number
  downpaymentComplete: boolean
  fullyPaid: boolean
  hasPendingSubmission: boolean
  overallStatus: PaymentOverallStatus
  // Money actually RECEIVED toward the downpayment (verified payments plus
  // the received amount of short/incomplete payments).
  downpaymentCreditedTotal: number
  remainingDownpayment: number
}

export interface PaymentDisplayModel {
  paymentType: "downpayment" | "full" | "remaining_balance" | "slot_reservation" | "unknown"
  paymentTypeLabel: string
  statusLabel: string
  amountLabel: string
  amount: number
  submittedAmount: number
  acceptedLabel: string
  acceptedAmount: number
  remainingLabel: string
  remainingAmount: number
}

export interface ReceiptPaymentSummary {
  totalBookingAmount: number
  requiredDpAmount: number
  totalVerifiedDpPaid: number
  remainingDp: number
  totalVerifiedPaid: number
  remainingBalance: number
}

export interface ReceiptTransactionDetails {
  paymentNumber: number
  paymentDate: string
  paymentType: PaymentRecordType
  paymentTypeLabel: string
  paymentMethod: string
  bankReference: string
  amount: number
  statusLabel: string
  isVerified: boolean
}

export interface ReceiptPresentation {
  transaction: ReceiptTransactionDetails
  summary: ReceiptPaymentSummary
}

export function normalizePaymentStatusValue(value: unknown): string {
  return String(value || "").toLowerCase().trim()
}

export function toPaymentAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const cleaned = String(value || "0").replace(/[^\d.]/g, "")
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : 0
}

export function getBookingTotal(booking: BookingLike): number {
  return toPaymentAmount(
    booking.totalAmount || booking.totalPrice || booking.amount || booking.price,
  )
}

export function getBookingStoredAmountPaid(booking: BookingLike): number {
  const amountPaid = toPaymentAmount(booking.amountPaid)
  if (amountPaid > 0) return amountPaid
  const paidAmount = toPaymentAmount(booking.paidAmount)
  if (paidAmount > 0) return paidAmount

  // paymentAmount is normally the latest client submission, not a cumulative
  // ledger. Only use it for legacy documents whose status explicitly proves
  // that the submitted amount was accepted.
  const status = normalizePaymentStatusValue(booking.paymentStatus)
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
    ].includes(status)
  ) {
    return toPaymentAmount(booking.paymentAmount)
  }

  return 0
}

export function getBookingRequiredDownpayment(booking: BookingLike): number {
  const isDownpayment = normalizePaymentStatusValue(booking.paymentType) === "downpayment"
  if (!isDownpayment) return 0
  const total = getBookingTotal(booking)
  const selected = toPaymentAmount(booking.selectedDownpaymentAmount)
  if (selected > 0) return selected
  const pct = toPaymentAmount(booking.downPaymentPercentage) || 50
  return total * (pct / 100)
}

export function isPendingPaymentRecord(record: PaymentRecordLike | null | undefined): boolean {
  if (!record) return false
  const status = normalizePaymentStatusValue(record.status)
  const verificationStatus = normalizePaymentStatusValue(record.verificationStatus)
  return (
    status === "for review" ||
    status === "for_review" ||
    status === "for verification" ||
    status === "for_verification" ||
    status === "awaiting onsite payment" ||
    status === "pending" ||
    status === "pending verification" ||
    status === "pending_verification" ||
    verificationStatus === "for review" ||
    verificationStatus === "for_review" ||
    verificationStatus === "for verification" ||
    verificationStatus === "for_verification" ||
    verificationStatus === "pending" ||
    verificationStatus === "pending verification" ||
    verificationStatus === "pending_verification" ||
    verificationStatus === "pending onsite verification"
  )
}

export function isVerifiedPaymentRecord(record: PaymentRecordLike | null | undefined): boolean {
  if (!record) return false
  const status = normalizePaymentStatusValue(record.status)
  const verificationStatus = normalizePaymentStatusValue(record.verificationStatus)
  return status === "verified" || verificationStatus === "verified"
}

export function isRejectedPaymentRecord(record: PaymentRecordLike | null | undefined): boolean {
  if (!record) return false
  const status = normalizePaymentStatusValue(record.status)
  const verificationStatus = normalizePaymentStatusValue(record.verificationStatus)
  return status === "rejected" || verificationStatus === "rejected"
}

export function isIncompletePaymentRecord(record: PaymentRecordLike | null | undefined): boolean {
  if (!record) return false
  const status = normalizePaymentStatusValue(record.status)
  const verificationStatus = normalizePaymentStatusValue(record.verificationStatus)
  return status === "incomplete" || verificationStatus === "incomplete"
}

// A payment is "accepted" ONLY when it was explicitly verified by Admin.
// Rejected/incomplete records are never accepted — they contribute ₱0.
// A matching receipt is informational only and never marks a payment accepted.
export function isAcceptedPaymentRecord(
  record: PaymentRecordLike | null | undefined,
  _receipts?: unknown[],
): boolean {
  if (!record) return false
  if (isRejectedPaymentRecord(record)) return false
  if (isIncompletePaymentRecord(record)) return false
  return isVerifiedPaymentRecord(record)
}

// Unresolved = still awaiting Admin action (pending review, not yet decided).
export function isUnresolvedPaymentRecord(
  record: PaymentRecordLike | null | undefined,
  _receipts?: unknown[],
): boolean {
  if (!record) return false
  if (isVerifiedPaymentRecord(record)) return false
  if (isRejectedPaymentRecord(record)) return false
  if (isIncompletePaymentRecord(record)) return false
  return true
}

export function getPaymentRecordAmount(record: PaymentRecordLike | null | undefined): number {
  return toPaymentAmount(record?.amount ?? record?.amountPaid ?? 0)
}

export type PaymentRecordType = "downpayment" | "full" | "remaining_balance" | "slot_reservation" | "unknown"

export function getPaymentRecordType(record: PaymentRecordLike | null | undefined): PaymentRecordType {
  if (!record) return "unknown"
  const term = normalizePaymentStatusValue(record.term)

  if (term.includes("down payment") || term.includes("downpayment")) return "downpayment"
  if (term.includes("remaining") || term.includes("balance") || term.includes("settle")) {
    return "remaining_balance"
  }
  if (term.includes("full")) return "full"
  if (term.includes("slot") || term.includes("reservation")) return "slot_reservation"
  return "unknown"
}

// A missing term is common on older payment records. For those records, the
// booking type is the only available indication that the payment belonged to
// the down-payment stage. Explicit balance/full/slot terms always win.
export function isDownpaymentPaymentRecord(
  record: PaymentRecordLike | null | undefined,
  booking?: BookingLike,
): boolean {
  if (!record) return false
  if (record.isRemainingDownPayment === true) return true

  const recordType = getPaymentRecordType(record)
  if (recordType !== "unknown") return recordType === "downpayment"
  return normalizePaymentStatusValue(booking?.paymentType) === "downpayment"
}

// Money CREDITED toward completing the downpayment by this single record:
//  - VERIFIED    → its full amount (accepted money).
//  - INCOMPLETE  → the amount admin confirmed was actually received
//                 (amountReceived when present and positive, else the
//                 submitted amount). Short payments still carry real money
//                 that must reduce what the client still has to pay — they
//                 just never count as ACCEPTED.
//  - REJECTED / pending / for-review → ₱0 (no money credited).
export function getPaymentRecordCreditedAmount(
  record: PaymentRecordLike | null | undefined,
): number {
  if (!record) return 0
  if (isRejectedPaymentRecord(record)) return 0
  if (isAcceptedPaymentRecord(record)) return getPaymentRecordAmount(record)
  if (isIncompletePaymentRecord(record)) {
    const received = toPaymentAmount(record.amountReceived)
    const submitted = Math.max(
      toPaymentAmount(record.amount),
      toPaymentAmount(record.amountPaid),
    )
    // A zero/absent received figure must NEVER zero out the credit — the
    // money handed over on this attempt stays credited toward completing
    // the downpayment (fall back to the submitted amount).
    return received > 0 ? received : submitted
  }
  return 0
}

export function getPaymentRecordTime(record: PaymentRecordLike | null | undefined): number {
  const raw = record?.submittedAt ?? record?.updatedAt
  if (!raw) return 0
  const time = new Date(String(raw)).getTime()
  return Number.isFinite(time) ? time : 0
}

function getReceiptSequenceValue(value: unknown): number | null {
  const text = String(value ?? "").trim()
  if (!text) return null
  const match = text.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const sequence = Number(match[1])
  return Number.isFinite(sequence) ? sequence : null
}

function getReceiptPaymentSequence(record: PaymentRecordLike | null | undefined): number | null {
  if (!record) return null
  return (
    getReceiptSequenceValue(record.paymentNumber) ??
    getReceiptSequenceValue(record.paymentSequence)
  )
}

export function getReceiptPaymentTime(record: PaymentRecordLike | null | undefined): number {
  if (!record) return 0
  const values = [
    record.submittedAt,
    record.paymentDate,
    record.createdAt,
    record.timestamp,
    record.dateGenerated,
    record.dateIssued,
    record.updatedAt,
  ]
  for (const value of values) {
    if (!value) continue
    const time = new Date(String(value)).getTime()
    if (Number.isFinite(time)) return time
  }
  return 0
}

export function sortReceiptPaymentRecords(
  records: ReadonlyArray<PaymentRecordLike> | null | undefined,
): PaymentRecordLike[] {
  return [...(records || [])].sort((a, b) => {
    const aSequence = getReceiptPaymentSequence(a)
    const bSequence = getReceiptPaymentSequence(b)
    if (aSequence !== null && bSequence !== null && aSequence !== bSequence) {
      return aSequence - bSequence
    }

    const aTime = getReceiptPaymentTime(a)
    const bTime = getReceiptPaymentTime(b)
    if (aTime !== bTime) return aTime - bTime

    if (aSequence !== null && bSequence === null) return -1
    if (aSequence === null && bSequence !== null) return 1

    const aReceipt = String(a.receiptNumber || "")
    const bReceipt = String(b.receiptNumber || "")
    if (aReceipt !== bReceipt) return aReceipt.localeCompare(bReceipt)
    return String(a.id || a.paymentId || "").localeCompare(String(b.id || b.paymentId || ""))
  })
}

function isSameReceiptPayment(
  left: PaymentRecordLike | null | undefined,
  right: PaymentRecordLike | null | undefined,
): boolean {
  if (!left || !right) return false
  const leftId = String(left.id || left.paymentId || "")
  const rightId = String(right.id || right.paymentId || "")
  if (leftId && rightId && leftId === rightId) return true

  const leftReceipt = String(left.receiptNumber || "")
  const rightReceipt = String(right.receiptNumber || "")
  if (leftReceipt && rightReceipt && leftReceipt === rightReceipt) return true

  const leftSubmittedAt = String(left.submittedAt || left.paymentDate || "")
  const rightSubmittedAt = String(right.submittedAt || right.paymentDate || "")
  return Boolean(leftSubmittedAt && rightSubmittedAt && leftSubmittedAt === rightSubmittedAt)
}

export function getReceiptPaymentNumber(
  selected: PaymentRecordLike | null | undefined,
  records: ReadonlyArray<PaymentRecordLike> | null | undefined = [],
): number {
  const explicit = getReceiptPaymentSequence(selected)
  if (explicit !== null) return explicit

  const ordered = sortReceiptPaymentRecords(records)
  const index = ordered.findIndex((record) => isSameReceiptPayment(record, selected))
  if (index >= 0) return index + 1

  const selectedTime = getReceiptPaymentTime(selected)
  if (selectedTime > 0) {
    const countThroughSelected = ordered.filter((record) => {
      const time = getReceiptPaymentTime(record)
      return time > 0 && time <= selectedTime
    }).length
    if (countThroughSelected > 0) return countThroughSelected
  }

  return Math.max(ordered.length + 1, 1)
}

export function getReceiptPaymentAmount(record: PaymentRecordLike | null | undefined): number {
  if (!record) return 0
  const amount = getPaymentRecordAmount(record)
  if (amount > 0) return amount
  return Math.max(
    toPaymentAmount(record.paymentAmount),
    toPaymentAmount(record.amountPaid),
    toPaymentAmount(record.requestedAmount),
  )
}

export function getReceiptPaymentDate(record: PaymentRecordLike | null | undefined): string {
  if (!record) return ""
  for (const value of [
    record.submittedAt,
    record.paymentDate,
    record.dateGenerated,
    record.dateIssued,
    record.createdAt,
    record.updatedAt,
  ]) {
    const text = String(value || "").trim()
    if (text) return text
  }
  return ""
}

export function getReceiptPaymentMethodLabel(value: unknown): string {
  const normalized = String(value || "").toLowerCase()
  if (normalized === "bank" || normalized.includes("bank")) return "Bank Transfer"
  if (normalized === "cash" || normalized.includes("office") || normalized.includes("onsite")) {
    return "Pay at the Office"
  }
  return String(value || "Not specified")
}

function getReceiptRawType(record: PaymentRecordLike | null | undefined): string {
  return normalizePaymentStatusValue(
    record?.term || record?.paymentPurpose || record?.paymentType,
  )
}

export function getReceiptPaymentType(
  record: PaymentRecordLike | null | undefined,
  booking?: BookingLike,
): PaymentRecordType {
  if (record?.isRemainingDownPayment === true) return "downpayment"
  const recordType = getPaymentRecordType(record)
  if (recordType !== "unknown") return recordType

  const rawType = getReceiptRawType(record)
  if (rawType.includes("down payment") || rawType.includes("downpayment")) return "downpayment"
  if (rawType.includes("remaining") || rawType.includes("balance") || rawType.includes("settle")) {
    return "remaining_balance"
  }
  if (rawType.includes("full")) return "full"
  if (rawType.includes("slot") || rawType.includes("reservation")) return "slot_reservation"
  return booking ? getBookingPaymentType(booking) : "unknown"
}

function getReceiptPaymentTypeLabel(type: PaymentRecordType): string {
  if (type === "downpayment") return "Down Payment"
  if (type === "remaining_balance") return "Remaining Balance"
  if (type === "slot_reservation") return "Slot Reservation Only"
  if (type === "full") return "Full Payment"
  return "Booking Payment"
}

const RECEIPT_NON_VERIFIED_TERMINAL_STATUSES = new Set([
  "rejected",
  "incomplete",
  "failed",
  "failure",
  "void",
  "voided",
  "cancelled",
  "canceled",
  "refunded",
])

export function isReceiptVerifiedPaymentRecord(record: PaymentRecordLike | null | undefined): boolean {
  const recordStatuses = [record?.status, record?.verificationStatus, record?.paymentStatus]
    .map(normalizePaymentStatusValue)
  if (recordStatuses.some((status) => RECEIPT_NON_VERIFIED_TERMINAL_STATUSES.has(status))) return false
  return isVerifiedPaymentRecord(record) || normalizePaymentStatusValue(record?.paymentStatus) === "verified"
}

function isReceiptRejectedPaymentRecord(record: PaymentRecordLike | null | undefined): boolean {
  return isRejectedPaymentRecord(record) || normalizePaymentStatusValue(record?.paymentStatus) === "rejected"
}

function isReceiptIncompletePaymentRecord(record: PaymentRecordLike | null | undefined): boolean {
  return isIncompletePaymentRecord(record) || normalizePaymentStatusValue(record?.paymentStatus) === "incomplete"
}

export function getReceiptPaymentStatusLabel(record: PaymentRecordLike | null | undefined): string {
  if (!record) return "For Review"
  if (isReceiptRejectedPaymentRecord(record)) return "Rejected"
  if (isReceiptIncompletePaymentRecord(record)) return "Incomplete Payment"
  if (isReceiptVerifiedPaymentRecord(record)) return "Verified"
  if (isPendingPaymentRecord(record)) return "For Review"
  const rawStatus = String(record.status || record.verificationStatus || record.paymentStatus || "").trim()
  return rawStatus || "For Review"
}

function getReceiptRequiredDownpayment(
  booking: BookingLike,
  records: ReadonlyArray<PaymentRecordLike>,
): number {
  const configured = toPaymentAmount(booking.selectedDownpaymentAmount)
  if (configured > 0) return configured

  const hasDownpaymentRecord = records.some(
    (record) => getReceiptPaymentType(record, booking) === "downpayment",
  )
  const bookingType = normalizePaymentStatusValue(booking.paymentType)
  if (!hasDownpaymentRecord && bookingType !== "downpayment") {
    return 0
  }

  const total = getBookingTotal(booking)
  const percentage = toPaymentAmount(booking.downPaymentPercentage) || 50
  return total * (percentage / 100)
}

export function calculateBookingVerifiedPaymentSummary(
  booking: BookingLike,
  records: ReadonlyArray<PaymentRecordLike> | null | undefined,
): ReceiptPaymentSummary {
  const sourceRecords = records || []
  const requiredDpAmount = getReceiptRequiredDownpayment(booking, sourceRecords)
  const verifiedRecords = sourceRecords.filter(isReceiptVerifiedPaymentRecord)
  const totalVerifiedPaid = verifiedRecords.reduce(
    (sum, record) => sum + getReceiptPaymentAmount(record),
    0,
  )
  const totalVerifiedDpPaid = Math.min(
    verifiedRecords.reduce(
      (sum, record) => sum + (
        getReceiptPaymentType(record, booking) === "downpayment"
          ? getReceiptPaymentAmount(record)
          : 0
      ),
      0,
    ),
    requiredDpAmount,
  )
  const totalBookingAmount = getBookingTotal(booking)

  return {
    totalBookingAmount,
    requiredDpAmount,
    totalVerifiedDpPaid,
    remainingDp: Math.max(requiredDpAmount - totalVerifiedDpPaid, 0),
    totalVerifiedPaid,
    remainingBalance: Math.max(totalBookingAmount - totalVerifiedPaid, 0),
  }
}

// Existing callers may still use the receipt-named entry point, but its
// Payment Summary is always booking-wide. The selected transaction is never a
// historical cutoff.
export function calculateReceiptPaymentSummary(
  booking: BookingLike,
  records: ReadonlyArray<PaymentRecordLike> | null | undefined,
  _selected?: PaymentRecordLike | null,
): ReceiptPaymentSummary {
  return calculateBookingVerifiedPaymentSummary(booking, records)
}

export function getReceiptPresentation(
  booking: BookingLike,
  records: ReadonlyArray<PaymentRecordLike> | null | undefined,
  selected?: PaymentRecordLike | null,
): ReceiptPresentation {
  const sourceRecords = records || []
  const ordered = sortReceiptPaymentRecords(sourceRecords)
  const target = selected || ordered[ordered.length - 1] || null
  const paymentType = getReceiptPaymentType(target, booking)
  const paymentMethod = String(target?.paymentMethod || target?.method || "").trim()
  const bankReference = String(
    target?.referenceNo || target?.bankReferenceNumber || target?.referenceNumber || "",
  ).trim()

  return {
    transaction: {
      paymentNumber: getReceiptPaymentNumber(target, sourceRecords),
      paymentDate: getReceiptPaymentDate(target),
      paymentType,
      paymentTypeLabel: getReceiptPaymentTypeLabel(paymentType),
      paymentMethod,
      bankReference,
      amount: getReceiptPaymentAmount(target),
      statusLabel: getReceiptPaymentStatusLabel(target),
      isVerified: isReceiptVerifiedPaymentRecord(target),
    },
    summary: calculateBookingVerifiedPaymentSummary(booking, sourceRecords),
  }
}

export function getPaymentRecordStatusLabel(
  record: PaymentRecordLike | null | undefined,
  _receipts?: unknown[],
): string {
  if (record === null || record === undefined) return "For Review"
  if (isRejectedPaymentRecord(record)) return "Rejected"
  if (isIncompletePaymentRecord(record)) return "Incomplete Payment"
  if (isVerifiedPaymentRecord(record)) return "Verified"
  return "For Review"
}

export function getPaymentOverallStatusLabel(status: PaymentOverallStatus): string {
  if (status === "completed") return "Fully Paid"
  if (status === "partial") return "Partial Payment"
  if (status === "rejected") return "Rejected"
  if (status === "incomplete") return "Incomplete Payment"
  return "For Review"
}

function getBookingPaymentType(booking: BookingLike): PaymentRecordType {
  const type = normalizePaymentStatusValue(booking.paymentType)
  if (type === "downpayment") return "downpayment"
  if (type === "slot_reservation") return "slot_reservation"
  if (type === "full") return "full"
  return "unknown"
}

function getPaymentTypeLabel(type: PaymentRecordType): string {
  if (type === "downpayment") return "Down Payment"
  if (type === "remaining_balance") return "Remaining Balance"
  if (type === "slot_reservation") return "Slot Reservation Only"
  if (type === "full") return "Full Payment"
  return "Booking Payment"
}

/**
 * Returns the financial labels for one transaction detail view. Pending money
 * is always shown as submitted, while accepted/received ledger values use
 * labels that cannot be mistaken for the pending transaction itself.
 */
export function getPaymentDisplayModel(
  booking: BookingLike,
  record: PaymentRecordLike | null | undefined,
  summary: PaymentSummary,
): PaymentDisplayModel {
  const recordType = getPaymentRecordType(record)
  const bookingType = getBookingPaymentType(booking)
  const paymentType = recordType === "unknown" ? bookingType : recordType
  const isDownpayment = paymentType === "downpayment" || isDownpaymentPaymentRecord(record, booking)
  const isFinalPayment = paymentType === "remaining_balance" || (
    paymentType === "full" && bookingType === "downpayment"
  )
  const effectiveType: PaymentRecordType = isDownpayment
    ? "downpayment"
    : isFinalPayment
      ? "remaining_balance"
      : paymentType
  const verified = isVerifiedPaymentRecord(record)
  const incomplete = isIncompletePaymentRecord(record)
  const pending = record ? isPendingPaymentRecord(record) : summary.hasPendingSubmission
  const recordAmount = record ? getPaymentRecordAmount(record) : 0
  const submittedAmount = record
    ? Math.max(toPaymentAmount(record.requestedAmount), recordAmount)
    : summary.pendingCurrentAmount
  const amount = incomplete
    ? getPaymentRecordCreditedAmount(record)
    : record
      ? recordAmount
      : summary.pendingCurrentAmount || summary.acceptedTotalPaid

  let amountLabel = "Payment Amount"
  if (incomplete) amountLabel = "Amount Received"
  else if (effectiveType === "downpayment") amountLabel = verified ? "Verified DP Paid" : "DP Submitted"
  else if (effectiveType === "remaining_balance") amountLabel = verified ? "Verified Payment" : "Final Payment Submitted"
  else if (effectiveType === "full") amountLabel = verified ? "Verified Payment" : "Payment Submitted"
  else if (pending) amountLabel = "Payment Submitted"

  const acceptedLabel = effectiveType === "downpayment"
    ? "Verified DP Paid"
    : effectiveType === "remaining_balance"
      ? "Total Paid"
      : "Verified Payment"
  const acceptedAmount = effectiveType === "downpayment"
    ? summary.verifiedDownpaymentPaid
    : effectiveType === "remaining_balance"
      ? summary.moneyReceivedTotal
      : summary.acceptedVerifiedTotal
  const remainingLabel = effectiveType === "downpayment" ? "Remaining DP" : "Remaining Balance"
  const remainingAmount = effectiveType === "downpayment"
    ? summary.remainingDownpayment
    : summary.remainingBalance

  return {
    paymentType: effectiveType,
    paymentTypeLabel: getPaymentTypeLabel(effectiveType),
    statusLabel: record
      ? getPaymentRecordStatusLabel(record)
      : getPaymentOverallStatusLabel(summary.overallStatus),
    amountLabel,
    amount,
    submittedAmount,
    acceptedLabel,
    acceptedAmount,
    remainingLabel,
    remainingAmount,
  }
}

// One canonical record→booking association rule used by EVERY surface
// (admin history, client history, summaries). A payment record belongs to a
// booking when its bookingId OR bookingCode matches the booking id — older
// records were written with only one of the two populated. Matching is exact
// after trimming/case-normalizing; nothing else (receipt, status, amount)
// ever influences membership.
function matchesBooking(record: PaymentRecordLike, bookingId: string): boolean {
  const target = String(bookingId || "").trim().toLowerCase()
  if (!target) return false
  const byId = String(record.bookingId || "").trim().toLowerCase()
  const byCode = String(record.bookingCode || "").trim().toLowerCase()
  return byId === target || byCode === target
}

export function getRecordsForBooking(
  records: ReadonlyArray<PaymentRecordLike> | null | undefined,
  bookingOrId: BookingLike | string | undefined,
  bookingCode?: string,
): PaymentRecordLike[] {
  const identifiers = typeof bookingOrId === "object" && bookingOrId !== null
    ? [bookingOrId.id, bookingOrId.bookingCode]
    : [bookingOrId, bookingCode]
  const normalizedIdentifiers = identifiers
    .map((value) => String(value || "").trim())
    .filter(Boolean)
  if (normalizedIdentifiers.length === 0) return []
  return (records || []).filter((record) => (
    normalizedIdentifiers.some((identifier) => matchesBooking(record, identifier))
  ))
}

// Derives the overall payment status from the booking's COMPLETE payment
// history. Accepts the same call shape as the legacy helper
// (base, submissions, receipts, bookingId) — receipts are informational only.
export function getOverallPaymentStatus(
  base: BookingLike,
  submissions: ReadonlyArray<PaymentRecordLike> | null | undefined,
  _receipts?: unknown[],
  _bookingId?: string,
): PaymentOverallStatus {
  return calculatePaymentSummary(base, submissions).overallStatus
}

export function calculatePaymentSummary(
  base: BookingLike,
  submissions: ReadonlyArray<PaymentRecordLike> | null | undefined,
): PaymentSummary {
  const records = submissions || []
  const bookingTotal = getBookingTotal(base)
  const requiredDownpayment = getBookingRequiredDownpayment(base)
  const ps = normalizePaymentStatusValue(base.paymentStatus)

  // Legacy bookings (no payment records) — derive the best possible state
  // from the booking document itself. Never returns "verified"/"in_progress":
  // the only overall statuses are for_review / incomplete / partial /
  // completed / rejected.
  if (records.length === 0) {
    const amountPaid = getBookingStoredAmountPaid(base)
    const downpaymentPaid = toPaymentAmount(base.downpaymentPaid)
    // A stored amountPaid that already covers the required downpayment proves
    // the downpayment was completed even when the downpaymentPaid field was
    // never tracked (older bookings). Never demote such a booking.
    const downpaymentComplete =
      requiredDownpayment > 0
        ? Math.max(downpaymentPaid, amountPaid) >= requiredDownpayment
        : amountPaid >= bookingTotal
    // Legacy bookings have no per-payment records, so the credited total can
    // only come from the booking's own stored ledger fields.
    const downpaymentCreditedTotal = Math.max(downpaymentPaid, amountPaid)
    const moneyReceivedTotal =
      bookingTotal > 0 ? Math.min(downpaymentCreditedTotal, bookingTotal) : downpaymentCreditedTotal
    const remainingBalance = Math.max(bookingTotal - moneyReceivedTotal, 0)

    let legacyStatus: PaymentOverallStatus
    if (ps === "rejected") legacyStatus = "rejected"
    else if (ps === "incomplete") legacyStatus = "incomplete"
    else if (
      ps === "for_review" ||
      ps === "for review" ||
      ps === "pending_verification" ||
      ps === "pending verification"
    ) {
      legacyStatus = "for_review"
    } else if (bookingTotal > 0 && moneyReceivedTotal >= bookingTotal) legacyStatus = "completed"
    else if (downpaymentComplete && remainingBalance > 0) legacyStatus = "partial"
    else if (moneyReceivedTotal > 0) legacyStatus = "incomplete"
    else if (ps === "paid" || ps === "completed" || ps === "fully paid") legacyStatus = "completed"
    else legacyStatus = "for_review"

    const creditTarget = requiredDownpayment > 0 ? requiredDownpayment : bookingTotal
    const verifiedDownpaymentPaid = requiredDownpayment > 0
      ? Math.min(Math.max(downpaymentPaid, amountPaid), requiredDownpayment)
      : 0
    const remainingDownpayment = Math.max(creditTarget - downpaymentCreditedTotal, 0)

    return {
      totalBookingAmount: bookingTotal,
      requiredDpAmount: requiredDownpayment,
      acceptedTotalPaid: moneyReceivedTotal,
      acceptedDpPaid: verifiedDownpaymentPaid,
      remainingDpBalance: remainingDownpayment,
      remainingBookingBalance: remainingBalance,
      currentTransactionAmount: 0,
      pendingCurrentAmount: 0,
      bookingTotal,
      requiredDownpayment,
      acceptedVerifiedTotal: amountPaid,
      verifiedDownpaymentPaid,
      remainingVerifiedDownpayment: Math.max(requiredDownpayment - verifiedDownpaymentPaid, 0),
      moneyReceivedTotal,
      remainingBalance,
      downpaymentComplete,
      fullyPaid: bookingTotal > 0 && moneyReceivedTotal >= bookingTotal,
      hasPendingSubmission: false,
      overallStatus: legacyStatus,
      downpaymentCreditedTotal,
      remainingDownpayment,
    }
  }

  // Record-based bookings — canonical state derived ONLY from the booking's
  // complete payment history. Booking doc fields (paymentStatus / amountPaid /
  // downpaymentPaid / paymentStage) can be stale while a payment is being
  // reviewed, so they are never trusted when records are available.
  const recordAcceptedTotal = records.reduce(
    (sum, record) => sum + (isAcceptedPaymentRecord(record) ? getPaymentRecordAmount(record) : 0),
    0,
  )
  const acceptedVerifiedTotal = recordAcceptedTotal
  const verifiedDownpaymentPaid = requiredDownpayment > 0
    ? records.reduce(
        (sum, record) =>
          sum +
          (isAcceptedPaymentRecord(record) && isDownpaymentPaymentRecord(record, base)
            ? getPaymentRecordAmount(record)
            : 0),
        0,
      )
    : 0
  // DOWNPAYMENT CREDIT — money actually RECEIVED toward the downpayment:
  // every verified payment plus the received amount of short (incomplete)
  // payments. Rejected/pending records credit nothing. An INCOMPLETE record
  // keeps its own status/receipt permanently, but its received money is real
  // and must reduce what the client still owes (₱7,500 required − ₱5,500
  // received = ask ₱2,000, never ₱7,500 again).
  const downpaymentCreditedTotal = records.reduce(
    (sum, record) => sum + getPaymentRecordCreditedAmount(record),
    0,
  )
  // MONEY LEDGER — all valid money actually held for this booking
  // (verified payments + received amounts of incomplete payments). Displayed
  // received money cannot exceed the booking total, even if malformed or
  // duplicated records contain an overpayment.
  const rawMoneyReceivedTotal = Math.max(downpaymentCreditedTotal, acceptedVerifiedTotal)
  const moneyReceivedTotal =
    bookingTotal > 0 ? Math.min(rawMoneyReceivedTotal, bookingTotal) : rawMoneyReceivedTotal
  // Remaining BOOKING balance is net of ALL money actually received.
  const remainingBalance = Math.max(bookingTotal - moneyReceivedTotal, 0)
  // Downpayment is complete once the CUMULATIVE received/credited total
  // reaches the required downpayment — a single record never needs to equal
  // the whole downpayment, and older rejected/pending records are irrelevant.
  // For non-downpayment (full payment) bookings the "required first payment"
  // is the whole booking, so completion coincides with fullyPaid.
  const downpaymentComplete =
    requiredDownpayment > 0
      ? moneyReceivedTotal >= requiredDownpayment
      : moneyReceivedTotal >= bookingTotal
  const fullyPaid = bookingTotal > 0 && moneyReceivedTotal >= bookingTotal
  const hasPendingSubmission = records.some((record) => isUnresolvedPaymentRecord(record))

  // The latest payment that was explicitly marked (incomplete/rejected) and
  // has NOT been resolved by a later accepted payment. Scan from the newest
  // record backwards: hitting an accepted payment first means every older
  // rejected/incomplete record was resolved.
  const sorted = [...records].sort(
    (a, b) => getPaymentRecordTime(a) - getPaymentRecordTime(b),
  )
  const currentTransaction = sorted[sorted.length - 1]
  const pendingCurrent = [...sorted].reverse().find((record) => isUnresolvedPaymentRecord(record))
  let latestMarkedUnresolved: PaymentRecordLike | null = null
  for (let i = sorted.length - 1; i >= 0; i--) {
    const record = sorted[i]
    if (isAcceptedPaymentRecord(record)) break
    if (isIncompletePaymentRecord(record) || isRejectedPaymentRecord(record)) {
      latestMarkedUnresolved = record
      break
    }
  }

  // 1. FULLY PAID — money credited by the payment history covers the booking
  //    amount. Highest priority: once a booking is fully settled, a later
  //    rejected/incomplete extra payment does not undo it.
  // 2. PARTIAL — required downpayment is complete AND a remaining booking
  //    balance still exists. Cumulative RECEIVED payments (verified +
  //    incomplete-received) drive this, so a pending (for_review) record or
  //    a trailing rejected/incomplete record never demotes a booking whose
  //    downpayment is already covered.
  // 3. FOR REVIEW — a NEW payment is waiting for admin review (no received
  //    history has completed the downpayment yet).
  // 4. INCOMPLETE / REJECTED — the latest relevant payment was explicitly
  //    marked and has not been resolved by a later accepted payment.
  // 5. Received amounts exist but the required downpayment is not complete —
  //    the booking still requires payment.
  let overallStatus: PaymentOverallStatus
  if (fullyPaid) {
    overallStatus = "completed"
  } else if (downpaymentComplete && remainingBalance > 0) {
    overallStatus = "partial"
  } else if (hasPendingSubmission) {
    overallStatus = "for_review"
  } else if (latestMarkedUnresolved) {
    overallStatus = isIncompletePaymentRecord(latestMarkedUnresolved) ? "incomplete" : "rejected"
  } else if (moneyReceivedTotal > 0) {
    overallStatus = "incomplete"
  } else {
    overallStatus = "incomplete"
  }

  const acceptedDpPaid = requiredDownpayment > 0
    ? Math.min(downpaymentCreditedTotal, requiredDownpayment)
    : 0
  const remainingDpBalance = Math.max(requiredDownpayment - acceptedDpPaid, 0)

  return {
    totalBookingAmount: bookingTotal,
    requiredDpAmount: requiredDownpayment,
    acceptedTotalPaid: moneyReceivedTotal,
    acceptedDpPaid,
    remainingDpBalance,
    remainingBookingBalance: remainingBalance,
    currentTransactionAmount: currentTransaction ? getPaymentRecordAmount(currentTransaction) : 0,
    pendingCurrentAmount: pendingCurrent ? getPaymentRecordAmount(pendingCurrent) : 0,
    bookingTotal,
    requiredDownpayment,
    acceptedVerifiedTotal,
    verifiedDownpaymentPaid,
    remainingVerifiedDownpayment: Math.max(requiredDownpayment - verifiedDownpaymentPaid, 0),
    remainingBalance,
    downpaymentComplete,
    fullyPaid,
    hasPendingSubmission,
    overallStatus,
    downpaymentCreditedTotal,
    moneyReceivedTotal,
    // For non-downpayment (full payment) bookings the "required first
    // payment" is the whole booking, mirroring downpaymentComplete above.
    remainingDownpayment: requiredDownpayment > 0
      ? remainingDpBalance
      : Math.max(bookingTotal - downpaymentCreditedTotal, 0),
  }
}
