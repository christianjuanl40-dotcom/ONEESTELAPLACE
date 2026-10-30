import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireAuthenticatedUser,
} from "@/lib/server-auth"
import {
  CHAT_SUGGESTION_CONFIG_COLLECTION,
  CHAT_SUGGESTION_CONFIG_DOCUMENT,
  getChatSuggestionContext,
  normalizeChatSuggestionQuestions,
  type ChatSuggestionKind,
} from "@/src/modules/shared/lib/chat-suggestions"
import type { PaymentRecordLike } from "@/src/modules/shared/lib/payment-calculations"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

function asIso(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate()
    return date instanceof Date ? date.toISOString() : value
  }
  return value
}

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(
    "[GET /api/chat-suggestions/published]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to load suggested questions. Please try again." }, { status: 500 })
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    if (user.role !== "client") throw new ApiAuthError(403, "Only customers can load suggested questions.")

    const firestore = getAdminFirestore()
    const [configSnapshot, bookingSnapshot, paymentSnapshot] = await Promise.all([
      firestore.collection(CHAT_SUGGESTION_CONFIG_COLLECTION).doc(CHAT_SUGGESTION_CONFIG_DOCUMENT).get(),
      firestore.collection("bookings").where("userId", "==", user.uid).get(),
      firestore.collection("payments").where("customerId", "==", user.uid).get(),
    ])

    const configData = configSnapshot.exists ? configSnapshot.data() as DataRecord : {}
    const questions = normalizeChatSuggestionQuestions(configData.questions)
    const revision = typeof configData.revision === "number" ? configData.revision : 0
    const bookings = bookingSnapshot.docs.map((snapshot) => ({
      ...(snapshot.data() as DataRecord),
      id: snapshot.id,
    }))
    const paymentRecords: PaymentRecordLike[] = paymentSnapshot.docs.map((snapshot) => {
      const data = snapshot.data() as DataRecord
      return {
        ...data,
        id: snapshot.id,
        submittedAt: asIso(data.submittedAt),
        updatedAt: asIso(data.updatedAt),
        reviewedAt: asIso(data.reviewedAt),
      } as PaymentRecordLike
    })
    const context = getChatSuggestionContext(bookings, paymentRecords, questions, revision)
    const publishedQuestions = context.questions.slice(0, 3).map((question) => ({
      questionId: question.id,
      question: question.text,
      statusGroup: question.statusGroup as ChatSuggestionKind,
      priority: question.priority ?? 0,
    }))

    return NextResponse.json({
      revision,
      questions: publishedQuestions,
      context: {
        kind: context.kind,
        contextKey: context.contextKey,
        bookingId: context.bookingId || null,
        bookingLabel: context.bookingLabel || null,
      },
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
