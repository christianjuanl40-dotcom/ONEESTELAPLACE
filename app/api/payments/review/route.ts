import "server-only"
import { isAvailabilityBlockingBooking, isTerminalAvailabilityBooking } from "@/src/modules/shared/lib/booking-helpers"

import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import type { DocumentData, Firestore, Transaction, UpdateData } from "firebase-admin/firestore"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireBackofficeUser,
} from "@/lib/server-auth"
import {
  buildPaymentDecisionTransition,
  buildVerifiedPaymentTransition,
} from "@/src/modules/shared/lib/payment-verification"
import {
  getPaymentRecordAmount,
  MAX_PAYMENT_AMOUNT_CENTS,
  parseCurrencyToCents,
  centsToPaymentAmount,
  toPaymentCents,
  calculateReceiptPaymentSummary,
  buildBookingReceiptProjection,
  isUnresolvedPaymentRecord,
  isVerifiedPaymentRecord,
  isRejectedPaymentRecord,
  isIncompletePaymentRecord,
  type PaymentRecordLike,
} from "@/src/modules/shared/lib/payment-calculations"
import { isOfficeResourceBooking } from "@/src/modules/shared/lib/resource-identity"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asIso(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString()
  }
  return value
}

function stripUndefinedDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefinedDeep)
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return value
    const result: DataRecord = {}
    for (const [key, entry] of Object.entries(value as DataRecord)) {
      if (entry === undefined) continue
      result[key] = stripUndefinedDeep(entry)
    }
    return result
  }
  return value
}

function normalizePaymentRecord(id: string, data: DataRecord): PaymentRecordLike {
  return {
    ...data,
    id,
    submittedAt: asIso(data.submittedAt),
    updatedAt: asIso(data.updatedAt),
    reviewedAt: asIso(data.reviewedAt),
  }
}

function belongsToBooking(record: PaymentRecordLike, bookingId: string, bookingCode?: string): boolean {
  const targetId = String(bookingId || "").trim().toLowerCase()
  const targetCode = String(bookingCode || "").trim().toLowerCase()
  const recordBookingId = String(record.bookingId || "").trim().toLowerCase()
  const recordBookingCode = String(record.bookingCode || "").trim().toLowerCase()
  return (
    recordBookingId === targetId ||
    recordBookingCode === targetId ||
    (targetCode !== "" && (recordBookingId === targetCode || recordBookingCode === targetCode))
  )
}

function getReceiptHistory(booking: DataRecord): DataRecord[] {
  const history = Array.isArray(booking.paymentReceipts) ? booking.paymentReceipts.filter(isRecord) : []
  if (isRecord(booking.receipt) && !history.some((receipt) => receipt.receiptNumber === (booking.receipt as DataRecord).receiptNumber)) {
    return [...history, booking.receipt]
  }
  return history
}

function createReceiptNumber(): string {
  return `ER-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`
}

function buildVerifiedReceipt(
  booking: DataRecord,
  payment: PaymentRecordLike,
  history: DataRecord[],
  existing: DataRecord | undefined,
  receiptNumber: string,
  remainingBalance: number,
  now: string,
  paymentStatus = "Verified",
): { history: DataRecord[]; receipt: DataRecord } {
  const existingIndex = history.findIndex((receipt) => (
    String(receipt.paymentId || "") === String(payment.id || "") ||
    (!receipt.paymentId && receipt.receiptNumber === receiptNumber)
  ))
  const submittedAt = String(payment.submittedAt || existing?.paymentSubmittedAt || now)
  const method = String(payment.paymentMethod || "").toLowerCase() === "cash"
    ? "Pay at the Office"
    : "Bank Transfer"
  const receipt: DataRecord = {
    ...(existing || {}),
    receiptNumber,
    bookingId: String(booking.id || payment.bookingId || ""),
    paymentId: String(payment.id || ""),
    paymentNumber: payment.paymentNumber,
    reviewSnapshot: payment.reviewSnapshot,
    fullName: String(
      (isRecord(booking.userInfo) && booking.userInfo.name) || payment.customerName || "Client",
    ),
    bookingDate: String(booking.createdAt || submittedAt),
    startDate: String(booking.date || "Not set"),
    endDate: String(booking.endDate || booking.date || "Not set"),
    rentalType: isOfficeResourceBooking(booking)
      ? "Office Space Rental"
      : "Event Venue Booking",
    bookingType: String(booking.eventType || "Event Venue Booking"),
    contractTerm: String(booking.contractTerm || booking.rentalTerm || ""),
    paymentPurpose: String(payment.term || "Event Venue Payment"),
    paymentMethod: method,
    amountPaid: getPaymentRecordAmount(payment),
    paymentAmount: getPaymentRecordAmount(payment),
    remainingBalance,
    paymentStatus,
    dateGenerated: String(existing?.dateGenerated || submittedAt),
    dateIssued: String(existing?.dateIssued || submittedAt),
    paymentSubmittedAt: submittedAt,
    updatedAt: now,
  }
  const nextHistory = [...history]
  if (existingIndex >= 0) nextHistory[existingIndex] = receipt
  else nextHistory.push(receipt)
  return { history: nextHistory, receipt }
}

function readIds(bookingId: unknown, paymentRecordId: unknown) {
  if (typeof bookingId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(bookingId.trim())) {
    throw new ApiAuthError(400, "Invalid booking ID.")
  }
  if (typeof paymentRecordId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(paymentRecordId.trim())) {
    throw new ApiAuthError(400, "Select a valid payment submission to review.")
  }
  return { bookingId: bookingId.trim(), paymentRecordId: paymentRecordId.trim() }
}

async function readReviewState(transaction: Transaction, firestore: Firestore, bookingId: string, paymentRecordId: string) {
  const bookingSnapshot = await transaction.get(firestore.collection("bookings").doc(bookingId))
  if (!bookingSnapshot.exists) throw new ApiAuthError(404, "Booking not found. Refresh the booking list and try again.")
  const bookingData: DataRecord = { ...bookingSnapshot.data(), id: bookingId }
  const bookingCode = String(bookingData.bookingCode || "").trim()

  // Always read the actual selected document; never substitute a latest payment,
  // a submission number, or a booking's display code for its document ID.
  const selected = await transaction.get(firestore.collection("payments").doc(paymentRecordId))
  if (!selected.exists) throw new ApiAuthError(404, "Payment record not found. Select an available submission and try again.")
  const target = normalizePaymentRecord(selected.id, selected.data() as DataRecord)
  if (!belongsToBooking(target, bookingId, bookingCode)
    || (target.customerId && bookingData.userId && target.customerId !== bookingData.userId)) {
    throw new ApiAuthError(403, "This payment does not belong to the booking.")
  }

  const paymentRecords = new Map<string, PaymentRecordLike>()
  for (const identifier of new Set([bookingId, bookingCode].filter(Boolean))) {
    for (const field of ["bookingId", "bookingCode"]) {
      const snapshots = await transaction.get(firestore.collection("payments").where(field, "==", identifier))
      snapshots.forEach((snapshot) => paymentRecords.set(snapshot.id, normalizePaymentRecord(snapshot.id, snapshot.data() as DataRecord)))
    }
  }
  paymentRecords.set(selected.id, target)
  const allRecords = [...paymentRecords.values()].filter((record) => belongsToBooking(record, bookingId, bookingCode))
  if (allRecords.some((record) => record.customerId && bookingData.userId && record.customerId !== bookingData.userId)) {
    throw new ApiAuthError(409, "The payment history has a conflicting customer association. Reconcile it before reviewing this payment.")
  }
  return { bookingData, target, allRecords }
}

async function readSelectedReceipt(
  transaction: Transaction, firestore: Firestore, booking: DataRecord, payment: PaymentRecordLike, records: PaymentRecordLike[],
) {
  const history = getReceiptHistory(booking)
  const ownReceipts = await transaction.get(firestore.collection("receipts").where("paymentId", "==", payment.id))
  const saved = ownReceipts.docs.map((snapshot) => ({ ...snapshot.data(), receiptNumber: snapshot.id } as DataRecord))
  if (saved.some((receipt) => !belongsToBooking(receipt, String(booking.id), String(booking.bookingCode || "")))) {
    throw new ApiAuthError(409, "The selected payment's receipt has a conflicting booking association.")
  }
  if (saved.length > 1) throw new ApiAuthError(409, "The selected payment has multiple receipts. Reconcile them before reviewing it.")

  const ownHistory = history.find((receipt) => receipt.paymentId === payment.id)
  const preferredNumber = saved[0]?.receiptNumber || ownHistory?.receiptNumber || payment.receiptNumber
  let receiptNumber = typeof preferredNumber === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(preferredNumber) ? preferredNumber : ""
  let existing: DataRecord | undefined = saved[0]
  let exists = Boolean(existing)
  if (receiptNumber && !existing) {
    const snapshot = await transaction.get(firestore.collection("receipts").doc(receiptNumber))
    exists = snapshot.exists
    existing = snapshot.exists ? { ...snapshot.data(), receiptNumber } : undefined
  }
  const embedded = history.find((receipt) => receipt.receiptNumber === receiptNumber)
  const otherPaymentUsesNumber = records.some((record) => record.id !== payment.id && record.receiptNumber === receiptNumber)
  const isOwn = (receipt: DataRecord) => receipt.paymentId === payment.id
    || (!receipt.paymentId && !otherPaymentUsesNumber && belongsToBooking(receipt, String(booking.id), String(booking.bookingCode || "")))
  // A shared legacy receipt-number link must never overwrite an earlier
  // payment's receipt. Only an exact, exclusively associated receipt can be reused.
  if ((existing && !isOwn(existing)) || (embedded && !isOwn(embedded))) {
    receiptNumber = ""
    existing = undefined
    exists = false
  } else {
    existing = { ...(embedded || {}), ...(existing || {}) }
  }
  if (existing?.reviewSnapshot || existing?.reviewSnapshotSummary) {
    throw new ApiAuthError(409, "This submission already has a finalized receipt. Refresh its saved review before continuing.")
  }
  return { history, existing, receiptNumber: receiptNumber || createReceiptNumber(), exists }
}

function changedFields(before: DataRecord, after: DataRecord): UpdateData<DocumentData> {
  return stripUndefinedDeep(Object.fromEntries(Object.entries(after).filter(([key, value]) => key !== "id" && value !== before[key]))) as UpdateData<DocumentData>
}

function errorResponse(error: unknown, requestId: string) {
  if (isApiAuthError(error)) {
    return NextResponse.json({ error: error.message, requestId }, { status: error.status, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } })
  }
  console.error(
    "[/api/payments/review]", { requestId },
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to confirm the payment review. Check its saved status before trying again.", requestId },
    { status: 500, headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } })
}

/** Authoritative, permission-checked reconciliation after a lost/invalid response. */
export async function GET(request: NextRequest) {
  const requestId = randomUUID()
  try {
    await requireBackofficeUser(request, { permission: "payments" })
    const { bookingId, paymentRecordId } = readIds(request.nextUrl.searchParams.get("bookingId"), request.nextUrl.searchParams.get("paymentRecordId"))
    const firestore = getAdminFirestore()
    const result = await firestore.runTransaction(async (transaction) => {
      const { bookingData, target, allRecords } = await readReviewState(transaction, firestore, bookingId, paymentRecordId)
      return { booking: bookingData, payment: target, summary: calculateReceiptPaymentSummary(bookingData, allRecords) }
    })
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } })
  } catch (error) { return errorResponse(error, requestId) }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID()
  try {
    const user = await requireBackofficeUser(request, { permission: "payments" })
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 32 * 1024) {
      throw new ApiAuthError(413, "The payment review request is too large.")
    }

    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in request body.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid payment review request.")

    const action = String(body.action || "verify").trim().toLowerCase()
    if (action !== "verify" && action !== "reject" && action !== "incomplete") {
      throw new ApiAuthError(400, "Unsupported payment review action.")
    }

    const { bookingId, paymentRecordId } = readIds(body.bookingId, body.paymentRecordId)

    const noteValue = body.adminNote == null ? "" : String(body.adminNote).trim()
    if (noteValue.length > 2000) throw new ApiAuthError(400, "The admin note is too long.")
    if ((action === "reject" || action === "incomplete") && !noteValue) {
      throw new ApiAuthError(400, action === "reject" ? "A rejection reason is required." : "An incomplete-payment note is required.")
    }

    let requestedAmount: number | undefined
    if (body.verifiedAmount !== undefined && body.verifiedAmount !== null && body.verifiedAmount !== "") {
      if (typeof body.verifiedAmount !== "number" && typeof body.verifiedAmount !== "string") {
        throw new ApiAuthError(400, "Please provide a valid verified amount.")
      }
      const requestedAmountCents = parseCurrencyToCents(body.verifiedAmount)
      if (requestedAmountCents === null || requestedAmountCents <= 0 || requestedAmountCents > MAX_PAYMENT_AMOUNT_CENTS) {
        throw new ApiAuthError(400, "Please provide a valid verified amount.")
      }
      requestedAmount = centsToPaymentAmount(requestedAmountCents)
    }

    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)
    const result = await firestore.runTransaction(async (transaction) => {
      const { bookingData, target, allRecords } = await readReviewState(transaction, firestore, bookingId, paymentRecordId)
      if (action !== "verify" && !isUnresolvedPaymentRecord(target)) {
        throw new ApiAuthError(409, "This payment has already been resolved.")
      }
      if (action === "verify" && (isRejectedPaymentRecord(target) || isIncompletePaymentRecord(target))) {
        throw new ApiAuthError(409, "This payment has already been resolved.")
      }
      if (!isVerifiedPaymentRecord(target) && (isTerminalAvailabilityBooking(bookingData) || !isAvailabilityBlockingBooking(bookingData))) {
        throw new ApiAuthError(409, "A released reservation cannot be reactivated by a payment review. Resolve it through a new availability-checked booking.")
      }
      // A retry acknowledges the authoritative original record, including legacy
      // reviews with no amount/snapshot. It must not touch any persisted history.
      if (action === "verify" && isVerifiedPaymentRecord(target)) return {
        booking: bookingData, payment: target, summary: calculateReceiptPaymentSummary(bookingData, allRecords),
        alreadyVerified: true, action, userId: String(bookingData.userId || ""), customerName: "",
      }

      const submittedAmount = getPaymentRecordAmount(target)
      const verifiedAmount = requestedAmount ?? submittedAmount
      const submittedAmountCents = toPaymentCents(submittedAmount)
      const currentDueCents = toPaymentCents(calculateReceiptPaymentSummary(bookingData, allRecords).remainingBalance)
      let transition
      if (action === "verify") {
        if (submittedAmount <= 0 || verifiedAmount <= 0 || toPaymentCents(verifiedAmount) > MAX_PAYMENT_AMOUNT_CENTS) throw new ApiAuthError(400, "The selected payment has no valid amount to verify.")
        if (!isVerifiedPaymentRecord(target) && submittedAmountCents > 0 && toPaymentCents(verifiedAmount) > submittedAmountCents) {
          throw new ApiAuthError(400, "The verified amount cannot exceed the submitted amount.")
        }
        if (!isVerifiedPaymentRecord(target) && toPaymentCents(verifiedAmount) > currentDueCents) {
          throw new ApiAuthError(400, "The verified amount cannot exceed the current amount due.")
        }
        transition = buildVerifiedPaymentTransition(
          bookingData,
          allRecords,
          target,
          {
            verifiedAmount,
            adminName: user.fullName || "Administrator",
            adminNote: noteValue,
          },
        )
      } else if (action === "incomplete") {
        const receivedAmount = requestedAmount || submittedAmount
        if (receivedAmount <= 0) throw new ApiAuthError(400, "The payment has no valid received amount.")
        if (submittedAmountCents > 0 && toPaymentCents(receivedAmount) >= submittedAmountCents) {
          throw new ApiAuthError(400, "An incomplete payment must be less than the submitted amount.")
        }
        if (toPaymentCents(receivedAmount) > currentDueCents) {
          throw new ApiAuthError(400, "The received amount cannot exceed the current amount due.")
        }
        transition = buildPaymentDecisionTransition(
          bookingData,
          allRecords,
          target,
          "incomplete",
          {
            verifiedAmount: receivedAmount,
            adminName: user.fullName || "Administrator",
            adminNote: noteValue,
          },
        )
      } else {
        transition = buildPaymentDecisionTransition(
          bookingData,
          allRecords,
          target,
          "reject",
          {
            adminName: user.fullName || "Administrator",
            adminNote: noteValue,
          },
        )
      }
      // Finish every receipt read before queuing any transaction write.
      const selectedReceipt = await readSelectedReceipt(transaction, firestore, bookingData, target, allRecords)
      const receiptResult = buildVerifiedReceipt(
        transition.booking,
        transition.payment,
        selectedReceipt.history,
        selectedReceipt.existing,
        selectedReceipt.receiptNumber,
        transition.summary.remainingBalance,
        new Date().toISOString(),
        action === "verify" ? "Verified" : action === "incomplete" ? "Incomplete" : "Rejected",
      )
      const bookingReceipt = buildBookingReceiptProjection(receiptResult.receipt)
      const bookingWithReceipt: DataRecord = {
        ...transition.booking,
        paymentReceipts: receiptResult.history.map((receipt) => receipt === receiptResult.receipt ? bookingReceipt : receipt),
        receipt: bookingReceipt,
        receiptIssued: true,
        receiptNumber: receiptResult.receipt.receiptNumber,
        receiptIssuedAt: receiptResult.receipt.dateGenerated,
      }
      const paymentWithReceipt: PaymentRecordLike = {
        ...transition.payment,
        receiptNumber: receiptResult.receipt.receiptNumber,
      }

      // Replace changed top-level maps rather than recursively merging a previous
      // payment's latest-receipt snapshot into this selected payment's receipt.
      transaction.update(bookingRef, changedFields(bookingData, bookingWithReceipt))
      transaction.update(
        firestore.collection("payments").doc(String(target.id)),
        changedFields(target as DataRecord, paymentWithReceipt as DataRecord),
      )
      const receiptRef = firestore.collection("receipts").doc(selectedReceipt.receiptNumber)
      const receiptToPersist = stripUndefinedDeep(receiptResult.receipt) as DataRecord
      if (selectedReceipt.exists) transaction.update(receiptRef, receiptToPersist as UpdateData<DocumentData>)
      else transaction.create(receiptRef, receiptToPersist)

      return {
        booking: { ...bookingWithReceipt, id: bookingId },
        payment: { ...paymentWithReceipt, id: target.id },
        summary: transition.summary,
        alreadyVerified: transition.alreadyVerified,
        action,
        userId: String(bookingData.userId || ""),
        customerName: String(
          (isRecord(bookingData.userInfo) && bookingData.userInfo.name) || target.customerName || "Client",
        ),
      }
    })

    if (!result.alreadyVerified && result.userId) {
      try {
        const notificationType = result.action === "reject"
          ? "payment_rejected"
          : result.action === "incomplete"
            ? "payment_incomplete"
            : "payment_approved"
        const notificationTitle = result.action === "reject"
          ? "Payment Rejected"
          : result.action === "incomplete"
            ? "Payment Requires Correction"
            : "Payment Approved"
        await firestore.collection("notifications").add({
          type: notificationType,
          title: notificationTitle,
          message: result.action === "reject"
            ? `Your payment for Booking ${bookingId} has been rejected.`
            : result.action === "incomplete"
              ? `Your payment for Booking ${bookingId} needs correction or additional information.`
              : `Your payment for Booking ${bookingId} has been approved.`,
          bookingId,
          userId: result.userId,
          relatedUserName: result.customerName,
          isRead: false,
          moduleRead: false,
          createdAt: new Date(),
          link: `/portal/payments?highlight=${bookingId}`,
        })
      } catch (error) {
        console.error(
          "[POST /api/payments/review] Notification write failed:",
          error instanceof Error ? error.message : "Unknown error",
        )
      }
    }

    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store", "X-Request-Id": requestId } })
  } catch (error: unknown) {
    return errorResponse(error, requestId)
  }
}
