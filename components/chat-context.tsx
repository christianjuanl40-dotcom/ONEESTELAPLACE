"use client"

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react"
import type React from "react"
import { useAuth } from "@/src/modules/shared/auth/auth-context"

export interface ChatMessageItem {
  id: string
  text?: string
  content?: string
  sender: "user" | "admin" | "bot" | "client"
  senderId?: string
  senderName?: string
  senderAvatar?: string
  recipientId?: string
  targetId?: string
  timestamp: string | number | Date
  imageUrl?: string | null
  isRead?: boolean
  isReadByClient?: boolean
  read?: boolean
  followUps?: string[]
  escalated?: boolean
}

export interface TypingIndicator {
  userId: string
  userName?: string
  isTyping: boolean
  startedAt?: number
}

export interface UserStatus {
  isOnline: boolean
  lastSeen?: string
}

export interface ChatContextValue {
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
    senderRole?: string,
    clientId?: string,
    isBot?: boolean,
    imageUrl?: string
  ) => void
  markAsRead: (clientId: string, messageId?: string) => void
  markAsReadByClient: (clientId: string) => void
  markAdminAsRead: () => void
  toggleChat: () => void
  startTyping: () => void
  stopTyping: () => void
  getChatHistory: (userId?: string) => ChatMessageItem[]
  getUnreadCount: (userId?: string) => number
  clearNotifications: () => void
}

const STORAGE_KEY = "mock_chat_messages"

const ChatContext = createContext<ChatContextValue | null>(null)

function readStored(): ChatMessageItem[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ChatMessageItem[]) : []
  } catch {
    return []
  }
}

function writeStored(messages: ChatMessageItem[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch {
    // ignore
  }
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const [isChatLoaded, setIsChatLoaded] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [typingIndicators, setTypingIndicators] = useState<TypingIndicator[]>([])
  const [userStatuses] = useState<Record<string, UserStatus>>({})
  const [newMessageNotifications, setNewMessageNotifications] = useState<string[]>([])

  useEffect(() => {
    setMessages(readStored())
    setIsChatLoaded(true)

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setMessages(JSON.parse(e.newValue))
        } catch {
          // ignore
        }
      }
    }

    window.addEventListener("storage", handleStorageChange)
    return () => window.removeEventListener("storage", handleStorageChange)
  }, [])

  const currentClientId = user?.id ?? "guest"

  const sendMessage: ChatContextValue["sendMessage"] = useCallback(
    (text, senderRole = "user", clientId, _isBot = false, imageUrl) => {
      if (!text?.trim() && !imageUrl) return

      const normalizedRole = (senderRole === "client" ? "user" : senderRole) as ChatMessageItem["sender"]
      const senderId = (senderRole === "admin" ? "admin" : user?.id) || "anonymous"
      const targetId = clientId ?? user?.id ?? "admin"
      const newMessage: ChatMessageItem = {
        id: makeId(),
        text: text || "",
        content: text || "",
        sender: normalizedRole,
        senderId: senderId,
        senderName: user?.name ?? (senderRole === "admin" ? "Admin" : "Guest"),
        targetId: senderRole === "admin" ? targetId : "admin",
        recipientId: senderRole === "admin" ? targetId : "admin",
        timestamp: new Date().toISOString(),
        imageUrl: imageUrl || null,
        isRead: senderRole === "admin",
        isReadByClient: senderRole === "client" || senderRole === "user",
        read: false,
      }

      setMessages((prev) => {
        const updated = [...prev, newMessage]
        writeStored(updated)
        if (senderRole === "user" || senderRole === "client") {
          setNewMessageNotifications((notif) => [...notif, newMessage.id])
        }
        return updated
      })
    },
    [user]
  )

  const markAsRead: ChatContextValue["markAsRead"] = useCallback((clientId) => {
    setMessages((prev) => {
      const updated = prev.map((m) =>
        m.senderId === clientId || m.sender === "user" || m.sender === "client"
          ? { ...m, isRead: true }
          : m
      )
      writeStored(updated)
      return updated
    })
  }, [])

  const markAsReadByClient: ChatContextValue["markAsReadByClient"] = useCallback(() => {
    setMessages((prev) => {
      const updated = prev.map((m) => (m.sender === "admin" ? { ...m, isReadByClient: true } : m))
      writeStored(updated)
      return updated
    })
  }, [])

  const markAdminAsRead: ChatContextValue["markAdminAsRead"] = useCallback(() => {
    setMessages((prev) => {
      const updated = prev.map((m) => (m.sender === "admin" ? { ...m, isReadByClient: true } : m))
      writeStored(updated)
      return updated
    })
  }, [])

  const toggleChat: ChatContextValue["toggleChat"] = useCallback(() => {
    setIsOpen((current) => !current)
  }, [])

  const startTyping: ChatContextValue["startTyping"] = useCallback(() => {
    if (!user) return
    setTypingIndicators((current) => {
      const filtered = current.filter((t) => t.userId !== user.id)
      return [...filtered, { userId: user.id, userName: user.name, isTyping: true, startedAt: Date.now() }]
    })
  }, [user])

  const stopTyping: ChatContextValue["stopTyping"] = useCallback(() => {
    if (!user) return
    setTypingIndicators((current) => current.filter((t) => t.userId !== user.id))
  }, [user])

  const getChatHistory: ChatContextValue["getChatHistory"] = useCallback(
    (userId) => {
      if (!userId) return messages
      return messages.filter(
        (m) => m.senderId === userId || m.targetId === userId
      )
    },
    [messages]
  )

  const getUnreadCount: ChatContextValue["getUnreadCount"] = useCallback(
    (userId) => {
      return messages.filter((m) => {
        if (m.sender === "admin" && m.isReadByClient) return false
        if ((m.sender === "user" || m.sender === "client") && m.isRead) return false
        if (userId && m.senderId !== userId && m.targetId !== userId) return false
        return true
      }).length
    },
    [messages]
  )

  const clearNotifications: ChatContextValue["clearNotifications"] = useCallback(() => {
    setNewMessageNotifications([])
  }, [])

  const value: ChatContextValue = useMemo(
    () => ({
      messages,
      typingIndicators,
      userStatuses,
      isConnected: typeof window !== "undefined",
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

export function useChat(): ChatContextValue {
  const context = useContext(ChatContext)
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider")
  }
  return context
}
