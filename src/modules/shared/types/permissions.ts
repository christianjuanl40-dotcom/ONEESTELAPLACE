export type StaffPermissions = {
  dashboard: boolean
  bookings: boolean
  chat: boolean
  payments: boolean
  reports: boolean
  cms: boolean
  users: boolean
}

export const DEFAULT_STAFF_PERMISSIONS: StaffPermissions = {
  dashboard: true,
  bookings: false,
  chat: false,
  payments: false,
  reports: false,
  cms: false,
  users: false,
}

export const PERMISSION_LABELS: Record<keyof StaffPermissions, string> = {
  dashboard: "Dashboard",
  bookings: "Booking Management",
  chat: "Chat Support",
  payments: "Payment Verification",
  reports: "Reports & Analytics",
  cms: "CMS Settings",
  users: "Users Information",
}
