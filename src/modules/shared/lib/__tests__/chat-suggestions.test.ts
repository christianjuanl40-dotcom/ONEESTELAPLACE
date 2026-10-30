import { describe, expect, it } from "vitest"
import {
  CHAT_SUGGESTION_COOLDOWN_MS,
  getChatSuggestionQuestionSet,
  getChatSuggestionContext,
  getTimestampMs,
  isChatSuggestionDisplayDue,
  toPublishedChatSuggestionQuestions,
  validateChatSuggestionQuestions,
  type PersistedChatSuggestionState,
} from "../chat-suggestions"

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: "BK001",
    status: "pending",
    bookingStatus: "Pending",
    paymentStatus: "unpaid",
    totalPrice: 10000,
    paymentType: "downpayment",
    selectedDownpaymentAmount: 5000,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  }
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "PAY001",
    bookingId: "BK001",
    status: "for_review",
    amount: 5000,
    submittedAt: "2026-10-02T10:00:00.000Z",
    ...overrides,
  }
}

describe("chat suggestion timing", () => {
  const now = Date.parse("2026-10-30T12:00:00.000Z")

  it("shows the first set without a persisted state", () => {
    const context = getChatSuggestionContext([], [])
    expect(context.kind).toBe("no_booking")
    expect(context.questions).toHaveLength(3)
    expect(isChatSuggestionDisplayDue(null, context.contextKey, now)).toBe(true)
  })

  it("keeps the same context hidden until the 24-hour window expires", () => {
    const contextKey = getChatSuggestionContext([booking()], []).contextKey
    const state: PersistedChatSuggestionState = {
      contextKey,
      lastShownAt: now - CHAT_SUGGESTION_COOLDOWN_MS + 1,
    }
    expect(isChatSuggestionDisplayDue(state, contextKey, now)).toBe(false)
    expect(isChatSuggestionDisplayDue(state, contextKey, now + 1)).toBe(true)
    expect(isChatSuggestionDisplayDue(state, "BK001|confirmed_event", now)).toBe(true)
  })

  it("normalizes Firestore-like timestamps reliably", () => {
    expect(getTimestampMs({ toMillis: () => 1234 })).toBe(1234)
    expect(getTimestampMs("2026-10-30T12:00:00.000Z")).toBe(Date.parse("2026-10-30T12:00:00.000Z"))
    expect(getTimestampMs("not-a-date")).toBe(0)
  })
})

describe("status-aware chat suggestion selection", () => {
  it.each([
    ["pending_booking", booking()],
    ["awaiting_payment", booking({ paymentStatus: "awaiting_payment" })],
    ["payment_review", booking(), [record()]],
    ["partially_paid", booking({ paymentStatus: "partial" }), [record({ status: "verified" })]],
    ["confirmed_event", booking({ status: "confirmed", bookingStatus: "Confirmed", paymentStatus: "paid" }), [record({ status: "verified", amount: 10000 })]],
    ["active_office", booking({ bookingCategory: "office", isOfficeRental: true, status: "active_rental", paymentStatus: "paid" }), []],
    ["cancelled_or_refund", booking({ status: "cancelled", bookingStatus: "Cancelled" })],
  ] as const)("uses the canonical state priority for %s", (kind, selectedBooking, records = []) => {
    expect(getChatSuggestionContext([selectedBooking], records as any).kind).toBe(kind)
  })

  it("selects the most actionable booking instead of a random booking", () => {
    const context = getChatSuggestionContext([
      booking({ id: "BK-CONFIRMED", status: "confirmed", bookingStatus: "Confirmed", paymentStatus: "paid", updatedAt: "2026-10-29T10:00:00.000Z" }),
      booking({ id: "BK-PENDING", updatedAt: "2026-10-01T10:00:00.000Z" }),
      booking({ id: "BK-CANCELLED", status: "cancelled", bookingStatus: "Cancelled", updatedAt: "2026-09-01T10:00:00.000Z" }),
    ], [])
    expect(context.kind).toBe("cancelled_or_refund")
    expect(context.bookingId).toBe("BK-CANCELLED")
  })

  it("recognizes the canonical active office label with either spacing convention", () => {
    expect(getChatSuggestionContext([
      booking({ bookingCategory: "office", isOfficeRental: true, status: "Active Rental", paymentStatus: "paid" }),
    ], []).kind).toBe("active_office")
  })

  it("breaks equal-priority ties by recent activity and then booking ID", () => {
    const recent = getChatSuggestionContext([
      booking({ id: "BK-OLDER", updatedAt: "2026-10-01T10:00:00.000Z" }),
      booking({ id: "BK-NEWER", updatedAt: "2026-10-02T10:00:00.000Z" }),
    ], [])
    expect(recent.bookingId).toBe("BK-NEWER")

    const stable = getChatSuggestionContext([
      booking({ id: "BK-Z", updatedAt: "2026-10-02T10:00:00.000Z" }),
      booking({ id: "BK-A", updatedAt: "2026-10-02T10:00:00.000Z" }),
    ], [])
    expect(stable.bookingId).toBe("BK-A")
  })

  it("does not use another booking's payment records", () => {
    const context = getChatSuggestionContext(
      [booking({ id: "BK-OWN", paymentStatus: "pending" })],
      [record({ bookingId: "BK-OTHER", status: "verified", amount: 10000 })] as any,
    )
    expect(context.kind).toBe("pending_booking")
    expect(context.bookingId).toBe("BK-OWN")
  })

  it("refreshes the context key when a meaningful booking state changes", () => {
    const pending = getChatSuggestionContext([booking()], [])
    const confirmed = getChatSuggestionContext([
      booking({ status: "confirmed", bookingStatus: "Confirmed", paymentStatus: "paid" }),
    ], [record({ status: "verified", amount: 10000 })] as any)
    expect(confirmed.contextKey).not.toBe(pending.contextKey)
    expect(confirmed.kind).toBe("confirmed_event")
  })

  it("uses published CMS questions in configured priority order and caps the result at three", () => {
    const questions = [1, 2, 3, 4].map((priority) => ({
      questionId: `pending-${priority}`,
      question: `Pending question ${priority}`,
      answer: `Answer ${priority}`,
      statusGroup: "pending_booking" as const,
      enabled: true,
      autoReplyEnabled: true,
      priority,
      isPublished: true,
      createdAt: "2026-10-01T00:00:00.000Z",
    }))
    const context = getChatSuggestionContext([booking()], [], questions, 4)
    expect(context.questions.map((question) => question.id)).toEqual(["pending-1", "pending-2", "pending-3"])
    expect(context.contextKey).toContain("|4")
    expect(getChatSuggestionQuestionSet("pending_booking")).toHaveLength(3)
  })

  it("rejects duplicate active questions within one status group and missing automatic answers", () => {
    const questions = [
      {
        questionId: "q1", question: "Same wording", answer: "Answer", statusGroup: "no_booking",
        enabled: true, autoReplyEnabled: true, priority: 1, isPublished: true, createdAt: "2026-10-01",
      },
      {
        questionId: "q2", question: " same   wording ", answer: "", statusGroup: "no_booking",
        enabled: true, autoReplyEnabled: true, priority: 2, isPublished: false, createdAt: "2026-10-01",
      },
    ]
    expect(validateChatSuggestionQuestions(questions)).toEqual(expect.arrayContaining([
      expect.stringMatching(/duplicates an active question/i),
      expect.stringMatching(/needs an answer/i),
    ]))
  })

  it("publishes question metadata without exposing answer content", () => {
    const published = toPublishedChatSuggestionQuestions([{
      questionId: "published-q",
      question: "Published question",
      answer: "Private configured answer",
      statusGroup: "no_booking",
      enabled: true,
      autoReplyEnabled: true,
      priority: 1,
      isPublished: true,
      createdAt: "2026-10-01",
    }])
    expect(published).toEqual([{
      questionId: "published-q",
      question: "Published question",
      statusGroup: "no_booking",
      priority: 1,
    }])
    expect(published[0]).not.toHaveProperty("answer")
  })
})
