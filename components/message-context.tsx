"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type React from "react"

const STORAGE_KEY = "oneestela_contact_messages_v1"

export interface ContactMessage {
  id: string
  name: string
  email: string
  phone?: string
  eventType?: string
  eventDate?: string
  message: string
  createdAt: string
  read: boolean
}

interface NewContactMessageInput {
  name: string
  email: string
  phone?: string
  eventType?: string
  eventDate?: string
  message: string
}

interface MessageContextValue {
  messages: ContactMessage[]
  addMessage: (input: NewContactMessageInput) => ContactMessage
  markAsRead: (id: string) => void
  markAllAsRead: () => void
  removeMessage: (id: string) => void
  clearAll: () => void
  unreadCount: number
}

const MessageContext = createContext<MessageContextValue | undefined>(undefined)

function readStored(): ContactMessage[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ContactMessage[]) : []
  } catch {
    return []
  }
}

function writeStored(messages: ContactMessage[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch {
    // ignore storage failures
  }
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function MessageProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ContactMessage[]>([])

  useEffect(() => {
    setMessages(readStored())
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setMessages(readStored())
      }
    }
    window.addEventListener("storage", handler)
    return () => window.removeEventListener("storage", handler)
  }, [])

  const addMessage = useCallback((input: NewContactMessageInput) => {
    const entry: ContactMessage = {
      id: makeId(),
      name: input.name?.trim() || "Anonymous",
      email: input.email?.trim() || "",
      phone: input.phone?.trim() || undefined,
      eventType: input.eventType?.trim() || undefined,
      eventDate: input.eventDate?.trim() || undefined,
      message: input.message?.trim() || "",
      createdAt: new Date().toISOString(),
      read: false,
    }
    setMessages((current) => {
      const next = [entry, ...current]
      writeStored(next)
      return next
    })
    return entry
  }, [])

  const markAsRead = useCallback((id: string) => {
    setMessages((current) => {
      const next = current.map((msg) => (msg.id === id ? { ...msg, read: true } : msg))
      writeStored(next)
      return next
    })
  }, [])

  const markAllAsRead = useCallback(() => {
    setMessages((current) => {
      const next = current.map((msg) => ({ ...msg, read: true }))
      writeStored(next)
      return next
    })
  }, [])

  const removeMessage = useCallback((id: string) => {
    setMessages((current) => {
      const next = current.filter((msg) => msg.id !== id)
      writeStored(next)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setMessages([])
    writeStored([])
  }, [])

  const unreadCount = useMemo(() => messages.filter((msg) => !msg.read).length, [messages])

  const value = useMemo<MessageContextValue>(
    () => ({
      messages,
      addMessage,
      markAsRead,
      markAllAsRead,
      removeMessage,
      clearAll,
      unreadCount,
    }),
    [messages, addMessage, markAsRead, markAllAsRead, removeMessage, clearAll, unreadCount]
  )

  return <MessageContext.Provider value={value}>{children}</MessageContext.Provider>
}

export function useMessages(): MessageContextValue {
  const ctx = useContext(MessageContext)
  if (!ctx) {
    throw new Error("useMessages must be used within a MessageProvider")
  }
  return ctx
}
