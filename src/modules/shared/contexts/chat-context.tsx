"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "../auth/auth-context"
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
const messagesQuery = query(messagesRef, orderBy("timestamp", "asc"), limit(500))

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [isChatLoaded, setIsChatLoaded] = useState(false)
  const [typingIndicators, setTypingIndicators] = useState<TypingIndicator[]>([])
  const [userStatuses, setUserStatuses] = useState<Record<string, UserStatus>>({})
  const [isOpen, setIsOpen] = useState(false)
  const [newMessageNotifications, setNewMessageNotifications] = useState<string[]>([])
  const initialLoadDone = useRef(false)

  const currentClientId = user?.id ?? null

  useEffect(() => {
    if (!user) return
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
          clientId: data.clientId,
          clientName: data.clientName,
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
      if (!initialLoadDone.current) {
        initialLoadDone.current = true
        setIsChatLoaded(true)
      }
    }, (error) => {
      console.error("[ChatContext] Firestore snapshot error:", error)
    })

    return () => unsub()
  }, [user])

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
        clientId: resolvedClientId,
        clientName: clientName || null,
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
  }, [])

  const markAsReadByClient = useCallback(async (clientId: string) => {
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
  }, [])

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

