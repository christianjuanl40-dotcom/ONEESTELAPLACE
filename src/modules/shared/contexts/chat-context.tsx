"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "../auth/auth-context"
import { perfListener } from "../lib/perf-trace"
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
  getDocs,
} from "firebase/firestore"

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
  typingIndicators: TypingIndicator[]
  userStatuses: Record<string, UserStatus>
  isConnected: boolean
  isOpen: boolean
  currentClientId: string | null
  isChatLoaded: boolean
  newMessageNotifications: string[]
  unreadMessages: number
  loadChat: () => void
  unloadChat: () => void
  sendMessage: (
    text: string,
    senderRole: "admin" | "client" | "user" | "bot",
    clientId?: string,
    clientName?: string,
    isBot?: boolean,
    imageUrl?: string
  ) => void
  markAsRead: (clientId: string) => void
  markAsReadByClient: (clientId: string) => void
  markAdminAsRead: () => void
  toggleChat: () => void
  startTyping: (userId: string) => void
  stopTyping: (userId: string) => void
  getChatHistory: () => ChatMessageItem[]
  getUnreadCount: () => number
  clearNotifications: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)
const messagesRef = collection(db, "chatMessages")

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [isChatLoaded, setIsChatLoaded] = useState(false)
  const [typingIndicators, setTypingIndicators] = useState<TypingIndicator[]>([])
  const [userStatuses, setUserStatuses] = useState<Record<string, UserStatus>>({})
  const [isOpen, setIsOpen] = useState(false)
  const [newMessageNotifications, setNewMessageNotifications] = useState<string[]>([])
  const [isMessagesActive, setIsMessagesActive] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const initialLoadDone = useRef(false)

  const currentClientId = user?.id ?? null
  const currentUserId = user?.id
  const currentUserRole = user?.role
  const canAccessChat = currentUserRole === "admin" || (
    currentUserRole === "staff" && user?.permissions?.chat === true
  )

  useEffect(() => {
    setMessages([])
    setIsChatLoaded(false)
    setIsMessagesActive(false)
    setTypingIndicators([])
    setUserStatuses({})
    setNewMessageNotifications([])
    setUnreadMessages(0)
    initialLoadDone.current = false
  }, [currentUserId, currentUserRole, canAccessChat])

  // Lightweight scoped unread listener (always on while signed in).
  // Powers the chat badges WITHOUT loading the full conversation.
  useEffect(() => {
    if (!currentUserId || !currentUserRole) return
    const isAdminScope = canAccessChat
    if (currentUserRole === "staff" && !isAdminScope) {
      return
    }
    const unreadQuery = isAdminScope
      ? query(messagesRef, where("sender", "==", "client"), where("isRead", "==", false), limit(500))
      : query(
          messagesRef,
          where("clientId", "==", currentUserId),
          where("sender", "==", "admin"),
          where("isReadByClient", "==", false),
          limit(500),
        )
    console.log("[Firestore Listener START] ChatUnread", isAdminScope ? "(admin scope)" : `(client: ${currentUserId})`)
    perfListener("ChatUnread", "START")
    const unsub = onSnapshot(
      unreadQuery,
      (snapshot) => {
        perfListener("ChatUnread", "FIRST_SNAPSHOT", snapshot.size)
        setUnreadMessages(snapshot.size)
      },
      (error) => {
        perfListener("ChatUnread", "ERROR")
        console.error("[ChatUnread snapshot error]", { code: error.code, message: error.message, error })
        setUnreadMessages(0)
      },
    )
    return () => {
      console.log("[Firestore Listener STOP] ChatUnread")
      perfListener("ChatUnread", "STOP")
      unsub()
    }
  }, [currentUserId, currentUserRole, canAccessChat])

  // Full conversation listener — lazy. Only starts when a chat surface is
  // opened (widget open, /portal/chat, /dashboard/chat) via loadChat().
  useEffect(() => {
    if (!currentUserId || !currentUserRole || !isMessagesActive) return
    const isAdminScope = canAccessChat
    if (currentUserRole === "staff" && !isAdminScope) return
    console.log("[Firestore Listener START] Chat")
    perfListener("Chat", "START")
    const messagesQuery = isAdminScope
      ? query(messagesRef, orderBy("timestamp", "asc"), limit(500))
      : query(messagesRef, where("clientId", "==", currentUserId), orderBy("timestamp", "asc"), limit(500))
    const unsub = onSnapshot(messagesQuery, (snapshot) => {
      const loaded: ChatMessageItem[] = []
      snapshot.forEach((docSnap) => {
        const data = docSnap.data()
        loaded.push({
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
          timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp || new Date().toISOString(),
          time: data.time,
          imageUrl: data.imageUrl || null,
          isRead: data.isRead ?? false,
          isReadByClient: data.isReadByClient ?? false,
          read: data.read ?? false,
          isBot: data.isBot ?? false,
          followUps: data.followUps,
          escalated: data.escalated,
        })
      })
      setMessages(loaded)
      perfListener("Chat", "FIRST_SNAPSHOT", loaded.length)
      if (!initialLoadDone.current) {
        initialLoadDone.current = true
        setIsChatLoaded(true)
      }
    }, (error) => {
      perfListener("Chat", "ERROR")
      console.error("[Chat snapshot error]", { code: error.code, message: error.message, error })
    })

    return () => {
      console.log("[Firestore Listener STOP] Chat")
      perfListener("Chat", "STOP")
      unsub()
    }
  }, [currentUserId, currentUserRole, canAccessChat, isMessagesActive])

  const loadChat = useCallback(() => {
    setIsMessagesActive(true)
  }, [])

  const unloadChat = useCallback(() => {
    setIsMessagesActive(false)
    setIsChatLoaded(false)
    setMessages([])
    setNewMessageNotifications([])
    initialLoadDone.current = false
  }, [])

  const sendMessage: ChatContextValue["sendMessage"] = useCallback(
    async (text, senderRole, clientId, clientName, isBot = false, imageUrl) => {
      if (!text.trim() && !imageUrl) return

      const normalizedRole: ChatMessageItem["sender"] =
        senderRole === "user" ? "user" : senderRole === "bot" ? "bot" : senderRole

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

      await addDoc(messagesRef, messageData)

      if (normalizedRole === "user" || normalizedRole === "client") {
        setNewMessageNotifications((notif) => [...notif, String(Date.now())])
      }
    },
    [user]
  )

  const markAsRead = useCallback(async (clientId: string) => {
    if (!user || (user.role === "client" && clientId !== user.id) || (user.role === "staff" && user.permissions?.chat !== true)) return
    setMessages((prev) =>
      prev.map((m) =>
        m.clientId === clientId && m.sender === "client"
          ? { ...m, isRead: true }
          : m
      )
    )
    const q = query(
      messagesRef,
      where("clientId", "==", clientId),
      where("sender", "==", "client"),
      where("isRead", "==", false)
    )
    const snapshot = await getDocs(q)
    const updates: Promise<void>[] = []
    snapshot.forEach((docSnap) => {
      updates.push(updateDoc(doc(db, "chatMessages", docSnap.id), { isRead: true }))
    })
    await Promise.all(updates)
  }, [user])

  const markAsReadByClient = useCallback(async (clientId: string) => {
    if (!user || user.role !== "client" || clientId !== user.id) return
    setMessages((prev) =>
      prev.map((m) =>
        m.clientId === clientId && m.sender === "admin"
          ? { ...m, isReadByClient: true }
          : m
      )
    )
    const q = query(
      messagesRef,
      where("clientId", "==", clientId),
      where("sender", "==", "admin"),
      where("isReadByClient", "==", false)
    )
    const snapshot = await getDocs(q)
    const updates: Promise<void>[] = []
    snapshot.forEach((docSnap) => {
      updates.push(updateDoc(doc(db, "chatMessages", docSnap.id), { isReadByClient: true }))
    })
    await Promise.all(updates)
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
      messages,
      typingIndicators,
      userStatuses,
      isConnected: true,
      isOpen,
      currentClientId,
      isChatLoaded,
      newMessageNotifications,
      unreadMessages,
      loadChat,
      unloadChat,
      sendMessage,
      markAsRead,
      markAsReadByClient,
      markAdminAsRead,
      toggleChat,
      startTyping,
      stopTyping,
      getChatHistory,
      getUnreadCount,
      clearNotifications,
    }),
    [
      messages,
      typingIndicators,
      userStatuses,
      isOpen,
      currentClientId,
      isChatLoaded,
      newMessageNotifications,
      unreadMessages,
      loadChat,
      unloadChat,
      sendMessage,
      markAsRead,
      markAsReadByClient,
      markAdminAsRead,
      toggleChat,
      startTyping,
      stopTyping,
      getChatHistory,
      getUnreadCount,
      clearNotifications,
    ]
  )

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export const useChat = () => {
  const context = useContext(ChatContext)
  if (!context) throw new Error("useChat must be used within a ChatProvider")
  return context
}
