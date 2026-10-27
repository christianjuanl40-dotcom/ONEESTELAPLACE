import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
  requireBackofficeUser,
} from "@/lib/server-auth"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

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

function appendLog(booking: DataRecord, action: string, message: string, createdAt: string) {
  const existing = Array.isArray(booking.adminLogs)
    ? booking.adminLogs.filter(isRecord).slice(-49)
    : []
  return [...existing, { action, message, createdAt }]
}

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(
    "[POST /api/bookings/refund]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to update the refund. Please try again." }, { status: 500 })
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 32 * 1024) {
      throw new ApiAuthError(413, "The refund request is too large.")
    }

    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in refund request.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid refund request.")

    const bookingId = readString(body, "bookingId", 128, true)
    if (!BOOKING_ID_PATTERN.test(bookingId)) throw new ApiAuthError(400, "Invalid booking ID.")
    const action = readString(body, "action", 20, true).toLowerCase()
    if (action !== "request" && action !== "complete") {
      throw new ApiAuthError(400, "Invalid refund action.")
    }

    if (action === "complete" && user.role !== "admin" && user.role !== "staff") {
      throw new ApiAuthError(403, "Only backoffice users can complete refunds.")
    }
    if (action === "complete") {
      await requireBackofficeUser(request, { permission: "bookings" })
    }

    const firestore = getAdminFirestore()
    const bookingRef = firestore.collection("bookings").doc(bookingId)
    const now = new Date().toISOString()
    const result = await firestore.runTransaction(async (transaction): Promise<{
      changed: boolean
      booking: DataRecord & { id: string }
    }> => {
      const snapshot = await transaction.get(bookingRef)
      if (!snapshot.exists) throw new ApiAuthError(404, "Booking not found.")
      const booking: DataRecord = snapshot.data() as DataRecord

      if (action === "request" && String(booking.userId || booking.uid || "") !== user.uid) {
        throw new ApiAuthError(403, "You do not have access to this booking.")
      }

      const refundStatus = String(booking.refundStatus || "").trim().toLowerCase()
      if (action === "request") {
        if (refundStatus === "requested" || refundStatus === "refunded") {
          return { changed: false, booking: { ...booking, id: bookingId } }
        }
        if (refundStatus !== "eligible") {
          throw new ApiAuthError(409, "This booking is not eligible for a refund.")
        }
        const fields: DataRecord = {
          refundStatus: "requested",
          refundRequestedAt: now,
          refundRequestedBy: user.uid,
          lastActivityAt: now,
          updatedAt: now,
          adminLogs: appendLog(
            booking,
            "REFUND_REQUESTED",
            "Customer requested refund. Please visit the office with valid ID and payment receipt within 7 days.",
            now,
          ),
        }
        transaction.update(bookingRef, fields as any)
        return { changed: true, booking: { ...booking, ...fields, id: bookingId } }
      }

      if (refundStatus === "refunded") {
        return { changed: false, booking: { ...booking, id: bookingId } }
      }
      if (refundStatus !== "requested") {
        throw new ApiAuthError(409, "This booking has no pending refund request.")
      }
      const fields: DataRecord = {
        refundStatus: "refunded",
        refundedAt: now,
        refundedBy: user.uid,
        refundProcessedBy: user.fullName || "Administrator",
        lastActivityAt: now,
        updatedAt: now,
        adminLogs: appendLog(
          booking,
          "REFUND_COMPLETED",
          "Admin marked refund as completed. Cash refund has been claimed by the customer.",
          now,
        ),
      }
      transaction.update(bookingRef, fields as any)
      return { changed: true, booking: { ...booking, ...fields, id: bookingId } }
    })

    try {
      const userId = String(result.booking.userId || result.booking.uid || "")
      if (userId) {
        await firestore.collection("notifications").add({
          type: action === "request" ? "refund_requested" : "refund_completed",
          title: action === "request" ? "Refund Requested" : "Refund Completed",
          message: action === "request"
            ? "Your refund request has been recorded. Please visit the One Estela Place Management Office with your official receipt and valid ID."
            : `Your refund for Booking ${bookingId} has been completed.`,
          bookingId,
          userId: action === "request" ? "admin" : userId,
          ...(action === "request" ? { relatedUserId: userId } : {}),
          isRead: false,
          moduleRead: false,
          createdAt: new Date(),
          link: action === "request"
            ? `/dashboard/bookings?highlight=${bookingId}`
            : `/portal/bookings?highlight=${bookingId}`,
        })
      }
    } catch (error) {
      console.error(
        "[POST /api/bookings/refund] Notification write failed:",
        error instanceof Error ? error.message : "Unknown error",
      )
    }

    return NextResponse.json(
      { booking: result.booking, alreadyProcessed: !result.changed },
      { status: result.changed ? 201 : 200 },
    )
  } catch (error: unknown) {
    return errorResponse(error)
  }
}
