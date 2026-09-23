import "server-only"

import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
} from "@/lib/server-auth"
import { formatDisplayName } from "@/src/modules/shared/lib/name-utils"
import {
  calculatePaymentSummary,
  type PaymentRecordLike,
  type PaymentSummary,
} from "@/src/modules/shared/lib/payment-calculations"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

const BOOKING_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_PROOF_LENGTH = 400_000

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null
}

function readString(body: DataRecord, key: string, maxLength: number): string {
  const value = body[key]
  if (value === undefined || value === null) return ""
  if (typeof value !== "string") throw new ApiAuthError(400, `Invalid ${key}.`)
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new ApiAuthError(400, `${key} is too long.`)
  return normalized
}

function readAmount(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) {
    throw new ApiAuthError(400, "Please provide a valid payment amount.")
  }
  return Math.round(amount * 100) / 100
}

function isValidProof(value: string, bookingId: string): boolean {
  if (!value || value.length > MAX_PROOF_LENGTH) return false
  if (/^data:image\/(?:jpe?g|png|webp);base64,[a-z0-9+/=]+$/i.test(value)) return true
  try {
    const url = new URL(value)
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "cloudinary.com" && !url.hostname.endsWith(".cloudinary.com"))
    ) {
      return false
    }

    const pathParts = url.pathname.split("/").filter(Boolean)
    const uploadIndex = pathParts.indexOf("upload")
    if (uploadIndex < 0) return false
    const publicIdParts = pathParts.slice(uploadIndex + 1).map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
    const imageDelivery = uploadIndex > 0 && pathParts[uploadIndex - 1] === "image"
    const supportedImage = /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
    return imageDelivery && supportedImage && publicIdParts.some(
      (part, index) => part === "payment-proofs" && publicIdParts[index + 1] === bookingId,
    )
  } catch {
    return false
  }
}

function getNumber(data: DataRecord, key: string, fallback = 0): number {
  const value = Number(data[key])
  return Number.isFinite(value) ? value : fallback
}

function isOfficeBooking(data: DataRecord): boolean {
  return data.isOfficeRental === true || data.bookingCategory === "office" ||
    String(data.venue || "").toLowerCase().includes("office")
}

function getMaxPaymentAmount(
  booking: DataRecord,
  type: "full" | "downpayment" | "slot_reservation",
  summary: PaymentSummary,
): number {
  const remaining = summary.remainingBalance

  if (isOfficeBooking(booking)) {
    const reservationFee = Math.max(
      0,
      getNumber(booking, "officeReservationFee", getNumber(booking, "totalPrice")),
    )
    return Math.max(reservationFee - Math.min(summary.moneyReceivedTotal, reservationFee), 0)
  }

  if (type === "slot_reservation") {
    return remaining
  }

  if (type === "downpayment") {
    return Math.max(0, Math.min(remaining, summary.remainingDownpayment))
  }

  return remaining
}

function createReceiptNumber(): string {
  return `ER-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`
}

function withLog(booking: DataRecord, action: string, message: string, createdAt: string) {
  const existing = Array.isArray(booking.adminLogs) ? booking.adminLogs.filter(isRecord) : []
  return [
    ...existing.slice(-49),
    { action, message, createdAt },
  ]
}

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error(
    "[POST /api/payments/submit]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to submit the payment. Please try again." }, { status: 500 })
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    if (user.role !== "client") {
      throw new ApiAuthError(403, "Only client accounts can submit payments.")
    }

    const contentLength = Number(request.headers.get("content-length") || 0)
    if (contentLength > 512 * 1024) {
      throw new ApiAuthError(413, "The payment submission is too large.")
    }

    let body: unknown
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 512 * 1024) {
      throw new ApiAuthError(413, "The payment submission is too large.")
    }
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in request body.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid payment submission.")

    const bookingId = readString(body, "bookingId", 128)
    if (!BOOKING_ID_PATTERN.test(bookingId)) throw new ApiAuthError(400, "Invalid booking ID.")

    const typeValue = readString(body, "type", 20)
    if (typeValue !== "full" && typeValue !== "downpayment" && typeValue !== "slot_reservation") {
      throw new ApiAuthError(400, "Invalid payment type.")
    }
    const type = typeValue as "full" | "downpayment" | "slot_reservation"

    const method = readString(body, "method", 10)
    if (method !== "bank" && method !== "cash") throw new ApiAuthError(400, "Invalid payment method.")

    const proof = readString(body, "proof", MAX_PROOF_LENGTH)
    const referenceNumber = readString(body, "bankReferenceNumber", 120)
    if (method === "bank") {
       if (!isValidProof(proof, bookingId)) throw new ApiAuthError(400, "A valid payment proof is required.")
      if (referenceNumber.replace(/\D/g, "").length < 13) {
        throw new ApiAuthError(400, "Please provide a valid bank reference number.")
      }
    }

    const requestedAmount = readAmount(body.amount)
    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)

    const result = await firestore.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef)
      if (!bookingSnapshot.exists) throw new ApiAuthError(404, "Booking not found.")

      const booking = bookingSnapshot.data() as DataRecord
      if (booking.userId !== user.uid) throw new ApiAuthError(403, "You do not have access to this booking.")

      const bookingCode = String(booking.bookingCode || "").trim()
      const paymentSnapshots = new Map<string, any>()
      const paymentQueries = [
        firestore.collection("payments").where("bookingId", "==", bookingId),
      ]
      if (bookingCode && bookingCode !== bookingId) {
        paymentQueries.push(firestore.collection("payments").where("bookingId", "==", bookingCode))
        paymentQueries.push(firestore.collection("payments").where("bookingCode", "==", bookingCode))
      }
      paymentQueries.push(firestore.collection("payments").where("bookingCode", "==", bookingId))
      for (const paymentQuery of paymentQueries) {
        const snapshot = await transaction.get(paymentQuery)
        snapshot.forEach((paymentSnapshot) => paymentSnapshots.set(paymentSnapshot.id, paymentSnapshot))
      }
      const existingPayments: PaymentRecordLike[] = [...paymentSnapshots.values()].map((paymentSnapshot) => ({
        ...(paymentSnapshot.data() as DataRecord),
        id: paymentSnapshot.id,
      }))
      const summary = calculatePaymentSummary(booking, existingPayments)

      const officeBooking = isOfficeBooking(booking)
      if (officeBooking && type !== "slot_reservation") {
        throw new ApiAuthError(400, "Office bookings only accept slot reservation payments online.")
      }
      if (!officeBooking && type === "slot_reservation") {
        throw new ApiAuthError(400, "Slot reservation payments are only available for office bookings.")
      }

      const bookingStatus = String(booking.status || "").toLowerCase()
      if (["cancelled", "declined", "completed", "rental_expired"].includes(bookingStatus)) {
        throw new ApiAuthError(409, "This booking cannot accept another payment.")
      }
      if (summary.hasPendingSubmission) {
        throw new ApiAuthError(409, "This booking already has a payment under review.")
      }

      const maxAmount = getMaxPaymentAmount(booking, type, summary)
      if (requestedAmount > maxAmount + 0.01) {
        throw new ApiAuthError(400, "The payment amount exceeds the current amount due.")
      }
      if (maxAmount <= 0) {
        throw new ApiAuthError(409, "This booking has no remaining amount due.")
      }
      if ((type === "full" || type === "slot_reservation") && Math.abs(requestedAmount - maxAmount) > 0.01) {
        throw new ApiAuthError(400, `This payment must equal ${maxAmount.toLocaleString()}.`)
      }

      const now = new Date().toISOString()
      const paymentId = `PAY-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`
      const receiptNumber = createReceiptNumber()
      const paymentStatus = method === "cash" ? "Awaiting Onsite Payment" : "For Verification"
       const fullName = formatDisplayName(
         user,
         user.fullName || String(booking.userInfo && isRecord(booking.userInfo) ? booking.userInfo.name : "Client"),
       )
      const paymentMethodLabel = method === "cash" ? "Pay at the Office" : "Bank Transfer"
      const termLabel = type === "downpayment" ? "Down Payment" : type === "full" ? "Full Payment" : "Slot Reservation"

      const receipt = {
        receiptNumber,
        bookingId,
        paymentId,
        fullName,
        bookingDate: String(booking.createdAt || now),
        startDate: String(booking.date || "Not set"),
        endDate: String(booking.endDate || booking.date || "Not set"),
        rentalType: isOfficeBooking(booking) ? "Office Space Rental" : "Event Venue Booking",
        bookingType: isOfficeBooking(booking) ? "Office Space Rental" : String(booking.eventType || "Event Venue Booking"),
        contractTerm: String(booking.contractTerm || ""),
        paymentPurpose: termLabel,
        paymentMethod: paymentMethodLabel,
        amountPaid: requestedAmount,
        paymentAmount: requestedAmount,
        remainingBalance: summary.remainingBalance,
        paymentStatus,
        dateGenerated: now,
        dateIssued: now,
        paymentSubmittedAt: now,
      }

      const paymentRecord = {
        id: paymentId,
        bookingId,
        bookingCode: String(booking.bookingCode || bookingId),
        customerId: user.uid,
        customerName: fullName,
        eventName: String(booking.eventName || ""),
        venueName: String(booking.venue || ""),
        method: paymentMethodLabel,
        paymentMethod: method,
        term: termLabel,
        amount: requestedAmount,
        amountPaid: requestedAmount,
        referenceNo: method === "bank" ? referenceNumber : "",
        proofUrl: method === "bank" ? proof : "",
        status: paymentStatus,
        verificationStatus: method === "cash" ? "Pending Onsite Verification" : "Pending",
        receiptNumber,
        isRemainingDownPayment: type === "downpayment" && summary.downpaymentCreditedTotal > 0,
        submittedAt: now,
        updatedAt: now,
      }

      const existingReceipts = Array.isArray(booking.paymentReceipts)
        ? booking.paymentReceipts.filter(isRecord)
        : []
      const previouslySecured = booking.isSlotSecured === true || [
        "confirmed",
        "reservation_secured",
        "contract_signing_required",
        "active_rental",
      ].includes(String(booking.status || "").toLowerCase())
      const paymentStatusBeforeSubmission = summary.fullyPaid
        ? "paid"
        : summary.downpaymentComplete
          ? "partial"
          : summary.moneyReceivedTotal > 0
            ? "incomplete"
            : "for_review"
      const bookingUpdate = {
        status: previouslySecured ? booking.status || "confirmed" : "verifying",
        bookingStatus: previouslySecured ? booking.bookingStatus || "Confirmed" : "Pending Verification",
        isSlotSecured: previouslySecured || summary.downpaymentComplete,
        paymentStatus: paymentStatusBeforeSubmission,
        paymentType: type,
        paymentMethod: method,
        actualPaymentMethod: method === "cash" ? "Cash / Onsite" : "Bank Transfer",
        paymentSubmissionType: method === "cash" ? "onsite" : "bank_transfer",
        bankReferenceNumber: method === "bank" ? referenceNumber : "",
        paymentReference: method === "bank" ? referenceNumber : "",
        proofUrl: method === "bank" ? proof : "",
        paymentAmount: requestedAmount,
        pendingPaymentAmount: requestedAmount,
        paymentSubmittedAt: now,
        amountPaid: summary.acceptedTotalPaid,
        downpaymentPaid: summary.acceptedDpPaid,
        downpaymentRemaining: summary.remainingDownpayment,
        remainingBalance: summary.remainingBalance,
        remainingBalancePaid: summary.fullyPaid,
        verifiedByAdmin: false,
        hasActivePaymentSubmission: true,
        receiptIssued: true,
        receiptNumber,
        receiptIssuedAt: now,
        paymentReceipts: [...existingReceipts, receipt],
        adminLogs: withLog(
          booking,
          "PAYMENT_SUBMITTED",
          `Client submitted ${termLabel.toLowerCase()} payment for admin verification.`,
          now,
        ),
        lastActivityAt: now,
        updatedAt: now,
        ...(isOfficeBooking(booking)
          ? {
              officeReservationStatus: "pending_verification",
              officeContractSigningRequired: true,
              officePaymentInstructions:
                "Your office slot reservation payment is under admin review. Succeeding rental payments are settled onsite by check.",
            }
          : {}),
      }

      transaction.update(bookingRef, bookingUpdate)
      transaction.create(firestore.collection("payments").doc(paymentId), paymentRecord)
      transaction.create(firestore.collection("receipts").doc(receiptNumber), receipt)

      return {
        booking: { ...booking, id: bookingId, ...bookingUpdate },
        payment: paymentRecord,
        receipt,
        notification: {
          type: "payment_submitted",
          title: "Payment for Review",
          message: `A new payment for ${String(booking.venue || booking.eventName || "a venue")} is waiting for verification.`,
          bookingId,
          userId: "admin",
          relatedUserId: user.uid,
          relatedUserName: fullName,
          isRead: false,
          moduleRead: false,
          createdAt: now,
          link: `/dashboard/payments?highlight=${bookingId}`,
        },
      }
    })

    try {
      await firestore.collection("notifications").add({
        ...result.notification,
        createdAt: new Date(),
      })
    } catch (error: unknown) {
      console.error(
        "[POST /api/payments/submit] Notification write failed:",
        error instanceof Error ? error.message : "Unknown error",
      )
    }

    return NextResponse.json(result, { status: 201 })
  } catch (error: unknown) {
    return errorResponse(error)
  }
}
