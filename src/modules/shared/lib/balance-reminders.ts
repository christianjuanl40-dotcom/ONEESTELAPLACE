import { toValidDate, formatManilaDateTime } from "./time-format"

/** Repeat reminders are intentional only after this window, never on retries. */
export const BALANCE_REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000

export interface BalanceReminderDelivery {
  status: "created" | "already_sent" | "cooldown"
  notificationId: string | null
  notificationPersisted: boolean
  nextAllowedAt: string
}

export function getNextBalanceReminderAt(sentAt: unknown): number | null {
  const date = toValidDate(sentAt)
  return date ? date.getTime() + BALANCE_REMINDER_COOLDOWN_MS : null
}

export function getBalanceReminderFeedback(delivery: BalanceReminderDelivery) {
  if (delivery.status === "created") return {
    title: "Balance Reminder Saved",
    description: "The reminder is saved in the client's notifications. Client display and email delivery are not confirmed.",
  }
  return {
    title: delivery.status === "already_sent"
      ? delivery.notificationPersisted ? "Reminder Already Saved" : "Reminder Previously Recorded"
      : "Reminder Not Repeated",
    description: `${delivery.notificationPersisted ? "The saved reminder remains in the client's notifications." : "A prior reminder was recorded; its notification delivery is unconfirmed."} No duplicate was sent. A new reminder is available after ${formatManilaDateTime(delivery.nextAllowedAt)}.`,
  }
}
