"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "../auth/auth-context"
import { perfListener } from "../lib/perf-trace"
import { getAuthHeaders } from "../lib/auth-token"
import { db } from "@/lib/firebase"
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  limit,
  limitToLast,
  getDocs,
  endBefore,
  startAfter,
} from "firebase/firestore"
import { getChatTimestampMs, sortChatMessages } from "../lib/chat-presentation"

export interface ChatMessageItem {
  id?: string
  firestoreId?: string
  text: string
  content?: string
  sender: "user" | "admin" | "bot" | "client"
  senderId?: string
  senderName?: string
  senderAvatar?: string
  clientId?: string
  clientName?: string
  clientProfilePicture?: string
  targetId?: string
  recipientId?: string
  timestamp: string | number | Date | any
  time?: string
  imageUrl?: string | null
  isRead?: boolean
  isReadByClient?: boolean
  read?: boolean
  isBot?: boolean
  automationType?: string
  sourceQuestionId?: string
  followUps?: string[]
  escalated?: boolean
}

interface UserStatus {
  userId: string
  isOnline: boolean
  lastSeen?: string
}

interface TypingIndicator {
  userId: string
  isTyping: boolean
}

interface ChatContextValue {
  messages: ChatMessageItem[]
  conversationIndex: ChatMessageItem[]
  activeConversationId: string | null
  typingIndicators: TypingIndicator[]
  userStatuses: Record<string, UserStatus>
  isConnected: boolean
  isOpen: boolean
  currentClientId: string | null
  isChatLoaded: boolean
  isChatLoading: boolean
  chatError: string | null
  unreadError: string | null
  newMessageNotifications: string[]
  unreadMessages: number
  unreadMessagesIsBounded: boolean
  hasOlderMessages: boolean
  isLoadingOlder: boolean
  loadChat: (clientId?: string) => void
  loadOlderMessages: () => Promise<void>
  unloadChat: () => void
  sendMessage: (
    text: string,
    senderRole: "admin" | "client" | "user" | "bot",
    clientId?: string,
    clientName?: string,
    isBot?: boolean,
    imageUrl?: string
  ) => Promise<void>
  sendPredefinedQuestion: (questionId: string) => Promise<void>
  markAsRead: (clientId: string) => Promise<void>
  markAsReadByClient: (clientId: string) => Promise<void>
  markAdminAsRead: () => void
  toggleChat: () => void
  startTyping: (userId: string) => void
  stopTyping: (userId: string) => void
  getChatHistory: () => ChatMessageItem[]
  getUnreadCount: () => number
  clearNotifications: () => void
  retryChat: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)
const chatMessagesRef = collection(db, "chatMessages")
const CHAT_HISTORY_PAGE_SIZE = 100
const CHAT_INDEX_LIMIT = 500
const CHAT_UNREAD_LIMIT = 500

function mapChatDocument(docSnap: any): ChatMessageItem {
  const data = docSnap.data()
  return {
    id: docSnap.id,
    firestoreId: docSnap.id,
    text: data.text || "",
    content: data.content || data.text || "",
    sender: data.sender || "client",
    senderId: data.senderId,
    senderName: data.senderName,
    senderAvatar: data.senderAvatar || "",
    clientId: data.clientId,
    clientName: data.clientName,
    clientProfilePicture: data.clientProfilePicture || "",
    targetId: data.targetId,
    recipientId: data.recipientId,
    timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp || null,
    time: data.time,
    imageUrl: data.imageUrl || null,
    isRead: data.isRead ?? false,
    isReadByClient: data.isReadByClient ?? false,
    read: data.read ?? false,
    isBot: data.isBot ?? false,
    automationType: data.automationType,
    sourceQuestionId: data.sourceQuestionId,
    followUps: data.followUps,
    escalated: data.escalated,
  }
}

async function markUnreadMessagesInPages(constraints: any[], field: "isRead" | "isReadByClient") {
  // Re-query the first bounded page after each write. Updated documents leave
  // the unread result set, so this avoids both a large read and cursor skips.
  for (let page = 0; page < 10_000; page += 1) {
    const snapshot = await getDocs(query(
      chatMessagesRef,
      ...constraints,
      limit(CHAT_HISTORY_PAGE_SIZE),
    ))
    if (snapshot.empty) return
    await Promise.all(snapshot.docs.map((docSnap) => updateDoc(
      doc(db, "chatMessages", docSnap.id),
      { [field]: true },
    )))
    if (snapshot.size < CHAT_HISTORY_PAGE_SIZE) return
  }
  throw new Error("Unread message update exceeded the bounded page limit.")
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [conversationIndex, setConversationIndex] = useState<ChatMessageItem[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [isChatLoaded, setIsChatLoaded] = useState(false)
  const [typingIndicators, setTypingIndicators] = useState<TypingIndicator[]>([])
  const [userStatuses, setUserStatuses] = useState<Record<string, UserStatus>>({})
  const [isOpen, setIsOpen] = useState(false)
  const [newMessageNotifications, setNewMessageNotifications] = useState<string[]>([])
  const [isMessagesActive, setIsMessagesActive] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [unreadMessagesIsBounded, setUnreadMessagesIsBounded] = useState(false)
  const [hasOlderMessages, setHasOlderMessages] = useState(false)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [unreadError, setUnreadError] = useState<string | null>(null)
  const [chatRetryAttempt, setChatRetryAttempt] = useState(0)
  const initialLoadDone = useRef(false)
  const messagesStateRef = useRef<ChatMessageItem[]>([])

  useEffect(() => {
    messagesStateRef.current = messages
  }, [messages])

  const currentClientId = user?.id ?? null
  const currentUserId = user?.id
  const currentUserRole = user?.role
  const canAccessChat = currentUserRole === "admin" || (
    currentUserRole === "staff" && user?.permissions?.chat === true
  )
  const scope = JSON.stringify([currentUserId, currentUserRole, canAccessChat])
  const [loadedScope, setLoadedScope] = useState("")
  const scopeIsCurrent = Boolean(currentUserId) && loadedScope === scope
  const liveMessagesRef = useRef(new Map<string, ChatMessageItem>())
  const historicalMessagesRef = useRef(new Map<string, ChatMessageItem>())
  const legacyMessagesRef = useRef(new Map<string, ChatMessageItem>())
  const oldestTimestampCursorRef = useRef<any>(null)
  const legacyCursorRef = useRef<any>(null)
  const hasMoreTimestampMessagesRef = useRef(false)
  const hasMoreLegacyMessagesRef = useRef(false)
  const historyGenerationRef = useRef(0)

  const publishActiveMessages = useCallback(() => {
    const mergedById = new Map<string, ChatMessageItem>()
    const messagesWithoutIds: ChatMessageItem[] = []
    for (const message of [
      ...historicalMessagesRef.current.values(),
      ...legacyMessagesRef.current.values(),
      ...liveMessagesRef.current.values(),
    ]) {
      const id = message.id || message.firestoreId
      if (id) mergedById.set(String(id), message)
      else messagesWithoutIds.push(message)
    }
    setMessages(sortChatMessages([...mergedById.values(), ...messagesWithoutIds]))
  }, [])

  const clearActiveHistory = useCallback(() => {
    historyGenerationRef.current += 1
    liveMessagesRef.current.clear()
    historicalMessagesRef.current.clear()
    legacyMessagesRef.current.clear()
    oldestTimestampCursorRef.current = null
    legacyCursorRef.current = null
    hasMoreTimestampMessagesRef.current = false
    hasMoreLegacyMessagesRef.current = false
    setMessages([])
    setHasOlderMessages(false)
    setIsLoadingOlder(false)
  }, [])

  const resetChatScope = useCallback((nextScope: string) => {
    // Account/permission changes are a lifecycle boundary. Clear the old
    // conversation before the new listener can publish data for this scope.
    setLoadedScope(nextScope)
    setConversationIndex([])
    setActiveConversationId(null)
    clearActiveHistory()
    setMessages([])
    setIsChatLoaded(false)
    setTypingIndicators([])
    setUserStatuses({})
    setNewMessageNotifications([])
    setUnreadMessages(0)
    setUnreadMessagesIsBounded(false)
    setChatError(null)
    setUnreadError(null)
    initialLoadDone.current = false
  }, [clearActiveHistory])

  useEffect(() => {
    let active = true
    // Defer the lifecycle reset until the effect batch has finished. The
    // scope guard already hides the previous account synchronously, while
    // the queued transition avoids a cascading render during effect setup.
    queueMicrotask(() => {
      if (active) resetChatScope(scope)
    })
    return () => { active = false }
  }, [resetChatScope, scope])

  // Lightweight scoped unread listener (always on while signed in).
  // Powers the chat badges WITHOUT loading the full conversation.
  useEffect(() => {
    if (!currentUserId || !currentUserRole) return
    const isAdminScope = canAccessChat
    if (currentUserRole === "staff" && !isAdminScope) {
      return
    }
    const unreadQuery = isAdminScope
       ? query(chatMessagesRef, where("sender", "==", "client"), where("isRead", "==", false), limit(CHAT_UNREAD_LIMIT + 1))
       : query(
           chatMessagesRef,
           where("clientId", "==", currentUserId),
           where("sender", "==", "admin"),
           where("isReadByClient", "==", false),
           limit(CHAT_UNREAD_LIMIT + 1),
         )
    console.log("[Firestore Listener START] ChatUnread", isAdminScope ? "(admin scope)" : `(client: ${currentUserId})`)
    let disposed = false
    perfListener("ChatUnread", "START")
    const unsub = onSnapshot(
      unreadQuery,
      (snapshot) => {
        if (disposed) return
         perfListener("ChatUnread", "FIRST_SNAPSHOT", snapshot.size)
          const isBounded = snapshot.size > CHAT_UNREAD_LIMIT
          setUnreadMessages(isBounded ? CHAT_UNREAD_LIMIT : snapshot.size)
          setUnreadMessagesIsBounded(isBounded)
         setUnreadError(null)
       },
      (error) => {
        if (disposed) return
         perfListener("ChatUnread", "ERROR")
         console.error("[ChatUnread snapshot error]", { code: error.code, message: error.message, error })
         setUnreadError("Unread messages could not be refreshed. Retry chat loading to try again.")
      },
    )
    return () => {
      disposed = true
      console.log("[Firestore Listener STOP] ChatUnread")
      perfListener("ChatUnread", "STOP")
      unsub()
    }
  }, [currentUserId, currentUserRole, canAccessChat, chatRetryAttempt])

  const fetchLegacyPage = useCallback(async (conversationId: string, generation: number) => {
    if (generation !== historyGenerationRef.current || !conversationId) return

    // A query without an explicit order uses Firestore's deterministic
    // document-ID order. Keeping the fallback equality-only avoids requiring
    // a new composite index solely for legacy records.
    const legacyConstraints: any[] = [
      where("clientId", "==", conversationId),
      ...(legacyCursorRef.current ? [startAfter(legacyCursorRef.current)] : []),
      limit(CHAT_HISTORY_PAGE_SIZE),
    ]
    let snapshot: any
    try {
      snapshot = await getDocs(query(chatMessagesRef, ...legacyConstraints))
    } catch (error) {
      console.warn("[Chat] Legacy timestamp page unavailable", error)
      hasMoreLegacyMessagesRef.current = false
      setHasOlderMessages(hasMoreTimestampMessagesRef.current)
      return
    }

    if (generation !== historyGenerationRef.current) return
    if (snapshot.empty) {
      hasMoreLegacyMessagesRef.current = false
      setHasOlderMessages(hasMoreTimestampMessagesRef.current)
      return
    }

    snapshot.forEach((docSnap: any) => {
      const message = mapChatDocument(docSnap)
      if (getChatTimestampMs(message.timestamp) === null) {
        legacyMessagesRef.current.set(docSnap.id, message)
      }
    })
    legacyCursorRef.current = snapshot.docs.at(-1) || legacyCursorRef.current
    hasMoreLegacyMessagesRef.current = snapshot.size >= CHAT_HISTORY_PAGE_SIZE
    publishActiveMessages()
    setHasOlderMessages(hasMoreTimestampMessagesRef.current || hasMoreLegacyMessagesRef.current)
  }, [publishActiveMessages])

  // Full conversation listener — lazy. Admins receive a lightweight bounded
  // conversation index until a client is selected; message history itself is
  // always scoped to one client and loaded in pages.
  useEffect(() => {
    if (!currentUserId || !currentUserRole || !isMessagesActive) return
    const isAdminScope = canAccessChat
    if (currentUserRole === "staff" && !isAdminScope) return
    let disposed = false
    const generation = historyGenerationRef.current
    initialLoadDone.current = false
    perfListener("Chat", "START")

    if (isAdminScope && !activeConversationId) {
      console.log("[Firestore Listener START] ChatConversationIndex")
      const canonicalIndex = new Map<string, ChatMessageItem>()
      const legacyIndex = new Map<string, ChatMessageItem>()
      const publishConversationIndex = () => {
        setConversationIndex(sortChatMessages([
          ...canonicalIndex.values(),
          ...legacyIndex.values(),
        ]))
      }
      const indexQuery = query(chatMessagesRef, orderBy("timestamp", "desc"), limit(CHAT_INDEX_LIMIT))
      const unsub = onSnapshot(indexQuery, (snapshot) => {
        if (disposed) return
        canonicalIndex.clear()
        snapshot.forEach((docSnap) => canonicalIndex.set(docSnap.id, mapChatDocument(docSnap)))
        publishConversationIndex()
        setMessages([])
        setIsChatLoading(false)
        setChatError(null)
        setIsChatLoaded(true)
        perfListener("Chat", "FIRST_SNAPSHOT", canonicalIndex.size)
      }, (error) => {
        if (disposed) return
        perfListener("Chat", "ERROR")
        console.error("[Chat conversation index error]", { code: error.code, message: error.message, error })
        setIsChatLoading(false)
        setChatError(error.code === "permission-denied"
          ? "Chat is not authorized for this account."
          : "Chat conversations could not be loaded. Check your connection and retry.")
      })

      // Timestamp ordering omits legacy documents whose timestamp field is
      // missing or invalid. Keep a separate bounded fallback lane so an
      // admin can still discover conversations represented only by legacy
      // records. The canonical index remains the primary/latest lane.
      void getDocs(query(chatMessagesRef, limit(CHAT_INDEX_LIMIT))).then((snapshot) => {
        if (disposed) return
        snapshot.forEach((docSnap) => {
          const message = mapChatDocument(docSnap)
          if (getChatTimestampMs(message.timestamp) === null) {
            legacyIndex.set(docSnap.id, message)
          }
        })
        publishConversationIndex()
        setIsChatLoaded(true)
        setIsChatLoading(false)
      }).catch((error) => {
        if (!disposed) console.warn("[Chat] Legacy conversation index unavailable", error)
      })
      return () => {
        disposed = true
        console.log("[Firestore Listener STOP] ChatConversationIndex")
        perfListener("Chat", "STOP")
        unsub()
      }
    }

    const conversationId = isAdminScope ? activeConversationId : currentUserId
    if (!conversationId) return

    console.log("[Firestore Listener START] Chat", { conversationId })
    const messagesQuery = query(
      chatMessagesRef,
      where("clientId", "==", conversationId),
      orderBy("timestamp", "asc"),
      limitToLast(CHAT_HISTORY_PAGE_SIZE),
    )
    const unsub = onSnapshot(messagesQuery, (snapshot) => {
      if (disposed || generation !== historyGenerationRef.current) return
      const nextLive = new Map<string, ChatMessageItem>()
      snapshot.forEach((docSnap) => nextLive.set(docSnap.id, mapChatDocument(docSnap)))
      liveMessagesRef.current = nextLive
      if (oldestTimestampCursorRef.current === null) {
        oldestTimestampCursorRef.current = snapshot.docs[0] || null
        hasMoreTimestampMessagesRef.current = snapshot.size >= CHAT_HISTORY_PAGE_SIZE
      } else if (snapshot.size >= CHAT_HISTORY_PAGE_SIZE) {
        hasMoreTimestampMessagesRef.current = true
      }
      publishActiveMessages()
      perfListener("Chat", "SNAPSHOT", snapshot.size)
      setIsChatLoading(false)
      setChatError(null)
      if (!initialLoadDone.current) {
        initialLoadDone.current = true
        setIsChatLoaded(true)
      }
      setHasOlderMessages(hasMoreTimestampMessagesRef.current || hasMoreLegacyMessagesRef.current)
    }, (error) => {
      if (disposed) return
      perfListener("Chat", "ERROR")
      console.error("[Chat snapshot error]", { code: error.code, message: error.message, error })
      setIsChatLoading(false)
      setChatError(error.code === "permission-denied"
        ? "Chat is not authorized for this account."
        : "Chat messages could not be loaded. Check your connection and retry.")
    })

    if (legacyCursorRef.current === null) {
      void fetchLegacyPage(conversationId, generation)
    }

    return () => {
      disposed = true
      console.log("[Firestore Listener STOP] Chat", { conversationId })
      perfListener("Chat", "STOP")
      unsub()
    }
  }, [activeConversationId, canAccessChat, currentUserId, currentUserRole, fetchLegacyPage, isMessagesActive, chatRetryAttempt, publishActiveMessages])

  const loadChat = useCallback((requestedClientId?: string) => {
    const nextConversationId = canAccessChat
      ? (requestedClientId || null)
      : (currentUserId || null)
    if (!nextConversationId && !canAccessChat) return
    clearActiveHistory()
    setActiveConversationId(nextConversationId)
    setIsChatLoading(true)
    setChatError(null)
    setIsMessagesActive(true)
  }, [canAccessChat, clearActiveHistory, currentUserId])

  const unloadChat = useCallback(() => {
    setIsMessagesActive(false)
    setIsChatLoaded(false)
    setActiveConversationId(null)
    setConversationIndex([])
    clearActiveHistory()
    setNewMessageNotifications([])
    setIsChatLoading(false)
    setChatError(null)
    initialLoadDone.current = false
  }, [clearActiveHistory])

  const retryChat = useCallback(() => {
    setIsChatLoading(true)
    setChatError(null)
    setUnreadError(null)
    setChatRetryAttempt((attempt) => attempt + 1)
  }, [])

  const loadOlderMessages = useCallback(async () => {
    if (!activeConversationId || isLoadingOlder || !hasOlderMessages) return
    const generation = historyGenerationRef.current
    setIsLoadingOlder(true)
    try {
      if (hasMoreTimestampMessagesRef.current && oldestTimestampCursorRef.current) {
        const olderQuery = query(
          chatMessagesRef,
          where("clientId", "==", activeConversationId),
          orderBy("timestamp", "asc"),
          endBefore(oldestTimestampCursorRef.current),
          limitToLast(CHAT_HISTORY_PAGE_SIZE),
        )
        const snapshot = await getDocs(olderQuery)
        if (generation !== historyGenerationRef.current) return
        if (snapshot.empty) {
          hasMoreTimestampMessagesRef.current = false
        } else {
          snapshot.forEach((docSnap) => {
            historicalMessagesRef.current.set(docSnap.id, mapChatDocument(docSnap))
          })
          oldestTimestampCursorRef.current = snapshot.docs[0] || oldestTimestampCursorRef.current
          hasMoreTimestampMessagesRef.current = snapshot.size >= CHAT_HISTORY_PAGE_SIZE
        }
      } else {
        hasMoreTimestampMessagesRef.current = false
      }

      if (hasMoreLegacyMessagesRef.current) {
        await fetchLegacyPage(activeConversationId, generation)
      }
      if (generation === historyGenerationRef.current) {
        publishActiveMessages()
        setHasOlderMessages(hasMoreTimestampMessagesRef.current || hasMoreLegacyMessagesRef.current)
      }
    } catch (error) {
      if (generation !== historyGenerationRef.current) return
      console.error("[Chat] Failed to load older messages", error)
      setChatError("Older messages could not be loaded. Retry and try again.")
    } finally {
      if (generation === historyGenerationRef.current) setIsLoadingOlder(false)
    }
  }, [activeConversationId, fetchLegacyPage, hasOlderMessages, isLoadingOlder, publishActiveMessages])

  const sendMessage: ChatContextValue["sendMessage"] = useCallback(
    async (text, senderRole, clientId, clientName, isBot = false, imageUrl) => {
      if (!text.trim() && !imageUrl) return

      const normalizedRole: ChatMessageItem["sender"] =
        senderRole === "user" ? "user" : senderRole === "bot" ? "bot" : senderRole

      if ((normalizedRole === "client" || normalizedRole === "user") && isBot) {
        throw new Error("Automated support messages must be sent by the trusted server.")
      }

      const resolvedClientId = clientId ?? user?.id ?? ""

      const messageData = {
        text: text.trim(),
        content: text.trim(),
        sender: normalizedRole,
        senderId: normalizedRole === "client" || normalizedRole === "user" ? resolvedClientId : "admin",
        senderName:
          normalizedRole === "client" || normalizedRole === "user"
            ? clientName || user?.name || "Guest"
            : "Admin",
        senderAvatar:
          normalizedRole === "client" || normalizedRole === "user"
            ? user?.profilePicture || ""
            : user?.profilePicture || "",
        clientId: resolvedClientId,
        clientName: clientName || null,
        clientProfilePicture:
          normalizedRole === "client" || normalizedRole === "user"
            ? user?.profilePicture || ""
            : "",
        targetId:
          normalizedRole === "client" || normalizedRole === "user" ? "admin" : resolvedClientId,
        recipientId:
          normalizedRole === "client" || normalizedRole === "user" ? "admin" : resolvedClientId,
        timestamp: serverTimestamp(),
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        imageUrl: imageUrl || null,
        isRead: normalizedRole === "admin",
        isReadByClient: normalizedRole === "client" || normalizedRole === "user",
        read: false,
        isBot: isBot,
      }

      const savedMessage = await addDoc(chatMessagesRef, messageData)

      if (normalizedRole === "user" || normalizedRole === "client") {
        setNewMessageNotifications((notif) => notif.includes(savedMessage.id) ? notif : [...notif, savedMessage.id])
      }
    },
    [user]
  )

  const predefinedRequestKeys = useRef(new Map<string, string>())
  const predefinedRequests = useRef(new Map<string, Promise<void>>())
  useEffect(() => {
    predefinedRequestKeys.current.clear()
    predefinedRequests.current.clear()
  }, [scope])
  const sendPredefinedQuestion: ChatContextValue["sendPredefinedQuestion"] = useCallback((questionId) => {
    if (!user || user.role !== "client") return Promise.reject(new Error("Authentication is required."))
    const existingRequest = predefinedRequests.current.get(questionId)
    if (existingRequest) return existingRequest

    const existingKey = predefinedRequestKeys.current.get(questionId)
    const idempotencyKey = existingKey || (
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `suggestion-${crypto.randomUUID()}`
        : `suggestion-${Date.now()}-${Math.random().toString(16).slice(2)}`
    )
    predefinedRequestKeys.current.set(questionId, idempotencyKey)

    const request = (async () => {
      const headers = await getAuthHeaders(true)
      const response = await fetch("/api/chat-suggestions/answer", {
        method: "POST",
        headers,
        body: JSON.stringify({ questionId, idempotencyKey }),
      })
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The selected question could not be sent.")
      predefinedRequestKeys.current.delete(questionId)
    })()

    predefinedRequests.current.set(questionId, request)
    void request.then(() => {
      if (predefinedRequests.current.get(questionId) === request) predefinedRequests.current.delete(questionId)
    }, () => {
      if (predefinedRequests.current.get(questionId) === request) predefinedRequests.current.delete(questionId)
    })
    return request
  }, [user])

  const markAsRead = useCallback(async (clientId: string) => {
    if (!user || (user.role === "client" && clientId !== user.id) || (user.role === "staff" && user.permissions?.chat !== true)) return
    const previousMessages = messagesStateRef.current
    setMessages((prev) =>
      prev.map((m) =>
        m.clientId === clientId && m.sender === "client"
          ? { ...m, isRead: true }
          : m
      )
    )
    try {
      await markUnreadMessagesInPages([
        where("clientId", "==", clientId),
        where("sender", "==", "client"),
        where("isRead", "==", false),
      ], "isRead")
    } catch (error) {
      console.error("[Chat] Failed to mark admin messages as read", error)
      setMessages(previousMessages)
      setChatError("Messages could not be marked as read. Retry chat loading to try again.")
    }
  }, [user])

  const markAsReadByClient = useCallback(async (clientId: string) => {
    if (!user || user.role !== "client" || clientId !== user.id) return
    const previousMessages = messagesStateRef.current
    setMessages((prev) =>
      prev.map((m) =>
        m.clientId === clientId && m.sender === "admin"
          ? { ...m, isReadByClient: true }
          : m
      )
    )
    try {
      await markUnreadMessagesInPages([
        where("clientId", "==", clientId),
        where("sender", "==", "admin"),
        where("isReadByClient", "==", false),
      ], "isReadByClient")
    } catch (error) {
      console.error("[Chat] Failed to mark client messages as read", error)
      setMessages(previousMessages)
      setChatError("Messages could not be marked as read. Retry chat loading to try again.")
    }
  }, [user])

  const markAdminAsRead = useCallback(() => {
    setNewMessageNotifications([])
  }, [])

  const toggleChat = useCallback(() => {
    setIsOpen((v) => !v)
  }, [])

  const startTyping = useCallback((userId: string) => {
    setTypingIndicators((prev) => {
      const next = prev.filter((t) => t.userId !== userId)
      return [...next, { userId, isTyping: true }]
    })
  }, [])

  const stopTyping = useCallback((userId: string) => {
    setTypingIndicators((prev) => prev.filter((t) => t.userId !== userId))
  }, [])

  const getChatHistory = useCallback(() => messages, [messages])

  const getUnreadCount = useCallback(
    () => messages.filter((m) => (m.sender === "user" || m.sender === "client") && !m.isRead).length,
    [messages]
  )

  const clearNotifications = useCallback(() => setNewMessageNotifications([]), [])

  const value = useMemo<ChatContextValue>(
    () => ({
      messages: scopeIsCurrent ? messages : [],
      conversationIndex: scopeIsCurrent ? conversationIndex : [],
      activeConversationId: scopeIsCurrent ? activeConversationId : null,
      typingIndicators: scopeIsCurrent ? typingIndicators : [],
      userStatuses: scopeIsCurrent ? userStatuses : {},
       isConnected: !chatError && !unreadError,
      isOpen,
       currentClientId,
       isChatLoaded: scopeIsCurrent && isChatLoaded,
       isChatLoading: scopeIsCurrent && isChatLoading,
       chatError: scopeIsCurrent ? chatError : null,
       unreadError: scopeIsCurrent ? unreadError : null,
      newMessageNotifications: scopeIsCurrent ? newMessageNotifications : [],
      unreadMessages: scopeIsCurrent ? unreadMessages : 0,
      unreadMessagesIsBounded: scopeIsCurrent && unreadMessagesIsBounded,
      hasOlderMessages: scopeIsCurrent && hasOlderMessages,
      isLoadingOlder: scopeIsCurrent && isLoadingOlder,
      loadChat,
      loadOlderMessages,
      unloadChat,
      sendMessage,
      sendPredefinedQuestion,
      markAsRead,
      markAsReadByClient,
      markAdminAsRead,
      toggleChat,
      startTyping,
      stopTyping,
      getChatHistory: scopeIsCurrent ? getChatHistory : () => [],
       getUnreadCount: scopeIsCurrent ? getUnreadCount : () => 0,
       clearNotifications,
       retryChat,
    }),
    [
      messages,
      conversationIndex,
      activeConversationId,
      scopeIsCurrent,
      typingIndicators,
      userStatuses,
      isOpen,
       currentClientId,
       isChatLoaded,
       isChatLoading,
       chatError,
       unreadError,
      newMessageNotifications,
      unreadMessages,
      unreadMessagesIsBounded,
      hasOlderMessages,
      isLoadingOlder,
      loadChat,
      loadOlderMessages,
      unloadChat,
      sendMessage,
      sendPredefinedQuestion,
      markAsRead,
      markAsReadByClient,
      markAdminAsRead,
      toggleChat,
      startTyping,
      stopTyping,
      getChatHistory,
       getUnreadCount,
       clearNotifications,
       retryChat,
    ]
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export const useChat = () => {
  const context = useContext(ChatContext)
  if (!context) throw new Error("useChat must be used within a ChatProvider")
  return context
}
