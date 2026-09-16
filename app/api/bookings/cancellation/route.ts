import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
  requireBackofficeUser,
} from "@/lib/server-auth"
import {
  buildCancellationApprovalFields,
  buildCancellationDeclineFields,
  buildCancellationRequestFields,
  bookingBelongsToUser,
  evaluateCancellationEligibility,
  hasPendingCancellation,
  type CancellationRecord,
} from "@/src/modules/shared/lib/cancellation"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

const BOOKING_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MAX_BODY_BYTES = 32 * 1024

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null
}

function readString(
  body: DataRecord,
  key: string,
  maxLength: number,
  required = false,
): string {
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

async function parseBody(request: NextRequest): Promise<DataRecord> {
  const contentLength = Number(request.headers.get("content-length") || 0)
  if (contentLength > MAX_BODY_BYTES) {
    throw new ApiAuthError(413, "The cancellation request is too large.")
  }

  const bodyText = await request.text()
  if (new TextEncoder().encode(bodyText).byteLength > MAX_BODY_BYTES) {
    throw new ApiAuthError(413, "The cancellation request is too large.")
  }

  let body: unknown
  try {
    body = JSON.parse(bodyText)
  } catch {
    throw new ApiAuthError(400, "Invalid JSON in cancellation request.")
  }
  if (!isRecord(body)) throw new ApiAuthError(400, "Invalid cancellation request.")
  return body
}

function getBookingResponse(
  booking: CancellationRecord,
  bookingId: string,
): CancellationRecord & { id: string } {
  return { ...booking, id: bookingId }
}

async function notifyCancellation(
  type: "cancellation_requested" | "cancellation_approved" | "cancellation_declined",
  bookingId: string,
  booking: CancellationRecord,
  message: string,
) {
  const userId = String(booking.userId || booking.uid || "")
  const userInfo = isRecord(booking.userInfo) ? booking.userInfo : {}

  try {
    const firestore = getAdminFirestore()
    await firestore.collection("notifications").add({
      type,
      title:
        type === "cancellation_requested"
          ? "Cancellation Requested"
          : type === "cancellation_approved"
            ? "Cancellation Approved"
            : "Cancellation Declined",
      message,
      bookingId,
      userId: type === "cancellation_requested" ? "admin" : userId,
      ...(type === "cancellation_requested"
        ? {
            relatedUserId: userId,
            relatedUserName: String(userInfo.name || booking.eventName || "A client"),
          }
        : {}),
      isRead: false,
      moduleRead: false,
      createdAt: new Date(),
      link:
        type === "cancellation_requested"
          ? `/dashboard/bookings?highlight=${bookingId}`
          : `/portal/bookings?highlight=${bookingId}`,
    })
  } catch (error: unknown) {
    console.error(
      `[cancellation notification] ${type} failed:`,
      error instanceof Error ? error.message : "Unknown error",
    )
  }
}

function errorResponse(error: unknown, label: string) {
  if (isApiAuthError(error)) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error(`[${label}]`, error instanceof Error ? error.message : "Unknown error")
  return NextResponse.json(
    { error: "Unable to update the cancellation request. Please try again." },
    { status: 500 },
  )
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    if (user.role !== "client") {
      throw new ApiAuthError(403, "Only client accounts can request cancellation.")
    }

    const body = await parseBody(request)
    const bookingId = readString(body, "bookingId", 128, true)
    if (!BOOKING_ID_PATTERN.test(bookingId)) throw new ApiAuthError(400, "Invalid booking ID.")
    const reason = readString(body, "reason", 2000, true)
    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)

    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(bookingRef)
      if (!snapshot.exists) throw new ApiAuthError(404, "Booking not found.")

      const booking = snapshot.data() as CancellationRecord
      if (!bookingBelongsToUser(booking, user.uid)) {
        throw new ApiAuthError(403, "You do not have access to this booking.")
      }

      if (hasPendingCancellation(booking)) {
        return {
          changed: false,
          booking: getBookingResponse(booking, bookingId),
        }
      }

      const eligibility = evaluateCancellationEligibility(booking)
      if (!eligibility.allowed) {
        throw new ApiAuthError(409, eligibility.reason || "This booking cannot be cancelled.")
      }

      const requestedAt = new Date().toISOString()
      const fields = buildCancellationRequestFields(booking, reason, requestedAt)
      transaction.update(bookingRef, fields as any)
      return {
        changed: true,
        booking: getBookingResponse({ ...booking, ...fields }, bookingId),
      }
    })

    if (result.changed) {
      await notifyCancellation(
        "cancellation_requested",
        bookingId,
        result.booking,
        `A cancellation has been requested for ${String(result.booking.venue || result.booking.eventName || "a booking")}.`,
      )
    }

    return NextResponse.json(
      { booking: result.booking, alreadyRequested: !result.changed },
      { status: result.changed ? 201 : 200 },
    )
  } catch (error: unknown) {
    return errorResponse(error, "POST /api/bookings/cancellation")
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireBackofficeUser(request, { permission: "bookings" })
    const body = await parseBody(request)
    const bookingId = readString(body, "bookingId", 128, true)
    if (!BOOKING_ID_PATTERN.test(bookingId)) throw new ApiAuthError(400, "Invalid booking ID.")

    const action = readString(body, "action", 20, true).toLowerCase()
    if (action !== "approve" && action !== "decline") {
      throw new ApiAuthError(400, "Invalid cancellation action.")
    }
    const reason = readString(body, "reason", 2000, action === "decline")
    const reviewedAt = new Date().toISOString()
    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)

    const result = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(bookingRef)
      if (!snapshot.exists) throw new ApiAuthError(404, "Booking not found.")

      const booking = snapshot.data() as CancellationRecord
      if (!hasPendingCancellation(booking)) {
        throw new ApiAuthError(409, "This booking has no pending cancellation request.")
      }

      const fields = action === "approve"
        ? buildCancellationApprovalFields(booking, reviewedAt)
        : buildCancellationDeclineFields(booking, reason, reviewedAt)
      transaction.update(bookingRef, fields as any)
      return {
        booking: getBookingResponse({ ...booking, ...fields }, bookingId),
      }
    })

    await notifyCancellation(
      action === "approve" ? "cancellation_approved" : "cancellation_declined",
      bookingId,
      result.booking,
      action === "approve"
        ? `Your cancellation request for Booking ${bookingId} has been approved.`
        : `Your cancellation request for Booking ${bookingId} has been declined.`,
    )

    return NextResponse.json({ booking: result.booking, reviewedBy: user.uid })
  } catch (error: unknown) {
    return errorResponse(error, "PATCH /api/bookings/cancellation")
  }
}
