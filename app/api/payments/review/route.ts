import "server-only"

import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireBackofficeUser,
} from "@/lib/server-auth"
import {
  buildVerifiedPaymentTransition,
} from "@/src/modules/shared/lib/payment-verification"
import {
  getPaymentRecordAmount,
  getPaymentRecordCreditedAmount,
  isUnresolvedPaymentRecord,
  isVerifiedPaymentRecord,
  toPaymentAmount,
  type PaymentRecordLike,
} from "@/src/modules/shared/lib/payment-calculations"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null
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

function getRecordTime(record: PaymentRecordLike): number {
  const value = record.submittedAt || record.updatedAt
  const time = new Date(String(value || "")).getTime()
  return Number.isFinite(time) ? time : 0
}

function getReceiptHistory(booking: DataRecord): DataRecord[] {
  if (Array.isArray(booking.paymentReceipts)) {
    return booking.paymentReceipts.filter(isRecord)
  }
  return booking.receipt && isRecord(booking.receipt) ? [booking.receipt] : []
}

function createReceiptNumber(): string {
  return `ER-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`
}

function getReceiptRemainingBalance(
  bookingTotal: number,
  records: PaymentRecordLike[],
  targetId: string,
): number {
  const sorted = [...records].sort((a, b) => getRecordTime(a) - getRecordTime(b))
  const targetIndex = sorted.findIndex((record) => String(record.id || "") === targetId)
  const recordsThroughTarget = targetIndex >= 0 ? sorted.slice(0, targetIndex + 1) : sorted
  const credited = recordsThroughTarget.reduce(
    (sum, record) => sum + getPaymentRecordCreditedAmount(record),
    0,
  )
  return Math.max(bookingTotal - credited, 0)
}

function buildVerifiedReceipt(
  booking: DataRecord,
  payment: PaymentRecordLike,
  history: DataRecord[],
  remainingBalance: number,
  now: string,
): { history: DataRecord[]; receipt: DataRecord } {
  const existingIndex = history.findIndex((receipt) => (
    String(receipt.paymentId || "") === String(payment.id || "") ||
    (payment.receiptNumber && String(receipt.receiptNumber || "") === String(payment.receiptNumber))
  ))
  const existing = existingIndex >= 0 ? history[existingIndex] : undefined
  const receiptNumber = String(
    payment.receiptNumber || existing?.receiptNumber || createReceiptNumber(),
  )
  const submittedAt = String(payment.submittedAt || existing?.paymentSubmittedAt || now)
  const method = String(payment.paymentMethod || "").toLowerCase() === "cash"
    ? "Pay at the Office"
    : "Bank Transfer"
  const receipt: DataRecord = {
    ...(existing || {}),
    receiptNumber,
    bookingId: String(booking.id || payment.bookingId || ""),
    paymentId: String(payment.id || ""),
    fullName: String(
      (isRecord(booking.userInfo) && booking.userInfo.name) || payment.customerName || "Client",
    ),
    bookingDate: String(booking.createdAt || submittedAt),
    startDate: String(booking.date || "Not set"),
    endDate: String(booking.endDate || booking.date || "Not set"),
    rentalType: booking.isOfficeRental === true || booking.bookingCategory === "office"
      ? "Office Space Rental"
      : "Event Venue Booking",
    bookingType: String(booking.eventType || "Event Venue Booking"),
    contractTerm: String(booking.contractTerm || booking.rentalTerm || ""),
    paymentPurpose: String(payment.term || "Event Venue Payment"),
    paymentMethod: method,
    amountPaid: getPaymentRecordAmount(payment),
    paymentAmount: getPaymentRecordAmount(payment),
    remainingBalance,
    paymentStatus: "Verified",
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

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error(
    "[POST /api/payments/review]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to verify the payment. Please try again." }, { status: 500 })
}

export async function POST(request: NextRequest) {
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
    if (action !== "verify") throw new ApiAuthError(400, "Unsupported payment review action.")

    const bookingId = String(body.bookingId || "").trim()
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(bookingId)) {
      throw new ApiAuthError(400, "Invalid booking ID.")
    }
    const paymentRecordId = body.paymentRecordId == null ? "" : String(body.paymentRecordId).trim()
    if (paymentRecordId && !/^[A-Za-z0-9_-]{1,160}$/.test(paymentRecordId)) {
      throw new ApiAuthError(400, "Invalid payment record ID.")
    }

    const noteValue = body.adminNote == null ? "" : String(body.adminNote).trim()
    if (noteValue.length > 2000) throw new ApiAuthError(400, "The admin note is too long.")

    let requestedAmount: number | undefined
    if (body.verifiedAmount !== undefined && body.verifiedAmount !== null && body.verifiedAmount !== "") {
      requestedAmount = Number(body.verifiedAmount)
      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0 || requestedAmount > 10_000_000) {
        throw new ApiAuthError(400, "Please provide a valid verified amount.")
      }
    }

    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)
    const result = await firestore.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef)
      if (!bookingSnapshot.exists) throw new ApiAuthError(404, "Booking not found.")

      const bookingData: DataRecord = { ...(bookingSnapshot.data() as DataRecord), id: bookingId }
      const bookingCode = String(bookingData.bookingCode || "").trim()
      const paymentRecords = new Map<string, PaymentRecordLike>()

      const paymentQueries = [
        firestore.collection("payments").where("bookingId", "==", bookingId),
        firestore.collection("payments").where("bookingCode", "==", bookingId),
      ]
      if (bookingCode && bookingCode !== bookingId) {
        paymentQueries.push(
          firestore.collection("payments").where("bookingId", "==", bookingCode),
          firestore.collection("payments").where("bookingCode", "==", bookingCode),
        )
      }
      for (const paymentQuery of paymentQueries) {
        const paymentSnapshots = await transaction.get(paymentQuery)
        paymentSnapshots.forEach((snapshot) => {
          paymentRecords.set(snapshot.id, normalizePaymentRecord(snapshot.id, snapshot.data() as DataRecord))
        })
      }

      if (paymentRecordId && !paymentRecords.has(paymentRecordId)) {
        const explicitPaymentSnapshot = await transaction.get(
          firestore.collection("payments").doc(paymentRecordId),
        )
        if (explicitPaymentSnapshot.exists) {
          paymentRecords.set(
            explicitPaymentSnapshot.id,
            normalizePaymentRecord(explicitPaymentSnapshot.id, explicitPaymentSnapshot.data() as DataRecord),
          )
        }
      }

      const allRecords = [...paymentRecords.values()].filter((record) =>
        belongsToBooking(record, bookingId, bookingCode),
      )
      const target = paymentRecordId
        ? allRecords.find((record) => String(record.id || "") === paymentRecordId)
        : [...allRecords]
            .sort((a, b) => getRecordTime(b) - getRecordTime(a))
            .find((record) => isUnresolvedPaymentRecord(record))

      if (!target || !target.id) throw new ApiAuthError(404, "Payment record not found.")
      if (!belongsToBooking(target, bookingId, bookingCode)) {
        throw new ApiAuthError(403, "This payment does not belong to the booking.")
      }
      if (!isVerifiedPaymentRecord(target) && !isUnresolvedPaymentRecord(target)) {
        throw new ApiAuthError(409, "This payment has already been resolved.")
      }

      const submittedAmount = getPaymentRecordAmount(target)
      const fallbackAmount = submittedAmount || toPaymentAmount(bookingData.paymentAmount) || toPaymentAmount(bookingData.totalPrice)
      const verifiedAmount = isVerifiedPaymentRecord(target)
        ? submittedAmount
        : requestedAmount || fallbackAmount
      if (verifiedAmount <= 0) throw new ApiAuthError(400, "The payment has no valid amount to verify.")
      if (!isVerifiedPaymentRecord(target) && submittedAmount > 0 && verifiedAmount > submittedAmount + 0.01) {
        throw new ApiAuthError(400, "The verified amount cannot exceed the submitted amount.")
      }

      const transition = buildVerifiedPaymentTransition(
        bookingData,
        allRecords,
        target,
        {
          verifiedAmount,
          adminName: user.fullName || "Administrator",
          adminNote: noteValue,
        },
      )
      const receiptRemainingBalance = getReceiptRemainingBalance(
        transition.summary.bookingTotal,
        transition.records,
        String(target.id),
      )
      const receiptResult = buildVerifiedReceipt(
        transition.booking,
        transition.payment,
        getReceiptHistory(bookingData),
        receiptRemainingBalance,
        new Date().toISOString(),
      )
      const bookingWithReceipt: DataRecord = {
        ...transition.booking,
        paymentReceipts: receiptResult.history,
        receipt: receiptResult.receipt,
        receiptIssued: true,
        receiptNumber: receiptResult.receipt.receiptNumber,
        receiptIssuedAt: receiptResult.receipt.dateGenerated,
      }
      const paymentWithReceipt: PaymentRecordLike = {
        ...transition.payment,
        receiptNumber: receiptResult.receipt.receiptNumber,
      }

      const { id: _bookingId, ...bookingToPersist } = bookingWithReceipt
      const { id: _paymentId, ...paymentToPersist } = paymentWithReceipt
      transaction.set(
        bookingRef,
        stripUndefinedDeep(bookingToPersist) as DataRecord,
        { merge: true },
      )
      transaction.set(
        firestore.collection("payments").doc(String(target.id)),
        stripUndefinedDeep(paymentToPersist) as DataRecord,
        { merge: true },
      )
      transaction.set(
        firestore.collection("receipts").doc(String(receiptResult.receipt.receiptNumber)),
        stripUndefinedDeep(receiptResult.receipt) as DataRecord,
        { merge: true },
      )

      return {
        booking: { ...bookingWithReceipt, id: bookingId },
        payment: { ...paymentWithReceipt, id: target.id },
        summary: transition.summary,
        alreadyVerified: transition.alreadyVerified,
        userId: String(bookingData.userId || ""),
        customerName: String(
          (isRecord(bookingData.userInfo) && bookingData.userInfo.name) || target.customerName || "Client",
        ),
      }
    })

    if (!result.alreadyVerified && result.userId) {
      try {
        await firestore.collection("notifications").add({
          type: "payment_approved",
          title: "Payment Approved",
          message: `Your payment for Booking ${bookingId} has been approved.`,
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

    return NextResponse.json(result)
  } catch (error: unknown) {
    return errorResponse(error)
  }
}
