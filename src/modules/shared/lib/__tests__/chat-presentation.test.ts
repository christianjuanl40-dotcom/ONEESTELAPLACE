import { describe, expect, it } from "vitest"
import {
  getChatTimestampMs,
  shouldGroupChatMessage,
  sortChatMessages,
} from "../chat-presentation"
import {
  formatManilaDateTime,
  formatManilaDayLabel,
  formatManilaTime,
  isSameManilaDay,
} from "../time-format"

describe("chat presentation helpers", () => {
  it("deduplicates stable message ids and preserves equal-timestamp order", () => {
    const messages = sortChatMessages([
      { id: "message-b", sender: "client", timestamp: "2026-05-15T01:00:00.000Z" },
      { id: "message-a", sender: "client", timestamp: "2026-05-15T01:00:00.000Z" },
      { id: "message-b", sender: "client", timestamp: "2026-05-15T01:01:00.000Z" },
      { id: "missing-time", sender: "client", timestamp: null },
    ])

    expect(messages.map((message) => message.id)).toEqual(["message-b", "message-a", "missing-time"])
  })

  it("uses Manila calendar days for grouping and separators", () => {
    const earlyMorning = "2026-05-14T16:30:00.000Z" // May 15, 00:30 Manila
    const sameManilaDay = "2026-05-15T01:00:00.000Z" // May 15, 09:00 Manila
    const nextManilaDay = "2026-05-15T16:00:00.000Z" // May 16, 00:00 Manila

    expect(isSameManilaDay(earlyMorning, sameManilaDay)).toBe(true)
    expect(isSameManilaDay(sameManilaDay, nextManilaDay)).toBe(false)
    expect(shouldGroupChatMessage(
      { sender: "admin", senderId: "admin", timestamp: earlyMorning },
      { sender: "admin", senderId: "admin", timestamp: sameManilaDay },
    )).toBe(true)
    expect(shouldGroupChatMessage(
      { sender: "admin", senderId: "admin", timestamp: sameManilaDay },
      { sender: "client", senderId: "client", timestamp: sameManilaDay },
    )).toBe(false)
    expect(formatManilaDayLabel(earlyMorning, sameManilaDay)).toBe("Today")
  })

  it("formats canonical timestamps and leaves missing timestamps blank", () => {
    const timestamp = "2026-05-15T04:05:00.000Z" // May 15, 12:05 PM Manila
    expect(formatManilaTime(timestamp)).toMatch(/12:05\s*PM/i)
    expect(formatManilaDateTime(timestamp)).toMatch(/May 15, 2026.*12:05\s*PM/i)
    expect(getChatTimestampMs(timestamp)).toBe(Date.parse(timestamp))
    expect(formatManilaTime(null)).toBeNull()
    expect(formatManilaDateTime(undefined)).toBeNull()
    expect(formatManilaDayLabel(undefined)).toBeNull()
  })
})
