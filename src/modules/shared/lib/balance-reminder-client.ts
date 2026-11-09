import type { BalanceReminderDelivery } from "./balance-reminders"

/** Coalesce clicks and retain the same key after an ambiguous response. */
export function createBalanceReminderClient<T>(options: {
  headers: () => Promise<Record<string, string>>
  fetch?: typeof fetch
  key?: () => string
}) {
  const requests = new Map<string, Promise<{ booking: T; reminder: BalanceReminderDelivery }>>()
  const retryKeys = new Map<string, string>()
  return (bookingId: string) => {
    const active = requests.get(bookingId)
    if (active) return active
    const idempotencyKey = retryKeys.get(bookingId) || (options.key?.() ?? crypto.randomUUID())
    retryKeys.set(bookingId, idempotencyKey)
    const request = (async () => {
      const response = await (options.fetch ?? fetch)("/api/bookings/lifecycle", {
        method: "POST", headers: await options.headers(),
        body: JSON.stringify({ action: "balance_reminder", bookingId, idempotencyKey }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "The reminder could not be saved. Retry to check the same request.")
      if (payload?.booking?.id !== bookingId || !payload?.reminder || !["created", "already_sent", "cooldown"].includes(payload.reminder.status)
        || typeof payload.reminder.notificationPersisted !== "boolean" || !Number.isFinite(Date.parse(payload.reminder.nextAllowedAt))) {
        throw new Error("The reminder response was incomplete. Retry to check the same request.")
      }
      retryKeys.delete(bookingId)
      return payload as { booking: T; reminder: BalanceReminderDelivery }
    })()
    requests.set(bookingId, request)
    void request.finally(() => { if (requests.get(bookingId) === request) requests.delete(bookingId) }).catch(() => {})
    return request
  }
}
