export const PAYMENT_LABELS = {
  payAtOffice: "Pay at the Office",
  bankTransfer: "Bank Transfer",
  payAtOfficeShort: "Pay at Office",
  payAtOfficeLong: "Pay at the Office",
  payAtOfficeHint:
    "You selected Pay at the Office. Please visit One Estela Place within 24 hours to settle your payment.",
  payAtOfficeConfirm: "Are you sure you want to pay at the office?",
  payAtOfficeSubmit: "Yes, Pay at the Office",
  payAtOfficeButton: "Submit Pay at the Office Payment",
  payAtOfficeSelected: "Pay at the Office Selected",
  payAtOfficeReminder: "Pay at the Office Reminder",
  payAtOfficeFee: "Slot Reservation Fee",
} as const

export const CHAT_LABELS = {
  chatSupport: "Chat Support",
  contactSupport: "Contact Support",
  contactSupportHint: "Reach out to our support team for billing and payment questions.",
  adminSupport: "Support Team",
  onlineStatus: "Online and ready to help",
} as const

export const BOOKING_STATUS_LABELS = {
  pending: "Pending",
  verifying: "Pending Verification",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Declined",
  cancellation_requested: "Cancellation Under Review",
  reservation_secured: "Reservation Secured",
} as const

export const PAYMENT_STATUS_LABELS = {
  unpaid: "Unpaid",
  cash_pending: "Pay at the Office Pending",
  for_review: "For Verification",
  partial: "Partial Payment",
  verified: "Verified",
  paid: "Paid",
  rejected: "Rejected",
  slot_pending: "Slot Pending",
  slot_verified: "Slot Verified",
  cancelled: "Cancelled",
  incomplete: "Incomplete",
} as const

export const REFUND_STATUS_LABELS = {
  "Not Applicable": "Not Applicable",
  "Pending Review": "Pending Review",
  "Refund Eligible": "Refund Eligible",
  "Non-Refundable": "Non-Refundable",
  "Refund Pending": "Refund Pending",
  "Refund Ready for Claiming": "Refund Ready for Claiming",
  "Refund Claimed": "Refund Claimed",
  "Not Eligible for Refund": "Not Eligible for Refund",
} as const

export function getPaymentMethodLabel(method?: string): string {
  if (method === "bank") return PAYMENT_LABELS.bankTransfer
  if (method === "cash") return PAYMENT_LABELS.payAtOffice
  return "Not yet selected"
}
