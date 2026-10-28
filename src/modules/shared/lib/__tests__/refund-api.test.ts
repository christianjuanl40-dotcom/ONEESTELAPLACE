import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { TransactionStore } from "./helpers/transaction-store"

const boundary = vi.hoisted(() => ({ firestore: null as unknown }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/firebase-admin", () => ({ getAdminFirestore: () => boundary.firestore }))
vi.mock("@/lib/server-auth", () => {
  class ApiAuthError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  }
  const authenticate = async (request: Request) => ({
    uid: request.headers.get("x-uid") || "CLIENT",
    role: request.headers.get("x-role") || "client",
    fullName: "Fixture User",
    permissions: { bookings: true },
  })
  const backoffice = async (request: Request) => {
    const user = await authenticate(request)
    if (user.role !== "admin" && user.role !== "staff") throw new ApiAuthError(403, "Backoffice required.")
    return user
  }
  return {
    ApiAuthError,
    isApiAuthError: (error: unknown) => error instanceof ApiAuthError,
    requireAuthenticatedUser: authenticate,
    requireBackofficeUser: backoffice,
  }
})

import { POST as cancellation, PATCH as reviewCancellation } from "@/app/api/bookings/cancellation/route"
import { POST as refund } from "@/app/api/bookings/refund/route"

const post = (body: object, role = "client") => new NextRequest("http://localhost/api/fixture", {
  method: "POST",
  headers: { "content-type": "application/json", "x-role": role },
  body: JSON.stringify(body),
})

let store: TransactionStore

beforeEach(() => {
  store = new TransactionStore()
  boundary.firestore = store
  store.seed("bookings/BOOKING", {
    userId: "CLIENT",
    bookingCode: "BK-REFUND",
    status: "confirmed",
    bookingStatus: "Confirmed",
    paymentStatus: "partial",
    isSlotSecured: true,
    totalPrice: 10000,
    paymentType: "downpayment",
    selectedDownpaymentAmount: 5000,
    amountPaid: 2500,
    date: "2099-12-01",
    adminLogs: [],
  })
  store.seed("payments/PAYMENT", {
    bookingId: "BOOKING",
    bookingCode: "BK-REFUND",
    status: "Verified",
    verificationStatus: "Verified",
    amount: 2500,
    term: "Down Payment",
  })
})

describe("ledger-backed refund workflow", () => {
  it("uses received ledger money for approval, request, and completion", async () => {
    expect((await cancellation(post({ bookingId: "BOOKING", reason: "Schedule changed" }))).status).toBe(201)

    const approvedResponse = await reviewCancellation(post({ bookingId: "BOOKING", action: "approve" }, "admin"))
    expect(approvedResponse.status).toBe(200)
    expect(store.data.get("bookings/BOOKING")).toMatchObject({ refundStatus: "eligible", refundAmount: 2500 })

    const requestedResponse = await refund(post({ bookingId: "BOOKING", action: "request" }))
    expect(requestedResponse.status).toBe(201)
    expect(store.data.get("bookings/BOOKING")).toMatchObject({ refundStatus: "requested", refundAmount: 2500 })

    const completedResponse = await refund(post({ bookingId: "BOOKING", action: "complete" }, "staff"))
    expect(completedResponse.status).toBe(201)
    expect(store.data.get("bookings/BOOKING")).toMatchObject({
      refundStatus: "refunded",
      refundAmount: 2500,
      refundedAmount: 2500,
    })
  })

  it("rejects a refund amount that exceeds the payment ledger", async () => {
    store.seed("bookings/BOOKING", {
      ...store.data.get("bookings/BOOKING"),
      refundStatus: "requested",
      refundAmount: 10000,
    })
    const before = structuredClone(store.data)
    const response = await refund(post({ bookingId: "BOOKING", action: "complete" }, "admin"))

    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/ledger/i)
    expect(store.data).toEqual(before)
  })
})
