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
  const authenticatedUser = async (request: Request) => {
    const role = request.headers.get("x-role") || "client"
    return {
      uid: role === "admin" ? "ADMIN" : role === "staff" ? "STAFF" : "CLIENT",
      role,
      fullName: "Fixture Client",
      permissions: role === "staff" ? { cms: true } : {},
    }
  }
  const backofficeUser = async (request: Request) => {
    const user = await authenticatedUser(request)
    if (user.role !== "admin" && user.role !== "staff") throw new ApiAuthError(403, "Backoffice access required.")
    return user
  }
  return {
    ApiAuthError,
    isApiAuthError: (error: unknown) => error instanceof ApiAuthError,
    requireAuthenticatedUser: authenticatedUser,
    requireBackofficeUser: backofficeUser,
  }
})

import { PATCH as saveConfig } from "@/app/api/chat-suggestions/config/route"
import { POST as sendAnswer } from "@/app/api/chat-suggestions/answer/route"
import { GET as getPublished } from "@/app/api/chat-suggestions/published/route"

const request = (body: object, role = "client") => new NextRequest("http://localhost/api/chat-suggestions", {
  method: "POST",
  headers: { "content-type": "application/json", "x-role": role },
  body: JSON.stringify(body),
})

const publishedRequest = (role = "client") => new NextRequest("http://localhost/api/chat-suggestions/published", {
  method: "GET",
  headers: { "x-role": role },
})

function question(overrides: Record<string, unknown> = {}) {
  return {
    questionId: "book-venue",
    question: "How do I book a venue?",
    answer: "Open My Bookings to start a request.",
    statusGroup: "no_booking",
    enabled: true,
    autoReplyEnabled: true,
    priority: 1,
    isPublished: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  }
}

beforeEach(() => {
  boundary.firestore = new TransactionStore()
})

describe("predefined question configuration API", () => {
  it("saves protected answers and publishes question-only metadata", async () => {
    const store = boundary.firestore as TransactionStore
    const response = await saveConfig(request({ expectedRevision: 0, questions: [question()] }, "admin"))
    expect(response.status).toBe(200)
    expect((await response.json()).revision).toBe(1)
    expect(store.data.get("chatSuggestionQuestions/config")?.questions).toEqual([
      expect.objectContaining({ questionId: "book-venue", updatedBy: "ADMIN" }),
    ])
    expect(store.data.get("chatSuggestionQuestions/published")?.questions).toEqual([{
      questionId: "book-venue",
      question: "How do I book a venue?",
      statusGroup: "no_booking",
      priority: 1,
    }])
    expect(store.data.get("chatSuggestionQuestions/published")?.questions).not.toEqual([
      expect.objectContaining({ answer: expect.any(String) }),
    ])
    expect(store.data.get("chatSuggestionQuestions/publishedVersion")).toMatchObject({ revision: 1 })
  })

  it("rejects stale saves and preserves stable entries instead of accepting removal", async () => {
    const store = boundary.firestore as TransactionStore
    expect((await saveConfig(request({ expectedRevision: 0, questions: [question()] }, "admin"))).status).toBe(200)
    expect((await saveConfig(request({ expectedRevision: 0, questions: [question({ question: "Changed" })] }, "admin"))).status).toBe(409)
    expect((await saveConfig(request({ expectedRevision: 1, questions: [] }, "admin"))).status).toBe(400)
    expect(store.data.get("chatSuggestionQuestions/config")?.questions).toEqual([
      expect.objectContaining({ question: "How do I book a venue?" }),
    ])
  })
})

describe("trusted predefined answer delivery", () => {
  it("writes the customer question and configured answer once across concurrent retries", async () => {
    const store = boundary.firestore as TransactionStore
    store.seed("chatSuggestionQuestions/config", { revision: 4, questions: [question()] })

    const body = { questionId: "book-venue", idempotencyKey: "fixture-retry-1" }
    const responses = await Promise.all([sendAnswer(request(body)), sendAnswer(request(body))])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201])
    const results = await Promise.all(responses.map((response) => response.json()))
    expect(new Set(results.map((result) => result.questionMessageId)).size).toBe(1)
    expect(new Set(results.map((result) => result.answerMessageId)).size).toBe(1)
    expect(results.filter((result) => result.alreadyProcessed)).toHaveLength(1)
    expect([...store.data.keys()].filter((path) => path.startsWith("chatMessages/")).length).toBe(2)
    expect([...store.data.keys()].filter((path) => path.startsWith("chatMessageIdempotency/")).length).toBe(1)
    const answer = [...store.data.entries()].find(([path, data]) => path.startsWith("chatMessages/") && data.isBot)
    expect(answer?.[1]).toMatchObject({
      sender: "admin",
      senderId: "automated-support",
      senderName: "One Estela Place Support",
      text: "Open My Bookings to start a request.",
      sourceQuestionId: "book-venue",
    })
  })

  it("sends only the selected customer question when automatic replies are disabled", async () => {
    const store = boundary.firestore as TransactionStore
    store.seed("chatSuggestionQuestions/config", { revision: 1, questions: [question({ autoReplyEnabled: false, answer: "" })] })
    const response = await sendAnswer(request({ questionId: "book-venue", idempotencyKey: "no-auto-reply-1" }))
    expect(response.status).toBe(201)
    expect((await response.json()).automaticReplySent).toBe(false)
    expect([...store.data.keys()].filter((path) => path.startsWith("chatMessages/")).length).toBe(1)
  })

  it("does not accept a question from another status or an unpublished question", async () => {
    const store = boundary.firestore as TransactionStore
    store.seed("chatSuggestionQuestions/config", { revision: 1, questions: [question({ statusGroup: "pending_booking" })] })
    const response = await sendAnswer(request({ questionId: "book-venue", idempotencyKey: "wrong-status-1" }))
    expect(response.status).toBe(409)
    expect([...store.data.keys()].filter((path) => path.startsWith("chatMessages/")).length).toBe(0)
  })
})

describe("filtered customer question retrieval", () => {
  it("returns only the current status category's top three questions without answers", async () => {
    const store = boundary.firestore as TransactionStore
    const pendingQuestions = [1, 2, 3, 4].map((priority) => question({
      questionId: `pending-${priority}`,
      question: `Pending question ${priority}`,
      answer: `Private answer ${priority}`,
      statusGroup: "pending_booking",
      priority,
    }))
    store.seed("chatSuggestionQuestions/config", { revision: 7, questions: [
      ...pendingQuestions,
      question({ questionId: "no-booking", question: "No booking question", statusGroup: "no_booking", priority: 1 }),
    ] })
    store.seed("bookings/BK-CLIENT", {
      userId: "CLIENT",
      status: "pending",
      bookingStatus: "Pending",
      paymentStatus: "unpaid",
      createdAt: "2026-10-01T00:00:00.000Z",
    })
    store.seed("bookings/BK-OTHER", {
      userId: "OTHER",
      status: "cancelled",
      bookingStatus: "Cancelled",
      createdAt: "2026-10-02T00:00:00.000Z",
    })

    const response = await getPublished(publishedRequest())
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.context.kind).toBe("pending_booking")
    expect(payload.questions.map((entry: { questionId: string }) => entry.questionId)).toEqual([
      "pending-1",
      "pending-2",
      "pending-3",
    ])
    expect(payload.questions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ questionId: "no-booking" }),
    ]))
    expect(payload.questions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ answer: expect.any(String) }),
    ]))
  })

  it("does not return filtered question metadata to backoffice or unauthenticated callers", async () => {
    const staffResponse = await getPublished(publishedRequest("admin"))
    expect(staffResponse.status).toBe(403)
    const unauthenticatedResponse = await getPublished(publishedRequest("unauthenticated"))
    expect(unauthenticatedResponse.status).toBe(403)
  })
})
