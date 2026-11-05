import { getManilaDateKey, toValidDate, type TimestampLike } from "./time-format"

export type ChatPresentationMessage = {
  id?: string
  firestoreId?: string
  sender?: string
  senderId?: string
  clientId?: string
  timestamp?: TimestampLike
}

export function getChatTimestampMs(value: TimestampLike): number | null {
  const date = toValidDate(value)
  return date ? date.getTime() : null
}

export function getChatMessageId(message: ChatPresentationMessage): string | null {
  const id = message.id || message.firestoreId
  return id ? String(id) : null
}

/**
 * Firestore snapshots are already ordered by timestamp, but local writes and
 * legacy records can still produce equal/missing values. Keep the first copy
 * of each stable document id and retain input order for equal timestamps.
 */
export function sortChatMessages<T extends ChatPresentationMessage>(messages: T[]): T[] {
  const seenIds = new Set<string>()
  return messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => {
      const id = getChatMessageId(message)
      if (!id) return true
      if (seenIds.has(id)) return false
      seenIds.add(id)
      return true
    })
    .sort((a, b) => {
      const aTime = getChatTimestampMs(a.message.timestamp)
      const bTime = getChatTimestampMs(b.message.timestamp)
      if (aTime === null && bTime !== null) return 1
      if (aTime !== null && bTime === null) return -1
      if (aTime !== null && bTime !== null && aTime !== bTime) return aTime - bTime
      return a.index - b.index
    })
    .map(({ message }) => message)
}

export function getChatSenderKey(message: ChatPresentationMessage): string {
  return message.senderId
    ? `id:${message.senderId}`
    : `role:${message.sender || "unknown"}|client:${message.clientId || ""}`
}

export function shouldGroupChatMessage(
  previous: ChatPresentationMessage | undefined,
  current: ChatPresentationMessage,
): boolean {
  if (!previous) return false
  return getChatSenderKey(previous) === getChatSenderKey(current)
    && getManilaDateKey(previous.timestamp) === getManilaDateKey(current.timestamp)
}
