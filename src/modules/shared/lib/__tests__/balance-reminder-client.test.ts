import { describe, expect, it, vi } from "vitest"
import { createBalanceReminderClient } from "../balance-reminder-client"
import { getBalanceReminderFeedback, getNextBalanceReminderAt } from "../balance-reminders"

const reminder = { status: "created" as const, notificationId: "notification", notificationPersisted: true, nextAllowedAt: "2099-01-02T00:00:00Z" }
describe("balance reminder retry and feedback", () => {
  it("coalesces repeated clicks and reuses the original key after a lost response", async () => {
    const calls: string[] = []
    const transport = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
      calls.push(JSON.parse(String(init?.body)).idempotencyKey)
      if (calls.length === 1) throw new Error("Lost response after commit")
      return Response.json({ booking: { id: "BOOKING" }, reminder: { ...reminder, status: "already_sent" } })
    })
    const key = vi.fn(() => "same-key")
    const send = createBalanceReminderClient({ headers: async () => ({}), fetch: transport as typeof fetch, key })
    const first = send("BOOKING")
    expect(send("BOOKING")).toBe(first)
    await expect(first).rejects.toThrow("Lost response")
    expect((await send("BOOKING")).reminder.status).toBe("already_sent")
    expect(calls).toEqual(["same-key", "same-key"])
    expect(key).toHaveBeenCalledTimes(1)
  })

  it("does not report malformed successful responses or denied requests as sent", async () => {
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ changed: true }))
      .mockResolvedValueOnce(Response.json({ error: "Not authorized" }, { status: 403 }))
    const send = createBalanceReminderClient({ headers: async () => ({}), fetch: transport, key: () => "retry" })
    await expect(send("BOOKING")).rejects.toThrow("incomplete")
    await expect(send("BOOKING")).rejects.toThrow("Not authorized")
  })

  it("distinguishes system persistence from display/email delivery and suppression", () => {
    expect(getBalanceReminderFeedback(reminder).description).toContain("not confirmed")
    expect(getBalanceReminderFeedback({ ...reminder, status: "cooldown", notificationPersisted: false }).description).toContain("delivery is unconfirmed")
    expect(getBalanceReminderFeedback({ ...reminder, status: "already_sent" }).description).toContain("No duplicate")
    expect(getBalanceReminderFeedback({ ...reminder, status: "already_sent", notificationPersisted: false }).title).toBe("Reminder Previously Recorded")
    expect(getNextBalanceReminderAt("2026-11-09T00:00:00Z")).toBe(Date.parse("2026-11-10T00:00:00Z"))
    expect(getNextBalanceReminderAt(undefined)).toBeNull()
  })
})
