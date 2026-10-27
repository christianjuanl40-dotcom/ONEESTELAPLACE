import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { TransactionStore } from "./helpers/transaction-store"
import { buildFinalizedPaymentSnapshot, getPaymentRecordCreditedAmount } from "../payment-calculations"
import { createPaymentReviewClient } from "../payment-review-client"
import { Firestore, type DocumentData, type UpdateData } from "firebase-admin/firestore"

const boundary = vi.hoisted(() => ({ firestore: null as unknown, verifyIdToken: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/firebase-admin", () => ({
  getAdminFirestore: () => boundary.firestore,
  getAdminAuth: () => ({ verifyIdToken: boundary.verifyIdToken }),
}))

// Exercise the real authorization, handler, transitions, and response serialization.
import { GET as savedReview, POST as review } from "@/app/api/payments/review/route"

let store: TransactionStore
const bookingId = "booking-document-86"
const request = (extra = {}, token: string | null = "admin") => new NextRequest("http://localhost/api/payments/review", {
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ action: "verify", bookingId, paymentRecordId: "payment-document-3", verifiedAmount: 2500, ...extra }),
})
const savedPayment = (number: number) => store.data.get(`payments/payment-document-${number}`)!
const savedBooking = () => store.data.get(`bookings/${bookingId}`)!
const receipts = () => [...store.data.entries()].filter(([path]) => path.startsWith("receipts/"))

beforeEach(() => {
  store = new TransactionStore()
  boundary.firestore = store
  boundary.verifyIdToken.mockReset().mockImplementation(async (token: string) => {
    if (token === "invalid") throw Object.assign(new Error("Revoked fixture token"), { code: "auth/id-token-revoked" })
    return { uid: token, auth_time: 100 }
  })
  for (const [id, profile] of Object.entries({
    admin: { role: "admin" }, reviewer: { role: "staff", permissions: { payments: true } },
    bookingStaff: { role: "staff", permissions: { bookings: true } }, client: { role: "client" },
    inactive: { role: "admin", status: "inactive" },
  })) store.seed(`users/${id}`, { status: "active", fullName: "Fixture Reviewer", ...profile })
  store.seed(`bookings/${bookingId}`, {
    bookingCode: "BK86", eventName: "Dark Rose Celebration", userId: "client", bookingCategory: "venue",
    status: "pending", bookingStatus: "Pending", paymentStatus: "for_review",
    totalPrice: 10000, paymentType: "downpayment", selectedDownpaymentAmount: 5000,
    paymentRejectedReason: "Submission 2 rejected", createdAt: "2026-10-01T10:00:00Z",
  })
  for (let number = 1; number <= 3; number++) store.seed(`payments/payment-document-${number}`, {
    bookingId, bookingCode: "BK86", customerId: "client", paymentNumber: number, amount: 2500,
    paymentMethod: "bank", term: "Down Payment", submittedAt: `2026-10-0${number}T10:00:00Z`,
    status: number === 1 ? "Verified" : number === 2 ? "Rejected" : " For Review ",
    verificationStatus: number === 1 ? "Verified" : number === 2 ? "Rejected" : "Pending",
    adminNote: number === 2 ? "Submission 2 rejected" : "", receiptNumber: `ER-FIXTURE-${number}`,
  })
  const history = [1, 2, 3].map((number) => ({
    bookingId, paymentId: `payment-document-${number}`, receiptNumber: `ER-FIXTURE-${number}`,
    paymentStatus: savedPayment(number).status, remainingBalance: 7500,
    ...(number < 3 ? { reviewSnapshot: { historicalEvidence: `unchanged-${number}` } } : {}),
  }))
  history.forEach((receipt) => store.seed(`receipts/${receipt.receiptNumber}`, receipt))
  store.seed(`bookings/${bookingId}`, { ...savedBooking(), paymentReceipts: history, receipt: history[2] })
})

describe("selected payment review (real permission checks; transaction fixture)", () => {
  it("verifies submission 3 after rejection, using document IDs and preserving finalized history", async () => {
    const earlierPayments = [structuredClone(savedPayment(1)), structuredClone(savedPayment(2))]
    const earlierReceipts = receipts().slice(0, 2)
    const response = await review(request())
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.payment.id).toBe("payment-document-3")
    expect(result.booking.id).toBe(bookingId)
    expect(result.booking).toMatchObject({ amountPaid: 5000, remainingBalance: 5000, downpaymentPaid: 5000,
      status: "confirmed", bookingStatus: "Confirmed", paymentStatus: "partial", isSlotSecured: true })
    expect(result.payment.reviewSnapshot.summary.acceptedTotalPaid).toBe(5000)
    expect(getPaymentRecordCreditedAmount(savedPayment(2))).toBe(0)
    expect([savedPayment(1), savedPayment(2)]).toEqual(earlierPayments)
    expect(receipts().slice(0, 2)).toEqual(earlierReceipts)
    expect(store.data.get("receipts/ER-FIXTURE-3")).toMatchObject({ paymentId: result.payment.id,
      bookingId, paymentStatus: "Verified", reviewSnapshot: result.payment.reviewSnapshot })
    expect(result.booking.paymentReceipts.slice(0, 2)).toEqual(earlierReceipts.map(([, receipt]) => receipt))
  })

  it("fits the BK86-sized third review below Firestore's document limit without rewriting earlier snapshots", async () => {
    // Exact byte lengths observed read-only on BK86; all content is synthetic.
    const proof = (bytes: number) => "data:image/webp;base64," + "A".repeat(bytes - "data:image/webp;base64,".length)
    const sizes = [219815, 222499, 213951]
    for (let number = 1; number <= 3; number++) store.seed(`payments/payment-document-${number}`, {
      ...savedPayment(number), proofUrl: proof(sizes[number - 1]),
      ...(number === 1 ? { status: "Incomplete", verificationStatus: "Incomplete", amountReceived: 2500, requestedAmount: 5000 } : {}),
    })
    const records = [1, 2, 3].map((number) => ({ ...savedPayment(number), id: `payment-document-${number}` }))
    const history = (savedBooking().paymentReceipts as Record<string, unknown>[]).map((receipt, index) => {
      if (index === 2) return receipt
      const reviewSnapshot = buildFinalizedPaymentSnapshot({ ...savedBooking(), id: bookingId }, records.slice(0, index + 1), records[index], `2026-10-0${index + 1}T11:00:00Z`)
      store.seed(`payments/${records[index].id}`, { ...savedPayment(index + 1), reviewSnapshot })
      const finalized = { ...receipt, reviewSnapshot }
      store.seed(`receipts/${receipt.receiptNumber}`, finalized)
      return finalized
    })
    store.seed(`bookings/${bookingId}`, { ...savedBooking(), proofUrl: proof(sizes[2]), paymentReceipts: history, receipt: history[1] })
    const earlierSnapshots = history.slice(0, 2).map((receipt) => structuredClone(receipt.reviewSnapshot))
    const firstTwoPayments = [structuredClone(savedPayment(1)), structuredClone(savedPayment(2))]
    const beforeBytes = Buffer.byteLength(JSON.stringify(savedBooking()))
    expect(beforeBytes).toBeLessThan(1_048_576)
    // Proof strings alone in the original full-copy write exceeded the limit.
    expect(sizes[0] + sizes[1] + sizes[2] * 3).toBe(1_084_167)
    const seed = store.seed.bind(store)
    vi.spyOn(store, "seed").mockImplementation((path, data) => {
      if (Buffer.byteLength(JSON.stringify(data)) > 1_048_576) throw new Error("Document exceeds Firestore's 1 MiB size limit")
      seed(path, data)
    })
    const response = await review(request())
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(savedBooking()).toMatchObject({ amountPaid: 5000, downpaymentPaid: 5000, remainingBalance: 5000, isSlotSecured: true })
    expect(Buffer.byteLength(JSON.stringify(savedBooking()))).toBeLessThan(beforeBytes)
    expect((savedBooking().paymentReceipts as Record<string, unknown>[]).slice(0, 2).map((receipt) => receipt.reviewSnapshot)).toEqual(earlierSnapshots)
    expect([savedPayment(1), savedPayment(2)]).toEqual(firstTwoPayments)
    expect(result.payment.reviewSnapshot.transaction.proofUrl).toBe(proof(sizes[2]))
    expect((savedBooking().receipt as Record<string, unknown>).reviewSnapshot).toBeUndefined()
    expect((savedBooking().receipt as Record<string, unknown>).reviewSnapshotSummary).toMatchObject({
      transaction: { adminNote: "", proofUrl: "" }, summary: { acceptedTotalPaid: 5000, acceptedVerifiedTotal: 2500 },
    })
    expect(store.data.get("receipts/ER-FIXTURE-3")?.reviewSnapshot).toEqual(result.payment.reviewSnapshot)
  })

  it("never substitutes a booking code, submission label, or another booking's payment", async () => {
    const before = structuredClone(store.data)
    expect((await review(request({ bookingId: "BK86" }))).status).toBe(404)
    expect((await review(request({ paymentRecordId: "3" }))).status).toBe(404)
    expect((await review(request({ paymentRecordId: "payment-document-2" }))).status).toBe(409)
    store.seed("payments/FOREIGN", { bookingId: "other-booking", customerId: "other-client", amount: 2500, status: "For Review" })
    expect((await review(request({ paymentRecordId: "FOREIGN" }))).status).toBe(403)
    store.data.delete("payments/FOREIGN")
    expect(store.data).toEqual(before)
  })

  it("serializes concurrent requests and makes repeat verification a read-only acknowledgement", async () => {
    const responses = await Promise.all([review(request()), review(request()), review(request())])
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    const results = await Promise.all(responses.map((response) => response.json()))
    expect(results.filter((result) => !result.alreadyVerified)).toHaveLength(1)
    expect(store.retries).toBeGreaterThan(0)
    expect(savedBooking().amountPaid).toBe(5000)
    expect(receipts()).toHaveLength(3)
    expect([...store.data.keys()].filter((path) => path.startsWith("notifications/"))).toHaveLength(1)
    const before = structuredClone(store.data)
    expect((await review(request({ adminNote: "Must not rewrite history" }))).status).toBe(200)
    expect(store.data).toEqual(before)
  })

  it("reviews the explicitly selected older submission, leaving a newer pending submission pending", async () => {
    store.seed("payments/payment-document-1", { ...savedPayment(1), status: "For Review", verificationStatus: "Pending" })
    const history = savedBooking().paymentReceipts as Record<string, unknown>[]
    const pendingReceipt = { ...history[0], reviewSnapshot: undefined, paymentStatus: "For Review" }
    delete pendingReceipt.reviewSnapshot
    store.seed("receipts/ER-FIXTURE-1", pendingReceipt)
    store.seed(`bookings/${bookingId}`, { ...savedBooking(), paymentReceipts: [pendingReceipt, ...history.slice(1)] })
    const response = await review(request({ paymentRecordId: "payment-document-1" }))
    expect(response.status).toBe(200)
    expect(savedPayment(1).status).toBe("Verified")
    expect(savedPayment(3).status).toBe(" For Review ")
    expect(savedBooking()).toMatchObject({ amountPaid: 2500, remainingBalance: 7500, hasActivePaymentSubmission: true })
  })

  it("does not overwrite another submission's receipt when a legacy receipt-number link is shared", async () => {
    const previousReceipt = structuredClone(store.data.get("receipts/ER-FIXTURE-2"))
    const previousPayment = structuredClone(savedPayment(2))
    store.seed("payments/payment-document-3", { ...savedPayment(3), receiptNumber: "ER-FIXTURE-2" })
    const response = await review(request())
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.payment.receiptNumber).toBe("ER-FIXTURE-3")
    expect(store.data.get("receipts/ER-FIXTURE-2")).toEqual(previousReceipt)
    expect(savedPayment(2)).toEqual(previousPayment)
    expect(receipts()).toHaveLength(3)
  })

  it("retains a previously secured booking even when a later review has an incomplete historical ledger", async () => {
    store.seed(`bookings/${bookingId}`, { ...savedBooking(), status: "confirmed", bookingStatus: "Confirmed", isSlotSecured: true })
    store.data.delete("payments/payment-document-1")
    expect((await review(request())).status).toBe(200)
    expect(savedBooking()).toMatchObject({ status: "confirmed", bookingStatus: "Confirmed", isSlotSecured: true,
      amountPaid: 2500, remainingBalance: 7500 })
  })

  it("does not turn a notification failure after commit into a failed review", async () => {
    const original = store.collection.bind(store)
    vi.spyOn(store, "collection").mockImplementation((path) => {
      const collection = original(path)
      if (path === "notifications") collection.add = async () => { throw new Error("Notification unavailable") }
      return collection
    })
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect((await review(request())).status).toBe(200)
      expect(savedPayment(3).status).toBe("Verified")
      expect(savedBooking().amountPaid).toBe(5000)
    } finally { log.mockRestore() }
  })

  it("commits two different selected submissions once each under concurrent review", async () => {
    store.seed("payments/payment-document-1", { ...savedPayment(1), status: "For Review", verificationStatus: "Pending" })
    const firstReceipt = { ...store.data.get("receipts/ER-FIXTURE-1"), reviewSnapshot: null }
    store.seed("receipts/ER-FIXTURE-1", firstReceipt)
    const history = savedBooking().paymentReceipts as object[]
    store.seed(`bookings/${bookingId}`, { ...savedBooking(), paymentReceipts: [firstReceipt, ...history.slice(1)] })
    const responses = await Promise.all([review(request({ paymentRecordId: "payment-document-1" })), review(request())])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(savedBooking()).toMatchObject({ amountPaid: 5000, remainingBalance: 5000, downpaymentPaid: 5000 })
    expect(savedPayment(2).status).toBe("Rejected")
    expect(receipts()).toHaveLength(3)
    expect(store.retries).toBeGreaterThan(0)
  })

  it("creates a missing selected receipt once, keeping the payment's receipt identity", async () => {
    store.data.delete("receipts/ER-FIXTURE-3")
    const responses = await Promise.all([review(request()), review(request())])
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    expect(savedPayment(3).receiptNumber).toBe("ER-FIXTURE-3")
    expect(store.data.get("receipts/ER-FIXTURE-3")).toMatchObject({ paymentId: "payment-document-3", paymentStatus: "Verified" })
    expect(receipts()).toHaveLength(3)
  })

  it("supports code-only legacy joins without treating the code as the booking document ID", async () => {
    store.seed("payments/payment-document-1", { ...savedPayment(1), bookingId: "", bookingCode: "BK86" })
    store.seed("payments/payment-document-3", { ...savedPayment(3), bookingId: "BK86", bookingCode: "" })
    expect((await review(request())).status).toBe(200)
    expect(savedBooking().amountPaid).toBe(5000)
    expect(savedPayment(3).reviewSnapshot).toMatchObject({ bookingId, paymentId: "payment-document-3" })
  })

  it("rolls back all queued writes on a receipt failure and returns a safe correlated error", async () => {
    store.data.delete("receipts/ER-FIXTURE-3")
    const before = structuredClone(store.data)
    const run = store.runTransaction.bind(store)
    store.runTransaction = (callback) => run((transaction) => callback({ ...transaction,
      create: () => { throw new Error("Private SDK diagnostic must stay on the server") },
    }))
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const response = await review(request())
      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toMatch(/check.*saved status/i)
      expect(body.error).not.toContain("Private SDK")
      expect(body.requestId).toBe(response.headers.get("x-request-id"))
      expect(log).toHaveBeenCalledWith(expect.any(String), { requestId: body.requestId }, expect.stringContaining("Private SDK"))
      expect(store.data).toEqual(before)
    } finally { log.mockRestore() }
  })

  it.each([[null, 401], ["invalid", 401], ["missing", 403], ["client", 403], ["bookingStaff", 403], ["inactive", 403]] as const)(
    "rejects unauthorized reviewer %s", async (token, status) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {})
      try {
        const before = structuredClone(store.data)
        expect((await review(request({}, token))).status).toBe(status)
        expect(store.data).toEqual(before)
      } finally { log.mockRestore() }
    },
  )

  it("permits payment-review staff and retains revocation checks", async () => {
    expect((await review(request({}, "reviewer"))).status).toBe(200)
    expect(boundary.verifyIdToken).toHaveBeenCalledWith("reviewer", true)
  })

  it.each([0, -1, "not money", true, {}, 10_000_001, 2500.02])("rejects invalid/excessive verified amount %j without writing", async (verifiedAmount) => {
    const before = structuredClone(store.data)
    expect((await review(request({ verifiedAmount }))).status).toBe(400)
    expect(store.data).toEqual(before)
  })

  it("never falls back to a booking amount when the selected submission has no amount", async () => {
    store.seed("payments/payment-document-3", { ...savedPayment(3), amount: 0 })
    store.seed(`bookings/${bookingId}`, { ...savedBooking(), paymentAmount: 2500 })
    const before = structuredClone(store.data)
    const response = await review(request())
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/selected payment.*amount/i)
    expect(store.data).toEqual(before)
  })

  it("reads the selected saved state with no writes or cache, enforcing the same permissions", async () => {
    const lookup = (token = "admin") => savedReview(new NextRequest(`http://localhost/api/payments/review?bookingId=${bookingId}&paymentRecordId=payment-document-3`, {
      headers: { authorization: `Bearer ${token}` },
    }))
    const before = structuredClone(store.data)
    const response = await lookup()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("x-request-id")).toBeTruthy()
    expect((await response.json()).payment.id).toBe("payment-document-3")
    expect((await lookup("bookingStaff")).status).toBe(403)
    expect(store.data).toEqual(before)
  })

  it("validates every queued write with the real Firestore SDK without making a connection", async () => {
    // batch.update/create validate data synchronously. Never commit this batch,
    // initialize an application credential, or load a live environment.
    const serializer = new Firestore({ projectId: "demo-one-estela-payment-serialization" })
    const run = store.runTransaction.bind(store)
    let writes = 0
    store.runTransaction = (callback) => run(async (transaction) => {
      const batch = serializer.batch()
      const checked = { ...transaction,
        update: (ref: { path: string }, data: Record<string, unknown>) => {
          batch.update(serializer.doc(ref.path), data as UpdateData<DocumentData>)
          writes++
          transaction.update(ref, data)
        },
        create: (ref: { path: string }, data: Record<string, unknown>) => {
          batch.create(serializer.doc(ref.path), data)
          writes++
          transaction.create(ref, data)
        },
      }
      return callback(checked)
    })
    try {
      const response = await review(request())
      expect(response.status).toBe(200)
      expect(writes).toBe(3)
      expect(savedBooking().amountPaid).toBe(5000)
    } finally { await serializer.terminate() }
  })
})

describe("review response recovery through the real API handlers", () => {
  function client(failure: "lost" | "json" | "server" | "before-commit" | "unavailable") {
    const calls: string[] = []
    let first = true
    const reviewer = createPaymentReviewClient({
      getAuthHeaders: async () => ({ "content-type": "application/json", authorization: "Bearer admin" }),
      fetch: async (input, options) => {
        calls.push(options?.method || "GET")
        if (options?.method === "GET") {
          if (failure === "unavailable") throw new Error("Offline")
          return savedReview(new NextRequest(new Request(new URL(String(input), "http://localhost"), options)))
        }
        if (first && (failure === "before-commit" || failure === "unavailable")) { first = false; throw new Error("Disconnected") }
        const response = await review(new NextRequest(new Request(new URL(String(input), "http://localhost"), options)))
        if (first) {
          first = false
          if (failure === "lost") throw new Error("Connection lost after commit")
          if (failure === "json") return new Response("truncated", { status: 200 })
          if (failure === "server") return new Response(JSON.stringify({ error: "Response unavailable" }), { status: 500 })
        }
        return response
      },
    })
    return { calls, reviewer, input: { action: "verify" as const, bookingId, paymentRecordId: "payment-document-3", verifiedAmount: 2500 } }
  }

  it.each(["lost", "json", "server"] as const)("acknowledges the saved review after a %s response without repeating the POST", async (failure) => {
    const { calls, reviewer, input } = client(failure)
    const result = await reviewer.review(input)
    expect(result.payment.status).toBe("Verified")
    expect(calls).toEqual(["POST", "GET"])
    expect(savedBooking().amountPaid).toBe(5000)
    expect(receipts()).toHaveLength(3)
  })

  it("checks authoritative state again before retrying an uncertain request", async () => {
    const { calls, reviewer, input } = client("before-commit")
    await expect(reviewer.review(input)).rejects.toThrow(/still awaiting review/)
    expect(calls).toEqual(["POST", "GET"])
    // Model a slow first server request committing after that initial status check.
    expect((await review(request())).status).toBe(200)
    const before = structuredClone(store.data)
    expect((await reviewer.review(input)).payment.status).toBe("Verified")
    expect(calls).toEqual(["POST", "GET", "GET"])
    expect(store.data).toEqual(before)
  })

  it("does not repeat a POST when authoritative state cannot be read", async () => {
    const { calls, reviewer, input } = client("unavailable")
    await expect(reviewer.review(input)).rejects.toThrow(/could not be confirmed/)
    await expect(reviewer.review(input)).rejects.toThrow(/could not be confirmed/)
    expect(calls).toEqual(["POST", "GET", "GET"])
    expect(savedPayment(3).status).toBe(" For Review ")
  })

  it("coalesces simultaneous calls for the same selected submission", async () => {
    const { calls, reviewer, input } = client("lost")
    const [first, second] = await Promise.all([reviewer.review(input), reviewer.review(input)])
    expect(first).toEqual(second)
    expect(calls).toEqual(["POST", "GET"])
    expect(savedBooking().amountPaid).toBe(5000)
  })
})
