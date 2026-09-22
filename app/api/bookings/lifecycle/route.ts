import "server-only"

import { randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
  requireBackofficeUser,
} from "@/lib/server-auth"
import {
  calculatePaymentSummary,
  getPaymentRecordAmount,
  getRecordsForBooking,
  isVerifiedPaymentRecord,
  type PaymentRecordLike,
} from "@/src/modules/shared/lib/payment-calculations"
import {
  isPaymentWindowExpired,
} from "@/src/modules/shared/lib/booking-lifecycle"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>
type LifecycleAction = "complete" | "status" | "contract_signed" | "balance_reminder" | "issue_receipt" | "expire"

const BOOKING_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

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

function asIso(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString()
  }
  return value
}

function toAmount(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

function isOfficeBooking(booking: DataRecord): boolean {
  return booking.isOfficeRental === true
    || booking.bookingCategory === "office"
    || String(booking.venue || "").toLowerCase().includes("office")
}

function appendLog(booking: DataRecord, action: string, message: string, createdAt: string) {
  const existing = Array.isArray(booking.adminLogs)
    ? booking.adminLogs.filter(isRecord).slice(-49)
    : []
  return [...existing, { action, message, createdAt }]
}

function displayBookingStatus(status: string, booking: DataRecord): string {
  if (status === "completed") return "Completed"
  if (status === "cancelled") return "Cancelled"
  if (status === "active_rental") return "Active Rental"
  if (status === "reservation_secured") return "Slot Secured"
  if (status === "confirmed") return isOfficeBooking(booking) ? "Slot Secured" : "Confirmed"
  if (status === "contract_signing_required") return "Contract Signing Required"
  return "Pending Verification"
}

async function readPaymentRecords(
  transaction: any,
  firestore: FirebaseFirestore.Firestore,
  bookingId: string,
  bookingCode: string,
): Promise<PaymentRecordLike[]> {
  const snapshots = new Map<string, DataRecord>()
  const queries = [
    firestore.collection("payments").where("bookingId", "==", bookingId),
    firestore.collection("payments").where("bookingCode", "==", bookingId),
  ]
  if (bookingCode && bookingCode !== bookingId) {
    queries.push(
      firestore.collection("payments").where("bookingId", "==", bookingCode),
      firestore.collection("payments").where("bookingCode", "==", bookingCode),
    )
  }

  for (const paymentQuery of queries) {
    const snapshot = await transaction.get(paymentQuery)
    snapshot.forEach((paymentSnapshot: any) => {
      snapshots.set(paymentSnapshot.id, paymentSnapshot.data() as DataRecord)
    })
  }

  return [...snapshots.entries()].map(([id, data]) => ({
    ...data,
    id,
    submittedAt: asIso(data.submittedAt),
    updatedAt: asIso(data.updatedAt),
    reviewedAt: asIso(data.reviewedAt),
  }))
}

function getReceiptHistory(booking: DataRecord): DataRecord[] {
  if (Array.isArray(booking.paymentReceipts)) {
    return booking.paymentReceipts.filter(isRecord)
  }
  return booking.receipt && isRecord(booking.receipt) ? [booking.receipt] : []
}

function getReceiptAmount(booking: DataRecord, records: PaymentRecordLike[]): number {
  const verified = records
    .filter(isVerifiedPaymentRecord)
    .sort((a, b) => new Date(String(b.submittedAt || b.updatedAt || "")).getTime() - new Date(String(a.submittedAt || a.updatedAt || "")).getTime())
  if (verified[0]) return getPaymentRecordAmount(verified[0])
  return Math.max(
    toAmount(booking.lastPaymentAmount),
    toAmount(booking.paymentVerifiedAmount),
    toAmount(booking.paymentAmount),
    toAmount(booking.amountPaid),
  )
}

function buildReceipt(
  booking: DataRecord,
  records: PaymentRecordLike[],
  summary: ReturnType<typeof calculatePaymentSummary>,
  now: string,
): DataRecord {
  const officeBooking = isOfficeBooking(booking)
  const verified = records
    .filter(isVerifiedPaymentRecord)
    .sort((a, b) => new Date(String(b.submittedAt || b.updatedAt || "")).getTime() - new Date(String(a.submittedAt || a.updatedAt || "")).getTime())
  const latestPayment = verified[0]
  const amount = getReceiptAmount(booking, records)
  const paymentPurpose = officeBooking
    ? "Slot Reservation Only - not full payment, not monthly rental payment, and not cheque payment."
    : String(booking.paymentType || "").toLowerCase() === "downpayment"
      ? "Event Venue Down Payment"
      : String(booking.paymentType || "").toLowerCase() === "full"
        ? "Event Venue Full Payment"
        : "Event Venue Payment"

  return {
    receiptNumber: `ER-${new Date().getUTCFullYear()}-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`,
    bookingId: String(booking.id || ""),
    ...(latestPayment?.id ? { paymentId: latestPayment.id } : {}),
    fullName: isRecord(booking.userInfo) ? String(booking.userInfo.name || "Client") : "Client",
    bookingDate: String(booking.createdAt || now),
    startDate: String(booking.date || "Not set"),
    endDate: String(booking.endDate || booking.date || "Not set"),
    rentalType: officeBooking ? "Office Space Rental" : "Event Venue Booking",
    bookingType: officeBooking ? "Office Space Rental" : String(booking.eventType || "Event Venue Booking"),
    contractTerm: String(booking.contractTerm || booking.rentalTerm || ""),
    paymentPurpose,
    paymentMethod: String(booking.paymentMethod || "").toLowerCase() === "cash" ? "Pay at the Office" : "Bank Transfer",
    amountPaid: amount,
    paymentAmount: amount,
    remainingBalance: officeBooking ? 0 : summary.remainingBalance,
    paymentStatus: officeBooking ? "Reservation Secured" : String(booking.paymentStatus || "paid"),
    dateGenerated: now,
    dateIssued: now,
    paymentSubmittedAt: String(booking.paymentSubmittedAt || now),
  }
}

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(
    "[POST /api/bookings/lifecycle]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to update the booking. Please try again." }, { status: 500 })
}

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 32 * 1024) {
      throw new ApiAuthError(413, "The lifecycle request is too large.")
    }

    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in lifecycle request.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid lifecycle request.")

    const action = readString(body, "action", 30, true).toLowerCase() as LifecycleAction
    if (!["complete", "status", "contract_signed", "balance_reminder", "issue_receipt", "expire"].includes(action)) {
      throw new ApiAuthError(400, "Invalid lifecycle action.")
    }
    const bookingId = readString(body, "bookingId", 128, true)
    if (!BOOKING_ID_PATTERN.test(bookingId)) throw new ApiAuthError(400, "Invalid booking ID.")

    const user = action === "issue_receipt" || action === "expire"
      ? await requireAuthenticatedUser(request)
      : await requireBackofficeUser(request, { permission: "bookings" })
    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)
    const signedBy = readString(body, "signedBy", 160) || user.fullName || "Administrator"
    const requestedStatus = readString(body, "status", 40)
    if (action === "status" && !["confirmed", "reservation_secured"].includes(requestedStatus)) {
      throw new ApiAuthError(400, "Invalid booking status.")
    }

    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(bookingRef)
      if (!snapshot.exists) throw new ApiAuthError(404, "Booking not found.")

      const booking: DataRecord & { id: string } = {
        ...(snapshot.data() as DataRecord),
        id: bookingId,
      }
      const now = new Date().toISOString()

      if (action === "issue_receipt") {
        if (user.role !== "client" || String(booking.userId || booking.uid || "") !== user.uid) {
          throw new ApiAuthError(403, "You do not have access to this booking.")
        }
        const bookingCode = String(booking.bookingCode || "").trim()
        const records = await readPaymentRecords(transaction, firestore, bookingId, bookingCode)
        const matchingRecords = [
          ...getRecordsForBooking(records, bookingId),
          ...getRecordsForBooking(records, bookingCode),
        ].filter((record, index, all) => all.findIndex((candidate) => candidate.id === record.id) === index)
        const summary = calculatePaymentSummary(booking, matchingRecords)
        const legacyPaidStatus = matchingRecords.length === 0 && ["verified", "paid", "slot_verified"].includes(String(booking.paymentStatus || "").toLowerCase())
        if (!summary.fullyPaid && !summary.downpaymentComplete && !legacyPaidStatus) {
          throw new ApiAuthError(409, "A receipt is available only after payment verification.")
        }

        const existingHistory = getReceiptHistory(booking)
        const latestVerifiedId = matchingRecords
          .filter(isVerifiedPaymentRecord)
          .sort((a, b) => new Date(String(b.submittedAt || b.updatedAt || "")).getTime() - new Date(String(a.submittedAt || a.updatedAt || "")).getTime())[0]?.id
        const existingReceipt = existingHistory.find((receipt) => (
          latestVerifiedId && String(receipt.paymentId || "") === String(latestVerifiedId)
        )) || (booking.receipt && isRecord(booking.receipt) ? booking.receipt : undefined)
        if (existingReceipt) {
          return { changed: false, booking, receipt: existingReceipt, userId: String(booking.userId || "") }
        }

        const receipt = buildReceipt(booking, matchingRecords, summary, now)
        const bookingUpdate = {
          paymentReceipts: [...existingHistory, receipt],
          receipt,
          receiptIssued: true,
          receiptNumber: receipt.receiptNumber,
          receiptIssuedAt: now,
          lastActivityAt: now,
          updatedAt: now,
        }
        transaction.update(bookingRef, bookingUpdate)
        transaction.set(firestore.collection("receipts").doc(String(receipt.receiptNumber)), receipt, { merge: true })
        return {
          changed: true,
          booking: { ...booking, ...bookingUpdate },
          receipt,
          userId: String(booking.userId || ""),
        }
      }

      if (action === "expire") {
        if (user.role !== "client" || String(booking.userId || booking.uid || "") !== user.uid) {
          throw new ApiAuthError(403, "You do not have access to this booking.")
        }
        if (String(booking.status || "").toLowerCase() === "cancelled") {
          return { changed: false, booking, userId: String(booking.userId || "") }
        }
        if (String(booking.status || "").toLowerCase() !== "pending") {
          throw new ApiAuthError(409, "Only pending bookings can expire automatically.")
        }
        if (!isPaymentWindowExpired(asIso(booking.createdAt))) {
          throw new ApiAuthError(409, "This booking payment window has not expired.")
        }
        const bookingCode = String(booking.bookingCode || "").trim()
        const records = await readPaymentRecords(transaction, firestore, bookingId, bookingCode)
        const matchingRecords = [
          ...getRecordsForBooking(records, bookingId),
          ...getRecordsForBooking(records, bookingCode),
        ].filter((record, index, all) => all.findIndex((candidate) => candidate.id === record.id) === index)
        const summary = calculatePaymentSummary(booking, matchingRecords)
        if (summary.hasPendingSubmission || summary.moneyReceivedTotal > 0 || matchingRecords.some(isVerifiedPaymentRecord)) {
          throw new ApiAuthError(409, "This booking has payment activity and cannot expire automatically.")
        }

        const fields = {
          status: "cancelled",
          bookingStatus: "Cancelled",
          paymentStatus: "cancelled",
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(booking, "AUTO_EXPIRE_BOOKING", "Booking was automatically cancelled after the 24-hour payment window expired.", now),
        }
        transaction.update(bookingRef, fields)
        return { changed: true, booking: { ...booking, ...fields }, userId: String(booking.userId || "") }
      }

      if (action === "complete") {
        const bookingCode = String(booking.bookingCode || "").trim()
        const records = await readPaymentRecords(transaction, firestore, bookingId, bookingCode)
        const matchingRecords = [
          ...getRecordsForBooking(records, bookingId),
          ...getRecordsForBooking(records, bookingCode),
        ].filter((record, index, all) => all.findIndex((candidate) => candidate.id === record.id) === index)
        const summary = calculatePaymentSummary(booking, matchingRecords)
        if (summary.remainingBalance > 0) {
          throw new ApiAuthError(409, "This booking still has an unpaid remaining balance.")
        }
        const fields = {
          status: "completed",
          bookingStatus: "Completed",
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(booking, "MARK_BOOKING_COMPLETED", "Admin marked the booking as completed.", now),
        }
        transaction.update(bookingRef, fields)
        return { changed: true, booking: { ...booking, ...fields }, userId: String(booking.userId || "") }
      }

      if (action === "status") {
        const bookingCode = String(booking.bookingCode || "").trim()
        const records = await readPaymentRecords(transaction, firestore, bookingId, bookingCode)
        const matchingRecords = [
          ...getRecordsForBooking(records, bookingId),
          ...getRecordsForBooking(records, bookingCode),
        ].filter((record, index, all) => all.findIndex((candidate) => candidate.id === record.id) === index)
        const summary = calculatePaymentSummary(booking, matchingRecords)
        const secured = isOfficeBooking(booking) ? summary.fullyPaid : summary.downpaymentComplete
        if (!secured) throw new ApiAuthError(409, "The booking has not received enough verified payment to secure the slot.")
        const fields = {
          status: requestedStatus,
          bookingStatus: displayBookingStatus(requestedStatus, booking),
          isSlotSecured: true,
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(booking, "UPDATE_BOOKING_STATUS", `Admin updated the booking status to ${requestedStatus}.`, now),
        }
        transaction.update(bookingRef, fields)
        return { changed: true, booking: { ...booking, ...fields }, userId: String(booking.userId || "") }
      }

      if (action === "contract_signed") {
        const status = isOfficeBooking(booking) ? "active_rental" : String(booking.status || "confirmed")
        const fields = {
          contractSigningRequired: true,
          contractSigned: true,
          contractSignedAt: now,
          contractSignedDate: now,
          contractSignedBy: signedBy,
          contractSigningMethod: "Face-to-face",
          contractStatus: "Signed",
          status,
          bookingStatus: displayBookingStatus(status, booking),
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(booking, "MARK_CONTRACT_SIGNED", isOfficeBooking(booking)
            ? `Admin marked office rental contract as signed. Rental is now active. Signed by: ${signedBy}.`
            : `Admin marked contract as signed at One Estela Place office. Signed by: ${signedBy}. Method: Face-to-face.`, now),
        }
        transaction.update(bookingRef, fields)
        return { changed: true, booking: { ...booking, ...fields }, userId: String(booking.userId || "") }
      }

      const fields = {
        balanceReminderSent: true,
        balanceReminderSentAt: now,
        balanceReminderSentBy: signedBy,
        lastActivityAt: now,
        updatedAt: now,
        adminLogs: appendLog(booking, "BALANCE_REMINDER_SENT", "Admin sent a remaining balance reminder.", now),
      }
      transaction.update(bookingRef, fields)
      return { changed: true, booking: { ...booking, ...fields }, userId: String(booking.userId || "") }
    })

    if (result.changed && result.userId && (action === "balance_reminder" || action === "contract_signed")) {
      try {
        const isReminder = action === "balance_reminder"
        await firestore.collection("notifications").add({
          type: isReminder ? "balance_reminder" : "booking_approved",
          title: isReminder ? "Remaining Balance Reminder" : "Contract Signed",
          message: isReminder
            ? `Please settle the remaining balance for Booking ${bookingId}.`
            : `Your contract for Booking ${bookingId} has been signed.`,
          bookingId,
          userId: result.userId,
          isRead: false,
          moduleRead: false,
          createdAt: new Date(),
          link: isReminder
            ? `/portal/payments?highlight=${bookingId}`
            : `/portal/bookings?highlight=${bookingId}`,
        })
      } catch (error) {
        console.error("[POST /api/bookings/lifecycle] Notification write failed:", error)
      }
    }

    return NextResponse.json({ booking: result.booking, receipt: result.receipt, changed: result.changed })
  } catch (error: unknown) {
    return errorResponse(error)
  }
}
