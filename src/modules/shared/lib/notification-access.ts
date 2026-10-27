import type { NotificationType } from "./notifications"
import type { StaffPermissions } from "../types/permissions"

export const ADMIN_BOOKING_NOTIFICATION_TYPES = [
  "booking_submitted",
  "cancellation_requested",
  "modification_requested",
] as const satisfies readonly NotificationType[]

export const ADMIN_PAYMENT_NOTIFICATION_TYPES = [
  "payment_submitted",
  "remaining_balance_submitted",
] as const satisfies readonly NotificationType[]

export function getAdminNotificationTypes(
  role: string | undefined,
  permissions?: Partial<Pick<StaffPermissions, "dashboard" | "bookings" | "payments">>,
): readonly NotificationType[] | null {
  if (role === "admin") return null
  if (role !== "staff") return []

  const types: NotificationType[] = []
  if (permissions?.dashboard || permissions?.bookings) {
    types.push(...ADMIN_BOOKING_NOTIFICATION_TYPES)
  }
  if (permissions?.payments) {
    types.push(...ADMIN_PAYMENT_NOTIFICATION_TYPES)
  }
  return types
}
