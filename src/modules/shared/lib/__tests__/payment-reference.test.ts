import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { validatePaymentReference } from "../payment-reference"
import { TransactionStore } from "./helpers/transaction-store"

const boundary = vi.hoisted(() => ({ firestore: null as unknown }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/firebase-admin", () => ({ getAdminFirestore: () => boundary.firestore }))
vi.mock("@/lib/server-auth", () => {
  class ApiAuthError extends Error {
    constructor(readonly status: number, message: string) { super(message) }
  }
  return {
    ApiAuthError,
    isApiAuthError: (error: unknown) => error instanceof ApiAuthError,
    requireAuthenticatedUser: async () => ({ uid: "CLIENT", role: "client", fullName: "Fixture Client" }),
  }
})

import { POST as submit } from "@/app/api/payments/submit/route"

const required = "Reference number is required."
const invalid = "Enter a valid reference number."
const cases: Array<[unknown, string | null]> = [
  [undefined, required], [null, required], ["", required], [" \t\n ", required],
  ["1", invalid], ["12", invalid], ["123", invalid], ["1234", invalid],
  ["12345", null], ["00001", null], ["  00001\t\n", null],
  ["123456789012", null], ["1234567890123", null], ["12345678901234", null],
  ["0".repeat(33), null], ["0".repeat(121), null], ["1234567890".repeat(100), null],
  ["abcde", invalid], ["12345abc", invalid], ["abc1234567890123", invalid],
  ["12345-67890123", invalid], ["12345.67890123", invalid], ["+12345", invalid],
  ["12 345", invalid], ["12345\t67890", invalid], ["12345\n67890", invalid],
  ["１２３４５", invalid], [12345, invalid], [false, invalid], [{ value: "12345" }, invalid],
]

const proof = "data:image/png;base64,AAAA"
const request = (reference: unknown, method: "bank" | "cash" = "bank", paymentProof = proof) => new NextRequest(
  "http://localhost/api/payments/submit",
  { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    bookingId: "BOOKING", type: "downpayment", method, amount: 5000,
    bankReferenceNumber: reference, proof: paymentProof,
  }) },
)

let store: TransactionStore
beforeEach(() => {
  store = new TransactionStore()
  boundary.firestore = store
  store.seed("bookings/BOOKING", {
    userId: "CLIENT", eventName: "Reference validation", venue: "Event Venue",
    totalPrice: 10000, paymentType: "downpayment", selectedDownpaymentAmount: 5000,
    downPaymentPercentage: 50, status: "pending", bookingStatus: "Pending", paymentStatus: "unpaid",
    isSlotSecured: false, amountPaid: 0, date: "2099-01-01",
  })
})

describe("bank reference validation shared by the client and server", () => {
  it.each(cases)("handles %j consistently without coercing or stripping characters", async (reference, error) => {
    const client = validatePaymentReference(reference, "bank")
    expect(client.error).toBe(error)
    const before = structuredClone(store.data)
    const response = await submit(request(reference))
    expect(response.status).toBe(error ? 400 : 201)
    const result = await response.json()

    if (error) {
      expect(result.error).toBe(error)
      expect(store.data).toEqual(before)
    } else {
      const expected = (reference as string).trim()
      expect(client.value).toBe(expected)
      expect(result.payment.referenceNo).toBe(expected)
      expect(result.booking.bankReferenceNumber).toBe(expected)
      expect(result.booking.paymentReference).toBe(expected)
      expect(store.data.get(`payments/${result.payment.id}`)?.referenceNo).toBe(expected)
      // Valid input creates a pending submission, never a verified payment or secured booking.
      expect(result.payment.status).toBe("For Verification")
      expect(result.payment.verificationStatus).toBe("Pending")
      expect(result.booking.status).toBe("pending")
      expect(result.booking.isSlotSecured).toBe(false)
      expect(result.booking.verifiedByAdmin).toBe(false)
      expect(result.booking.amountPaid).toBe(0)
      expect(result.booking.remainingBalance).toBe(10000)
      expect(result.payment.reviewSnapshot).toBeUndefined()
    }
  })

  it("still requires bank proof and rejects duplicate submissions", async () => {
    expect((await submit(request("00001", "bank", ""))).status).toBe(400)
    expect((await submit(request("00001"))).status).toBe(201)
    const before = structuredClone(store.data)
    expect((await submit(request("00002"))).status).toBe(409)
    expect(store.data).toEqual(before)
  })
})

describe("cash reference applicability", () => {
  it.each([undefined, null, "", "   ", "1234", "not-a-bank-reference"])(
    "does not require or store a bank reference (%j) or bank proof", async (reference) => {
      expect(validatePaymentReference(reference, "cash")).toEqual({ value: "", error: null })
      const response = await submit(request(reference, "cash", ""))
      expect(response.status).toBe(201)
      const result = await response.json()
      expect(result.payment.referenceNo).toBe("")
      expect(result.payment.proofUrl).toBe("")
      expect(result.booking.bankReferenceNumber).toBe("")
      expect(result.payment.status).toBe("Awaiting Onsite Payment")
      expect(result.booking.isSlotSecured).toBe(false)
    },
  )
})
