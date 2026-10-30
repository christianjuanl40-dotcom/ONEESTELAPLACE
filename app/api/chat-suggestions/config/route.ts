import "server-only"

import { NextRequest, NextResponse } from "next/server"
import { Timestamp } from "firebase-admin/firestore"
import { getAdminFirestore } from "@/lib/firebase-admin"
import {
  ApiAuthError,
  isApiAuthError,
  requireBackofficeUser,
} from "@/lib/server-auth"
import {
  CHAT_SUGGESTION_CONFIG_COLLECTION,
  CHAT_SUGGESTION_CONFIG_DOCUMENT,
  CHAT_SUGGESTION_MAX_QUESTIONS,
  CHAT_SUGGESTION_PUBLISHED_DOCUMENT,
  CHAT_SUGGESTION_VERSION_DOCUMENT,
  normalizeChatSuggestionQuestions,
  toPublishedChatSuggestionQuestions,
  validateChatSuggestionQuestions,
  type ChatSuggestionQuestion,
} from "@/src/modules/shared/lib/chat-suggestions"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DataRecord = Record<string, unknown>

function isRecord(value: unknown): value is DataRecord {
  return typeof value === "object" && value !== null
}

function readRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ApiAuthError(400, "A valid question configuration revision is required.")
  }
  return value
}

function stripOptionalFields(question: ChatSuggestionQuestion): ChatSuggestionQuestion {
  const next = { ...question }
  if (!next.isArchived) {
    delete next.isArchived
    delete next.archivedAt
  }
  if (!next.updatedAt) delete next.updatedAt
  if (!next.updatedBy) delete next.updatedBy
  return next
}

function errorResponse(error: unknown) {
  if (isApiAuthError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(
    "[Chat suggestion config API]",
    error instanceof Error ? error.message : "Unknown error",
  )
  return NextResponse.json({ error: "Unable to save predefined questions. Please try again." }, { status: 500 })
}

export async function GET(request: NextRequest) {
  try {
    await requireBackofficeUser(request, { permission: "cms" })
    const snapshot = await getAdminFirestore()
      .collection(CHAT_SUGGESTION_CONFIG_COLLECTION)
      .doc(CHAT_SUGGESTION_CONFIG_DOCUMENT)
      .get()
    const data = snapshot.exists ? snapshot.data() as DataRecord : {}
    return NextResponse.json({
      questions: normalizeChatSuggestionQuestions(data.questions),
      revision: typeof data.revision === "number" ? data.revision : 0,
    }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireBackofficeUser(request, { permission: "cms" })
    const bodyText = await request.text()
    if (new TextEncoder().encode(bodyText).byteLength > 256 * 1024) {
      throw new ApiAuthError(413, "The predefined question configuration is too large.")
    }

    let body: unknown
    try {
      body = JSON.parse(bodyText)
    } catch {
      throw new ApiAuthError(400, "Invalid JSON in the predefined question configuration.")
    }
    if (!isRecord(body)) throw new ApiAuthError(400, "Invalid predefined question configuration.")
    const expectedRevision = readRevision(body.expectedRevision)
    if (!Array.isArray(body.questions) || body.questions.length > CHAT_SUGGESTION_MAX_QUESTIONS) {
      throw new ApiAuthError(400, "Invalid predefined question list.")
    }

    const validationErrors = validateChatSuggestionQuestions(body.questions)
    if (validationErrors.length > 0) throw new ApiAuthError(400, validationErrors[0])
    const requestedQuestions = normalizeChatSuggestionQuestions(body.questions).map(stripOptionalFields)
    const firestore = getAdminFirestore()
    const configRef = firestore.collection(CHAT_SUGGESTION_CONFIG_COLLECTION).doc(CHAT_SUGGESTION_CONFIG_DOCUMENT)
    const publishedRef = firestore.collection(CHAT_SUGGESTION_CONFIG_COLLECTION).doc(CHAT_SUGGESTION_PUBLISHED_DOCUMENT)
    const versionRef = firestore.collection(CHAT_SUGGESTION_CONFIG_COLLECTION).doc(CHAT_SUGGESTION_VERSION_DOCUMENT)

    const result = await firestore.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(configRef)
      const currentData = currentSnapshot.exists ? currentSnapshot.data() as DataRecord : {}
      const currentRevision = typeof currentData.revision === "number" ? currentData.revision : 0
      if (currentRevision !== expectedRevision) {
        throw new ApiAuthError(409, "The predefined question configuration changed in another editor. Review the latest content before trying again.")
      }

      const currentQuestions = normalizeChatSuggestionQuestions(currentData.questions)
      const currentById = new Map(currentQuestions.map((question) => [question.questionId, question]))
      const requestedIds = new Set(requestedQuestions.map((question) => question.questionId))
      const missingIds = currentQuestions.filter((question) => !requestedIds.has(question.questionId))
      if (missingIds.length > 0) {
        throw new ApiAuthError(400, "Existing questions must be archived instead of removed so their stable IDs remain available.")
      }

      const now = new Date().toISOString()
      const savedQuestions = requestedQuestions.map((question) => {
        const current = currentById.get(question.questionId)
        const saved: ChatSuggestionQuestion = {
          ...question,
          createdAt: current?.createdAt || now,
          updatedAt: now,
          updatedBy: user.uid,
        }
        if (saved.isArchived) {
          saved.archivedAt = current?.archivedAt || now
        }
        return saved
      })
      const nextRevision = currentRevision + 1
      const timestamp = Timestamp.now()

      transaction.set(configRef, {
        schemaVersion: 1,
        revision: nextRevision,
        questions: savedQuestions,
        updatedAt: timestamp,
        updatedBy: user.uid,
      })
      transaction.set(publishedRef, {
        schemaVersion: 1,
        revision: nextRevision,
        questions: toPublishedChatSuggestionQuestions(savedQuestions),
        publishedAt: timestamp,
        publishedBy: user.uid,
      })
      // Customer browsers subscribe only to this marker. The filtered
      // customer route reads the protected config and returns the current
      // status category's top three questions.
      transaction.set(versionRef, {
        schemaVersion: 1,
        revision: nextRevision,
        publishedAt: timestamp,
      })

      return { questions: savedQuestions, revision: nextRevision }
    })

    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
