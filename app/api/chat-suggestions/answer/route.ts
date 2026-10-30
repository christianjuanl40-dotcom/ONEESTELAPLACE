import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { Timestamp } from "firebase-admin/firestore"
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
  type ChatSuggestionQuestion,
} from "@/src/modules/shared/lib/chat-suggestions"
import type { PaymentRecordLike } from "@/src/modules/shared/lib/payment-calculations"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null
}

function readString(body: DataRecord, key: string, maxLength: number): string {
  const value = body[key]
  if (typeof value !== "string") throw new ApiAuthError(400, `A valid ${key} is required.`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) throw new ApiAuthError(400, `A valid ${key} is required.`)
  return normalized
}

function readIdempotencyKey(body: DataRecord): string {
  const key = readString(body, "idempotencyKey", 200)
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) throw new ApiAuthError(400, "Invalid idempotency key.")
  return key
}

function asIso(value: unknown): unknown {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    const date = value.toDate()
    return date instanceof Date ? date.toISOString() : value
  }
  return value
}

function getIdempotencyRef(firestore: ReturnType<typeof getAdminFirestore>, uid: string, key: string) {
  const digest = createHash("sha256").update(`${uid}\u0000${key}`).digest("hex")
  return firestore.collection("chatMessageIdempotency").doc(`predefined_${digest}`)
}

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(
    "[POST /api/chat-suggestions/answer]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to send the selected question. Please try again." }, { status: 500 })
}

function getQuestion(
  questions: ChatSuggestionQuestion[],
  questionId: string,
  contextQuestions: Array<{ id: string }>,
): ChatSuggestionQuestion {
  const question = questions.find((candidate) => (
    candidate.questionId === questionId
      && candidate.enabled
      && candidate.isPublished
      && !candidate.isArchived
  ))
  if (!question || !contextQuestions.some((candidate) => candidate.id === questionId)) {
    throw new ApiAuthError(409, "That predefined question is no longer available for this account status.")
  }
  if (question.autoReplyEnabled && !question.answer.trim()) {
    throw new ApiAuthError(409, "That predefined question is not configured with a valid answer.")
  }
  return question
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthenticatedUser(request)
    if (user.role !== "client") throw new ApiAuthError(403, "Only customers can select predefined questions.")

    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 16 * 1024) {
      throw new ApiAuthError(413, "The selected question request is too large.")
    }
    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in the selected question request.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid selected question request.")
    const questionId = readString(body, "questionId", 128)
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(questionId)) throw new ApiAuthError(400, "Invalid question ID.")
    const idempotencyKey = readIdempotencyKey(body)

    const firestore = getAdminFirestore()
    const configRef = firestore.collection(CHAT_SUGGESTION_CONFIG_COLLECTION).doc(CHAT_SUGGESTION_CONFIG_DOCUMENT)
    const idempotencyRef = getIdempotencyRef(firestore, user.uid, idempotencyKey)
    const questionMessageId = `msg_${randomUUID()}`
    const answerMessageId = `msg_${randomUUID()}`
    const questionMessageRef = firestore.collection("chatMessages").doc(questionMessageId)
    const answerMessageRef = firestore.collection("chatMessages").doc(answerMessageId)
    const fingerprint = JSON.stringify({ questionId })

    const result = await firestore.runTransaction(async (transaction) => {
      const idempotencySnapshot = await transaction.get(idempotencyRef)
      if (idempotencySnapshot.exists) {
        const saved = idempotencySnapshot.data() as DataRecord
        if (saved.userId !== user.uid || saved.fingerprint !== fingerprint) {
          throw new ApiAuthError(409, "This idempotency key was already used for a different question.")
        }
        const savedQuestionMessageId = String(saved.questionMessageId || "")
        const savedAnswerMessageId = typeof saved.answerMessageId === "string" ? saved.answerMessageId : ""
        const savedQuestion = await transaction.get(firestore.collection("chatMessages").doc(savedQuestionMessageId))
        if (!savedQuestion.exists) throw new ApiAuthError(409, "The original selected question could not be recovered. Please contact support.")
        if (savedAnswerMessageId) {
          const savedAnswer = await transaction.get(firestore.collection("chatMessages").doc(savedAnswerMessageId))
          if (!savedAnswer.exists) throw new ApiAuthError(409, "The original automated answer could not be recovered. Please contact support.")
        }
        return {
          questionMessageId: savedQuestionMessageId,
          answerMessageId: savedAnswerMessageId || null,
          automaticReplySent: Boolean(savedAnswerMessageId),
          alreadyProcessed: true,
        }
      }

      const configSnapshot = await transaction.get(configRef)
      if (!configSnapshot.exists) throw new ApiAuthError(409, "Predefined questions are not available yet.")
      const configData = configSnapshot.data() as DataRecord
      const questions = normalizeChatSuggestionQuestions(configData.questions)
      const revision = typeof configData.revision === "number" ? configData.revision : 0

      const bookingSnapshot = await transaction.get(firestore.collection("bookings").where("userId", "==", user.uid))
      const paymentSnapshot = await transaction.get(firestore.collection("payments").where("customerId", "==", user.uid))
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
      const question = getQuestion(questions, questionId, context.questions)
      const nowMs = Date.now()
      const questionTimestamp = Timestamp.fromMillis(nowMs)
      const answerTimestamp = Timestamp.fromMillis(nowMs + 1)
      const displayTime = new Date(nowMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      const customerName = user.fullName || "Customer"

      transaction.create(questionMessageRef, {
        text: question.question,
        content: question.question,
        sender: "client",
        senderId: user.uid,
        senderName: customerName,
        senderAvatar: "",
        clientId: user.uid,
        clientName: customerName,
        clientProfilePicture: "",
        targetId: "admin",
        recipientId: "admin",
        timestamp: questionTimestamp,
        time: displayTime,
        imageUrl: null,
        isRead: false,
        isReadByClient: true,
        read: false,
        isBot: false,
        sourceQuestionId: question.questionId,
      })

      let savedAnswerMessageId = ""
      if (question.autoReplyEnabled) {
        savedAnswerMessageId = answerMessageId
        transaction.create(answerMessageRef, {
          text: question.answer,
          content: question.answer,
          sender: "admin",
          senderId: "automated-support",
          senderName: "One Estela Place Support",
          senderAvatar: "",
          clientId: user.uid,
          clientName: customerName,
          clientProfilePicture: "",
          targetId: user.uid,
          recipientId: user.uid,
          timestamp: answerTimestamp,
          time: displayTime,
          imageUrl: null,
          isRead: true,
          isReadByClient: true,
          read: true,
          isBot: true,
          automationType: "predefined_question",
          sourceQuestionId: question.questionId,
        })
      }

      transaction.create(idempotencyRef, {
        userId: user.uid,
        fingerprint,
        questionId: question.questionId,
        questionMessageId,
        answerMessageId: savedAnswerMessageId || null,
        createdAt: questionTimestamp,
      })

      return {
        questionMessageId,
        answerMessageId: savedAnswerMessageId || null,
        automaticReplySent: Boolean(savedAnswerMessageId),
        alreadyProcessed: false,
      }
    })

    return NextResponse.json(result, { status: result.alreadyProcessed ? 200 : 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
