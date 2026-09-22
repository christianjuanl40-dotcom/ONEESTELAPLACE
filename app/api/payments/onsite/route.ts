import "server-only"

import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
} from "@/lib/server-auth"
import {
  calculatePaymentSummary,
  getRecordsForBooking,
  type PaymentRecordLike,
} from "@/src/modules/shared/lib/payment-calculations"
import { buildVerifiedPaymentTransition } from "@/src/modules/shared/lib/payment-verification"

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
  const amount = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    throw new ApiAuthError(400, "Please provide a valid received amount.")
  }
  return Math.round(amount * 100) / 100
}

function asIso(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString()
  }
  return value
}

function createReceiptNumber(): string {
  return `ER-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`
}

function isOfficeBooking(booking: DataRecord): boolean {
  return booking.isOfficeRental === true || booking.bookingCategory === "office" ||
    String(booking.venue || "").toLowerCase().includes("office")
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
    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)

    const result = await firestore.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef)
      if (!bookingSnapshot.exists) throw new ApiAuthError(404, "Booking not found.")
      const booking: DataRecord & { id: string } = { ...(bookingSnapshot.data() as DataRecord), id: bookingId }
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
      if (summary.hasPendingSubmission) {
        throw new ApiAuthError(409, "This booking already has a payment under review.")
      }
      if (summary.fullyPaid || summary.remainingBalance <= 0) {
        throw new ApiAuthError(409, "This booking has no remaining amount due.")
      }
      if (amountReceived > summary.remainingBalance + 0.01) {
        throw new ApiAuthError(400, "The received amount exceeds the current balance.")
      }
      if (paymentType === "full_payment" && Math.abs(amountReceived - summary.remainingBalance) > 0.01) {
        throw new ApiAuthError(400, `Full payment must equal ${summary.remainingBalance.toLocaleString()}.`)
      }
      if (paymentType === "downpayment" && summary.remainingDownpayment > 0 && amountReceived > summary.remainingDownpayment + 0.01) {
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
        ...bookingToPersist,
        updatedAt: now,
      }, { merge: true })
      transaction.set(firestore.collection("payments").doc(paymentId), {
        ...paymentToPersist,
        receiptNumber,
        method: "Cash / Onsite",
        paymentMethod: "cash",
        adminNote,
      }, { merge: true })
      transaction.set(firestore.collection("receipts").doc(receiptNumber), receipt, { merge: true })

      return {
        booking: bookingWithReceipt,
        payment: { ...transition.payment, id: paymentId, receiptNumber },
        userId: String(booking.userId || ""),
      }
    })

    if (result.userId) {
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
    return NextResponse.json(result, { status: 201 })
  } catch (error: unknown) {
    return errorResponse(error)
  }
}
