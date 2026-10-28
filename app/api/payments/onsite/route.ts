import "server-only"
import { canAutomaticallyExpireBooking } from "@/src/modules/shared/lib/booking-lifecycle"
import { isAvailabilityBlockingBooking } from "@/src/modules/shared/lib/booking-helpers"

import { createHash, randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
} from "@/lib/server-auth"
import {
  calculatePaymentSummary,
  centsToPaymentAmount,
  MAX_PAYMENT_AMOUNT_CENTS,
  parseCurrencyToCents,
  toPaymentCents,
  getNextPaymentNumber,
  getRecordsForBooking,
  type PaymentRecordLike,
} from "@/src/modules/shared/lib/payment-calculations"
import { buildVerifiedPaymentTransition } from "@/src/modules/shared/lib/payment-verification"
import { isOfficeResourceBooking } from "@/src/modules/shared/lib/resource-identity"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>
type OnsitePaymentType = "downpayment" | "remaining_balance" | "full_payment"

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null
}

function readString(body: DataRecord, key: string, maxLength: number, required = false): string {
  const value = body[key]
  if (typeof value !== "string") {
    if (required) throw new ApiAuthError(400, `A valid ${key} is required.`)
    return ""
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new ApiAuthError(400, `${key} is too long.`)
  if (required && !normalized) throw new ApiAuthError(400, `A valid ${key} is required.`)
  return normalized
}

function readAmount(value: unknown): number {
  const cents = parseCurrencyToCents(value)
  if (cents === null || cents <= 0 || cents > MAX_PAYMENT_AMOUNT_CENTS) {
    throw new ApiAuthError(400, "Please provide a valid received amount.")
  }
  return centsToPaymentAmount(cents)
}

function readIdempotencyKey(body: DataRecord): string {
  const value = body.idempotencyKey
  if (value === undefined || value === null || value === "") return ""
  if (typeof value !== "string") throw new ApiAuthError(400, "Invalid idempotency key.")
  const key = value.trim()
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) throw new ApiAuthError(400, "Invalid idempotency key.")
  return key
}

function getIdempotencyRef(firestore: ReturnType<typeof getAdminFirestore>, bookingId: string, key: string) {
  const digest = createHash("sha256").update(`${bookingId}\u0000${key}`).digest("hex")
  return firestore.collection("paymentIdempotency").doc(`onsite_${digest}`)
}

function getIdempotencyFingerprint(paymentType: OnsitePaymentType, amountReceived: number, adminNote: string): string {
  return JSON.stringify({ paymentType, amountCents: toPaymentCents(amountReceived), adminNote })
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

function createReceiptNumber(): string {
  return `ER-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`
}

function isOfficeBooking(booking: DataRecord): boolean {
  return isOfficeResourceBooking(booking)
}

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(
    "[POST /api/payments/onsite]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to record the onsite payment. Please try again." }, { status: 500 })
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    if (
      (user.role !== "admin" && user.role !== "staff") ||
      (user.role !== "admin" && user.permissions.bookings !== true && user.permissions.payments !== true)
    ) {
      throw new ApiAuthError(403, "You do not have permission to record onsite payments.")
    }

    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 32 * 1024) {
      throw new ApiAuthError(413, "The onsite payment request is too large.")
    }
    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in onsite payment request.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid onsite payment request.")

    const bookingId = readString(body, "bookingId", 128, true)
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(bookingId)) throw new ApiAuthError(400, "Invalid booking ID.")
    const paymentType = readString(body, "paymentType", 30, true) as OnsitePaymentType
    if (!(["downpayment", "remaining_balance", "full_payment"] as string[]).includes(paymentType)) {
      throw new ApiAuthError(400, "Invalid onsite payment type.")
    }
    const amountReceived = readAmount(body.amountReceived)
    const adminNote = readString(body, "adminNote", 2000)
    // Existing non-browser callers may omit this field for compatibility. The
    // dashboard always supplies it, which makes retries of a committed onsite
    // payment resolve to the original atomic result instead of creating money
    // twice.
    const idempotencyKey = readIdempotencyKey(body)
    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)
    const idempotencyRef = idempotencyKey
      ? getIdempotencyRef(firestore, bookingId, idempotencyKey)
      : null
    const fingerprint = getIdempotencyFingerprint(paymentType, amountReceived, adminNote)

    const result = await firestore.runTransaction(async (transaction) => {
      if (idempotencyRef) {
        const idempotencySnapshot = await transaction.get(idempotencyRef)
        if (idempotencySnapshot.exists) {
          const saved = idempotencySnapshot.data() as DataRecord
          if (saved.fingerprint !== fingerprint) {
            throw new ApiAuthError(409, "This idempotency key was already used for a different onsite payment.")
          }
          const savedPaymentId = String(saved.paymentId || "")
          if (String(saved.bookingId || "") !== bookingId || !savedPaymentId) {
            throw new ApiAuthError(409, "The onsite payment retry record is invalid. Contact support.")
          }
          const savedBookingSnapshot = await transaction.get(bookingRef)
          const savedPaymentSnapshot = await transaction.get(firestore.collection("payments").doc(savedPaymentId))
          if (!savedBookingSnapshot.exists || !savedPaymentSnapshot.exists) {
            throw new ApiAuthError(409, "The original onsite payment could not be recovered. Contact support.")
          }
          return {
            booking: { ...(savedBookingSnapshot.data() as DataRecord), id: bookingId },
            payment: { ...(savedPaymentSnapshot.data() as DataRecord), id: savedPaymentId },
            userId: "",
            alreadyProcessed: true,
          }
        }
      }

      const bookingSnapshot = await transaction.get(bookingRef)
      if (!bookingSnapshot.exists) throw new ApiAuthError(404, "Booking not found.")
      const booking: DataRecord & { id: string } = { ...(bookingSnapshot.data() as DataRecord), id: bookingId }
      const terminalStatuses = [booking.status, booking.bookingStatus]
        .map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "_"))
      if (["cancelled", "canceled", "declined", "completed", "expired", "rental_expired"].some((status) => terminalStatuses.includes(status))) {
        throw new ApiAuthError(409, "This booking cannot accept another payment.")
      }
      if (String(booking.cancellationStatus || "").trim().toLowerCase() === "approved") {
        throw new ApiAuthError(409, "This booking cannot accept another payment.")
      }
      const bookingCode = String(booking.bookingCode || "").trim()
      const paymentSnapshots = new Map<string, any>()
      const paymentQueries = [
        firestore.collection("payments").where("bookingId", "==", bookingId),
        firestore.collection("payments").where("bookingCode", "==", bookingId),
      ]
      if (bookingCode && bookingCode !== bookingId) {
        paymentQueries.push(firestore.collection("payments").where("bookingId", "==", bookingCode))
        paymentQueries.push(firestore.collection("payments").where("bookingCode", "==", bookingCode))
      }
      for (const paymentQuery of paymentQueries) {
        const snapshot = await transaction.get(paymentQuery)
        snapshot.forEach((paymentSnapshot) => paymentSnapshots.set(paymentSnapshot.id, paymentSnapshot))
      }
      const records: PaymentRecordLike[] = [...paymentSnapshots.values()].map((paymentSnapshot) => {
        const data = paymentSnapshot.data() as DataRecord
        return {
          ...data,
          id: paymentSnapshot.id,
          submittedAt: asIso(data.submittedAt),
          updatedAt: asIso(data.updatedAt),
          reviewedAt: asIso(data.reviewedAt),
        }
      })
      const existingRecords = [
        ...getRecordsForBooking(records, bookingId),
        ...getRecordsForBooking(records, bookingCode),
      ].filter((record, index, all) => (
        all.findIndex((candidate) => String(candidate.id || "") === String(record.id || "")) === index
      ))
      const summaryBase = {
        ...booking,
        paymentType: paymentType === "downpayment"
          ? "downpayment"
          : paymentType === "full_payment"
            ? "full"
            : booking.paymentType,
      }
      const summary = calculatePaymentSummary(summaryBase, existingRecords)
      if (canAutomaticallyExpireBooking(booking, existingRecords) || !isAvailabilityBlockingBooking(booking)) {
        throw new ApiAuthError(409, "This reservation hold has expired or been released. Create a new availability-checked booking before paying.")
      }
      if (summary.hasPendingSubmission) {
        throw new ApiAuthError(409, "This booking already has a payment under review.")
      }
      if (summary.fullyPaid || summary.remainingBalance <= 0) {
        throw new ApiAuthError(409, "This booking has no remaining amount due.")
      }
      const amountReceivedCents = toPaymentCents(amountReceived)
      const remainingBalanceCents = toPaymentCents(summary.remainingBalance)
      if (amountReceivedCents > remainingBalanceCents) {
        throw new ApiAuthError(400, "The received amount exceeds the current balance.")
      }
      if (paymentType === "full_payment" && amountReceivedCents !== remainingBalanceCents) {
        throw new ApiAuthError(400, `Full payment must equal ${centsToPaymentAmount(remainingBalanceCents).toLocaleString()}.`)
      }
      if (paymentType === "downpayment" && summary.remainingDownpayment > 0
        && amountReceivedCents > toPaymentCents(summary.remainingDownpayment)) {
        throw new ApiAuthError(400, "The downpayment amount exceeds the remaining downpayment.")
      }

      const now = new Date().toISOString()
      const paymentId = `PAY-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`
      const term = paymentType === "downpayment"
        ? "Down Payment"
        : paymentType === "full_payment"
          ? "Full Payment"
          : "Balance Payment"
      const target: PaymentRecordLike = {
        id: paymentId,
        paymentNumber: getNextPaymentNumber(existingRecords),
        bookingId,
        bookingCode: bookingCode || bookingId,
        customerId: String(booking.userId || ""),
        customerName: isRecord(booking.userInfo) ? String(booking.userInfo.name || "Client") : "Client",
        eventName: String(booking.eventName || ""),
        venueName: String(booking.venue || ""),
        method: "Cash / Onsite",
        paymentMethod: "cash",
        term,
        amount: amountReceived,
        amountPaid: amountReceived,
        status: "For Verification",
        verificationStatus: "Pending Onsite Verification",
        submittedAt: now,
        updatedAt: now,
        adminNote,
      }
      const transition = buildVerifiedPaymentTransition(
        summaryBase as DataRecord & { id?: unknown },
        [...existingRecords, target],
        target,
        {
          verifiedAmount: amountReceived,
          adminName: user.fullName || "Administrator",
          adminNote,
          now,
        },
      )
      const receiptNumber = createReceiptNumber()
      const receipt = {
        receiptNumber,
        bookingId,
        paymentId,
        paymentNumber: transition.payment.paymentNumber,
        reviewSnapshot: transition.payment.reviewSnapshot,
        fullName: isRecord(booking.userInfo) ? String(booking.userInfo.name || "Client") : "Client",
        bookingDate: String(booking.createdAt || now),
        startDate: String(booking.date || "Not set"),
        endDate: String(booking.endDate || booking.date || "Not set"),
        rentalType: isOfficeBooking(booking) ? "Office Space Rental" : "Event Venue Booking",
        bookingType: String(booking.eventType || "Event Venue Booking"),
        paymentPurpose: term,
        paymentMethod: "Pay at the Office",
        amountPaid: amountReceived,
        paymentAmount: amountReceived,
        remainingBalance: transition.summary.remainingBalance,
        paymentStatus: "Verified",
        dateGenerated: now,
        dateIssued: now,
        paymentSubmittedAt: now,
      }
      const bookingWithReceipt: DataRecord & { id: string } = {
        ...transition.booking,
        id: bookingId,
        paymentType: paymentType === "full_payment" ? "full" : paymentType === "downpayment" ? "downpayment" : booking.paymentType,
        paymentMethod: "cash",
        actualPaymentMethod: "Cash / Onsite",
        manualPaymentMarked: true,
        manualPaymentMarkedAt: now,
        manualPaymentMarkedBy: user.fullName || "Administrator",
        manualPaymentNote: adminNote,
        paymentReceipts: [
          ...(Array.isArray(booking.paymentReceipts) ? booking.paymentReceipts.filter(isRecord) : []),
          receipt,
        ],
        receipt,
        receiptIssued: true,
        receiptNumber,
        receiptIssuedAt: now,
      }
      const { id: _bookingId, ...bookingToPersist } = bookingWithReceipt
      const { id: _paymentId, ...paymentToPersist } = transition.payment
      transaction.set(bookingRef, {
        ...stripUndefinedDeep(bookingToPersist) as DataRecord,
        updatedAt: now,
      }, { merge: true })
      transaction.set(firestore.collection("payments").doc(paymentId), {
        ...stripUndefinedDeep(paymentToPersist) as DataRecord,
        receiptNumber,
        method: "Cash / Onsite",
        paymentMethod: "cash",
        adminNote,
      }, { merge: true })
      transaction.set(
        firestore.collection("receipts").doc(receiptNumber),
        stripUndefinedDeep(receipt) as DataRecord,
        { merge: true },
      )
      if (idempotencyRef) {
        transaction.create(idempotencyRef, {
          bookingId,
          paymentId,
          receiptNumber,
          fingerprint,
          createdAt: now,
        })
      }

      return {
        booking: bookingWithReceipt,
        payment: { ...transition.payment, id: paymentId, receiptNumber },
        userId: String(booking.userId || ""),
        alreadyProcessed: false,
      }
    })

    if (result.userId && !result.alreadyProcessed) {
      try {
        await firestore.collection("notifications").add({
          type: "payment_approved",
          title: "Payment Recorded",
          message: `An onsite payment for Booking ${bookingId} has been recorded.`,
          bookingId,
          userId: result.userId,
          isRead: false,
          moduleRead: false,
          createdAt: new Date(),
          link: `/portal/payments?highlight=${bookingId}`,
        })
      } catch (error) {
        console.error("[POST /api/payments/onsite] Notification write failed:", error)
      }
    }
    return NextResponse.json(result, { status: result.alreadyProcessed ? 200 : 201 })
  } catch (error: unknown) {
    return errorResponse(error)
  }
}
