"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { useBookingData } from "@/src/modules/client/contexts/booking-context"
import { getAuthHeaders } from "@/src/modules/shared/lib/auth-token"
import {
  CHAT_SUGGESTION_CONFIG_COLLECTION,
  CHAT_SUGGESTION_VERSION_DOCUMENT,
  CHAT_SUGGESTION_COOLDOWN_MS,
  getChatSuggestionQuestionSet,
  getChatSuggestionContext,
  getTimestampMs,
  isChatSuggestionKind,
  isChatSuggestionDisplayDue,
  normalizePublishedChatSuggestionQuestions,
  type ChatSuggestion,
  type ChatSuggestionContext,
  type PersistedChatSuggestionState,
} from "@/src/modules/shared/lib/chat-suggestions"

interface UseChatSuggestionsOptions {
  /** Suggestions are only considered displayed when the surface is visible. */
  visible?: boolean
  /** Prevents a hidden/unloaded chat surface from consuming the display window. */
  chatReady?: boolean
  /** A persisted, non-automated support reply closes suggestions for this conversation. */
  hasHumanSupportReply?: boolean
  /** Optional deterministic clock for tests and callers with a controlled clock. */
  nowMs?: number
}

interface LocalDisplayState {
  uid: string
  contextKey: string
  shownAtMs: number
}

interface StoredChatSuggestionState {
  lastShownAt?: unknown
  contextKey?: unknown
}

interface ProfileSuggestionSnapshot {
  uid: string
  state: PersistedChatSuggestionState | null
  error: string | null
}

interface PublishedVersionSnapshot {
  uid: string
  revision: number
  loaded: boolean
  error: string | null
}

interface FilteredSuggestionSnapshot {
  uid: string
  revision: number
  context: ChatSuggestionContext | null
  loaded: boolean
  error: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function parseFilteredSuggestionResponse(value: unknown, fallbackRevision: number): FilteredSuggestionSnapshot {
  if (!isRecord(value) || !isRecord(value.context)) {
    throw new Error("Suggested questions response was invalid.")
  }

  const rawContext = value.context
  if (!isChatSuggestionKind(rawContext.kind) || typeof rawContext.contextKey !== "string" || !rawContext.contextKey) {
    throw new Error("Suggested questions response was invalid.")
  }

  const configuredQuestions = normalizePublishedChatSuggestionQuestions(value.questions)
    .filter((question) => question.statusGroup === rawContext.kind)
    .slice(0, 3)
    .map((question) => ({
      id: question.questionId,
      text: question.question,
      statusGroup: question.statusGroup,
      priority: question.priority,
    }))
  const questions = configuredQuestions.length > 0
    ? configuredQuestions
    : getChatSuggestionQuestionSet(rawContext.kind).slice(0, 3)

  return {
    uid: "",
    revision: typeof value.revision === "number" ? value.revision : fallbackRevision,
    context: {
      kind: rawContext.kind,
      contextKey: rawContext.contextKey,
      bookingId: typeof rawContext.bookingId === "string" && rawContext.bookingId ? rawContext.bookingId : undefined,
      bookingLabel: typeof rawContext.bookingLabel === "string" && rawContext.bookingLabel ? rawContext.bookingLabel : undefined,
      questions,
    },
    loaded: true,
    error: null,
  }
}

function getStateFromProfile(data: Record<string, unknown> | undefined): PersistedChatSuggestionState | null {
  const raw = data?.chatSuggestionState
  if (!raw || typeof raw !== "object") return null
  const state = raw as StoredChatSuggestionState
  return {
    lastShownAt: state.lastShownAt,
    contextKey: typeof state.contextKey === "string" ? state.contextKey : undefined,
  }
}

async function recordSuggestionDisplay(uid: string, contextKey: string): Promise<number> {
  const userRef = doc(db, "users", uid)
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(userRef)
    const state = getStateFromProfile(snapshot.exists() ? (snapshot.data() as Record<string, unknown>) : undefined)
    const lastShownMs = getTimestampMs(state?.lastShownAt)
    const nowMs = Date.now()

    if (state?.contextKey === contextKey && lastShownMs > 0 && nowMs - lastShownMs < CHAT_SUGGESTION_COOLDOWN_MS) {
      return false
    }

    transaction.set(
      userRef,
      {
        chatSuggestionState: {
          contextKey,
          lastShownAt: serverTimestamp(),
        },
      },
      { merge: true },
    )
    return true
  })

  // A concurrent tab may have recorded this context first. The local clock is
  // still useful to prevent this surface from repeatedly attempting the same
  // presentation while the snapshot listener catches up.
  return Date.now()
}

export interface ChatSuggestionsResult {
  context: ChatSuggestionContext | null
  suggestions: ChatSuggestion[]
  isLoading: boolean
  error: string | null
}

export function useChatSuggestions(options: UseChatSuggestionsOptions = {}): ChatSuggestionsResult {
  const {
    visible = false,
    chatReady = false,
    hasHumanSupportReply = false,
    nowMs: controlledNowMs,
  } = options
  const { user } = useAuth()
  const isClient = user?.role === "client"
  const shouldLoadClientData = isClient && visible
  const dataNeeds = useMemo(() => ({ bookings: shouldLoadClientData, payments: shouldLoadClientData }), [shouldLoadClientData])
  const bookingData = useBookingData(dataNeeds)
  const uid = shouldLoadClientData ? user.id : null

  const [profileSnapshot, setProfileSnapshot] = useState<ProfileSuggestionSnapshot | null>(null)
  const [publishedVersionSnapshot, setPublishedVersionSnapshot] = useState<PublishedVersionSnapshot | null>(null)
  const [filteredSnapshot, setFilteredSnapshot] = useState<FilteredSuggestionSnapshot | null>(null)
  const [localDisplay, setLocalDisplay] = useState<LocalDisplayState | null>(null)
  const [clockMs, setClockMs] = useState(() => Date.now())
  const presentationAttempt = useRef<string | null>(null)
  const previousContextKey = useRef<string | null>(null)

  useEffect(() => {
    if (!visible || controlledNowMs !== undefined) return
    const timer = window.setInterval(() => setClockMs(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [visible, controlledNowMs])

  useEffect(() => {
    if (!uid) return
    const userRef = doc(db, "users", uid)
    const unsubscribe = onSnapshot(
      userRef,
      (snapshot) => {
        setProfileSnapshot({
          uid,
          state: snapshot.exists() ? getStateFromProfile(snapshot.data() as Record<string, unknown>) : null,
          error: null,
        })
      },
      (error) => {
        console.error("[ChatSuggestions state snapshot error]", { code: error.code, message: error.message })
        setProfileSnapshot({ uid, state: null, error: "Suggestion state could not be loaded" })
      },
    )
    return unsubscribe
  }, [uid])

  useEffect(() => {
    if (!uid) {
      setPublishedVersionSnapshot(null)
      setFilteredSnapshot(null)
      return
    }

    const publishedVersionRef = doc(db, CHAT_SUGGESTION_CONFIG_COLLECTION, CHAT_SUGGESTION_VERSION_DOCUMENT)
    const unsubscribe = onSnapshot(
      publishedVersionRef,
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() as Record<string, unknown> : {}
        setPublishedVersionSnapshot({
          uid,
          revision: typeof data.revision === "number" ? data.revision : 0,
          loaded: true,
          error: null,
        })
      },
      (error) => {
        console.error("[ChatSuggestions published version snapshot error]", { code: error.code, message: error.message })
        setPublishedVersionSnapshot({
          uid,
          revision: 0,
          loaded: true,
          error: "Suggested question updates could not be loaded",
        })
      },
    )
    return unsubscribe
  }, [uid])

  const stateLoaded = Boolean(uid && profileSnapshot?.uid === uid)
  const persistedState = profileSnapshot?.uid === uid ? profileSnapshot.state : null
  const stateError = profileSnapshot?.uid === uid ? profileSnapshot.error : null
  const publishedVersionLoaded = Boolean(uid && publishedVersionSnapshot?.uid === uid && publishedVersionSnapshot.loaded)
  const publishedRevision = publishedVersionSnapshot?.uid === uid ? publishedVersionSnapshot.revision : 0
  const publishedVersionError = publishedVersionSnapshot?.uid === uid ? publishedVersionSnapshot.error : null

  // This local status key is only a refresh trigger. Question metadata is
  // fetched from the server after it evaluates the same account records, so a
  // browser never receives another status category's published questions.
  const localStatusContext = useMemo<ChatSuggestionContext | null>(() => {
    if (!isClient) return null
    return getChatSuggestionContext(
      bookingData.bookings as unknown as ReadonlyArray<Record<string, unknown>>,
      bookingData.paymentRecords,
      [],
      0,
    )
  }, [bookingData.bookings, bookingData.paymentRecords, isClient])

  const localStatusRefreshKey = localStatusContext?.contextKey || "unavailable"

  useEffect(() => {
    if (!uid) {
      setFilteredSnapshot(null)
      return
    }
    if (!publishedVersionLoaded || !localStatusContext || bookingData.isLoading) return

    const controller = new AbortController()
    let cancelled = false
    setFilteredSnapshot((current) => ({
      uid,
      revision: publishedRevision,
      context: current?.uid === uid ? current.context : null,
      loaded: false,
      error: null,
    }))

    void (async () => {
      try {
        const response = await fetch("/api/chat-suggestions/published", {
          method: "GET",
          cache: "no-store",
          headers: await getAuthHeaders(false, false, controller.signal),
          signal: controller.signal,
        })
        const payload = await response.json().catch(() => ({})) as unknown
        if (!response.ok) {
          const errorMessage = isRecord(payload) && typeof payload.error === "string"
            ? payload.error
            : "Suggested questions could not be loaded."
          throw new Error(errorMessage)
        }
        if (cancelled) return
        const parsed = parseFilteredSuggestionResponse(payload, publishedRevision)
        setFilteredSnapshot({ ...parsed, uid })
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return
        console.error("[ChatSuggestions filtered retrieval error]", error)
        setFilteredSnapshot({
          uid,
          revision: publishedRevision,
          context: null,
          loaded: true,
          error: error instanceof Error ? error.message : "Suggested questions could not be loaded",
        })
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [bookingData.isLoading, localStatusContext, localStatusRefreshKey, publishedRevision, publishedVersionLoaded, uid])

  const filteredLoaded = Boolean(uid && filteredSnapshot?.uid === uid && filteredSnapshot.loaded)
  const context = filteredSnapshot?.uid === uid ? filteredSnapshot.context : null
  const filteredError = filteredSnapshot?.uid === uid ? filteredSnapshot.error : null

  const contextKey = context?.contextKey ?? null
  useEffect(() => {
    if (previousContextKey.current === contextKey) return
    previousContextKey.current = contextKey
    setLocalDisplay(null)
    presentationAttempt.current = null
  }, [contextKey])

  useEffect(() => {
    if (!visible) {
      presentationAttempt.current = null
      setLocalDisplay(null)
    }
  }, [visible])

  const evaluationNowMs = controlledNowMs ?? clockMs
  const persistedShownMs = contextKey && persistedState?.contextKey === contextKey
    ? getTimestampMs(persistedState.lastShownAt)
    : 0
  const localShownMs = localDisplay?.uid === uid && localDisplay.contextKey === contextKey ? localDisplay.shownAtMs : 0
  const effectiveShownMs = Math.max(persistedShownMs, localShownMs)
  const due = contextKey
    ? isChatSuggestionDisplayDue(
        effectiveShownMs > 0 ? { contextKey, lastShownAt: effectiveShownMs } : null,
        contextKey,
        evaluationNowMs,
      )
    : false
  const dataLoading = !isClient || bookingData.isLoading || !stateLoaded || !publishedVersionLoaded || !filteredLoaded
  const canDisplay = Boolean(
    isClient
      && visible
      && chatReady
      && !dataLoading
      && !bookingData.dataError
      && !stateError
      && !publishedVersionError
      && !filteredError
      && context
      && context.questions.length > 0,
  )
  // Cooldown controls admission of a new presentation, not the lifetime of
  // the already visible one. Its own profile snapshot must not hide it. A
  // genuine support reply is the conversation-level end condition.
  const shouldDisplay = canDisplay && !hasHumanSupportReply

  useEffect(() => {
    if (!canDisplay || !context || !uid || !due || hasHumanSupportReply) return
    const attemptKey = `${uid}|${context.contextKey}`
    if (presentationAttempt.current === attemptKey) return
    presentationAttempt.current = attemptKey
    setLocalDisplay({ uid, contextKey: context.contextKey, shownAtMs: Date.now() })

    let cancelled = false
    void recordSuggestionDisplay(uid, context.contextKey)
      .then((shownAtMs) => {
        if (cancelled) return
        setLocalDisplay({ uid, contextKey: context.contextKey, shownAtMs })
      })
      .catch((error) => {
        if (cancelled) return
        presentationAttempt.current = null
        console.error("[ChatSuggestions state write error]", error)
      })

    return () => {
      cancelled = true
    }
  }, [canDisplay, context, due, hasHumanSupportReply, uid])

  return {
    context,
    suggestions: shouldDisplay ? context?.questions.slice(0, 3) || [] : [],
    isLoading: dataLoading,
    error: bookingData.dataError || stateError || publishedVersionError || filteredError,
  }
}
