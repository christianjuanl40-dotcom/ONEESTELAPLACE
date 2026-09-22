export const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000

export function isPaymentWindowExpired(
  createdAt: unknown,
  now = Date.now(),
): boolean {
  const dateValue = createdAt && typeof createdAt === "object" && "toDate" in createdAt && typeof createdAt.toDate === "function"
    ? createdAt.toDate()
    : createdAt
  const timestamp = dateValue instanceof Date
    ? dateValue.getTime()
    : new Date(String(dateValue || "")).getTime()

  return Number.isFinite(timestamp) && now - timestamp >= PAYMENT_WINDOW_MS
}
