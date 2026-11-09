import "server-only"

import { formatBookingDate } from "@/src/modules/shared/lib/booking-helpers"
import { getBookingScheduleSnapshot, type BookingScheduleSnapshot } from "@/src/modules/shared/lib/booking-schedule-history"
import { getEmailConfig, type EmailEventType } from "@/lib/email-config"

type DataRecord = Record<string, unknown>

export type EmailPaymentSnapshot = {
  method: string
  amount: number
  status: string
  reference?: string
  paymentNumber?: string
  note?: string
}

export type BookingEmailPayload = {
  bookingReference: string
  eventName: string
  venue: string
  customerName: string
  schedule: BookingScheduleSnapshot | null
  originalSchedule?: BookingScheduleSnapshot | null
  previousSchedule?: BookingScheduleSnapshot | null
  effectiveSchedule?: BookingScheduleSnapshot | null
  decisionReason?: string
  payment?: EmailPaymentSnapshot
  remainingBalance?: number
}

export type EmailTemplate = {
  subject: string
  text: string
  html: string
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() || fallback : fallback
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function formatMoney(value: unknown): string {
  return `₱${number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function scheduleLabel(schedule: BookingScheduleSnapshot | null | undefined): string {
  if (!schedule?.date) return "Schedule not available"
  const date = formatBookingDate(schedule.date)
  const endDate = schedule.endDate && schedule.endDate !== schedule.date ? ` – ${formatBookingDate(schedule.endDate)}` : ""
  const time = schedule.time || [schedule.startTime, schedule.endTime].filter(Boolean).join(" – ")
  return `${date}${endDate}${time ? ` • ${time}` : ""}`
}

function scheduleHtml(label: string, schedule: BookingScheduleSnapshot | null | undefined): string {
  return `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top;">${htmlEscape(label)}</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:700;vertical-align:top;">${htmlEscape(scheduleLabel(schedule))}</td></tr>`
}

function buildLink(path: string): string {
  const config = getEmailConfig()
  const base = config.appBaseUrl || "http://localhost:3000"
  return `${base}${path.startsWith("/") ? path : `/${path}`}`
}

function eventCopy(eventType: EmailEventType): { subject: string; heading: string; intro: string; actionPath: string } {
  switch (eventType) {
    case "booking_submitted":
      return { subject: "Booking Request Received", heading: "Booking request received", intro: "We received your booking request and it is ready for One Estela Place review.", actionPath: "/portal/bookings" }
    case "booking_approved":
      return { subject: "Booking Confirmed", heading: "Your booking is confirmed", intro: "Your booking has been confirmed. Please review the saved details in your Client Portal.", actionPath: "/portal/bookings" }
    case "booking_rejected":
      return { subject: "Booking Rejected", heading: "Booking decision update", intro: "Your booking was not accepted. Please open the Client Portal for the latest saved information.", actionPath: "/portal/bookings" }
    case "booking_schedule_updated":
      return { subject: "Booking Schedule Updated", heading: "Your booking schedule was updated", intro: "The saved date or time for your booking was modified. The comparison below reflects committed booking data.", actionPath: "/portal/bookings" }
    case "booking_cancelled":
      return { subject: "Booking Cancellation Notice", heading: "Booking cancellation notice", intro: "Your booking has been cancelled. Any refund status remains separate and is shown in the Client Portal.", actionPath: "/portal/bookings" }
    case "payment_submitted":
      return { subject: "Payment Submitted for Review", heading: "Payment submitted for review", intro: "We recorded your payment submission. One Estela Place will review it before the payment is treated as verified.", actionPath: "/portal/payments" }
    case "payment_verified":
      return { subject: "Payment Verified", heading: "Payment verified", intro: "One Estela Place recorded and verified the payment shown below.", actionPath: "/portal/payments" }
    case "payment_rejected":
      return { subject: "Payment Rejected", heading: "Payment review update", intro: "The payment submission below was rejected. Please review the saved transaction details before submitting another payment.", actionPath: "/portal/payments" }
    case "payment_incomplete":
      return { subject: "Payment Requires Attention", heading: "Payment requires attention", intro: "The payment submission below was recorded as incomplete. Please review the saved balance and transaction details.", actionPath: "/portal/payments" }
    case "balance_reminder":
      return { subject: "Remaining Balance Reminder", heading: "Remaining balance reminder", intro: "This is a reminder to review and settle the remaining balance shown for your booking.", actionPath: "/portal/payments" }
  }
}

function bookingRows(payload: BookingEmailPayload): { text: string[]; html: string } {
  const lines = [
    `Booking Reference: ${payload.bookingReference}`,
    `Event Name: ${payload.eventName || "Not provided"}`,
    `Reserved Space: ${payload.venue || "Not provided"}`,
    `Schedule: ${scheduleLabel(payload.schedule)}`,
  ]
  const rows = [
    scheduleHtml("Booking Reference", { date: payload.bookingReference }),
    `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top;">Event Name</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:700;vertical-align:top;">${htmlEscape(payload.eventName || "Not provided")}</td></tr>`,
    `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top;">Reserved Space</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:700;vertical-align:top;">${htmlEscape(payload.venue || "Not provided")}</td></tr>`,
    scheduleHtml("Schedule", payload.schedule),
  ]
  return { text: lines, html: rows.join("") }
}

function paymentRows(payment: EmailPaymentSnapshot | undefined): { text: string[]; html: string } {
  if (!payment) return { text: [], html: "" }
  const textLines = [
    `Payment Method: ${payment.method || "Not provided"}`,
    `Amount: ${formatMoney(payment.amount)}`,
    `Status: ${payment.status || "Not provided"}`,
    ...(payment.reference ? [`Reference: ${payment.reference}`] : []),
    ...(payment.paymentNumber ? [`Payment Number: ${payment.paymentNumber}`] : []),
    ...(payment.note ? [`Review Note: ${payment.note}`] : []),
  ]
  const htmlRows = [
    ["Payment Method", payment.method || "Not provided"],
    ["Amount", formatMoney(payment.amount)],
    ["Status", payment.status || "Not provided"],
    ...(payment.reference ? [["Reference", payment.reference]] : []),
    ...(payment.paymentNumber ? [["Payment Number", payment.paymentNumber]] : []),
    ...(payment.note ? [["Review Note", payment.note]] : []),
  ].map(([label, value]) => `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top;">${htmlEscape(label)}</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:700;vertical-align:top;">${htmlEscape(value)}</td></tr>`).join("")
  return { text: textLines, html: htmlRows }
}

function includesRemainingBalance(eventType: EmailEventType, payload: BookingEmailPayload): boolean {
  return payload.remainingBalance !== undefined
    && (eventType === "balance_reminder"
      || eventType === "booking_approved"
      || eventType === "payment_submitted"
      || eventType === "payment_verified"
      || eventType === "payment_rejected"
      || eventType === "payment_incomplete")
}

/** Builds a small, sanitized snapshot; proof images and internal audit fields are excluded. */
export function buildBookingEmailPayload(booking: DataRecord, additions: Partial<BookingEmailPayload> = {}): BookingEmailPayload {
  const userInfo = booking.userInfo && typeof booking.userInfo === "object" && !Array.isArray(booking.userInfo)
    ? booking.userInfo as DataRecord
    : {}
  const schedule = getBookingScheduleSnapshot(booking)
  const remainingBalance = optionalNumber(booking.remainingBalance)
  return {
    bookingReference: text(booking.id || booking.bookingId || booking.bookingCode, "Booking"),
    eventName: text(booking.eventName, "Booking"),
    venue: text(booking.venue, "Reserved space"),
    customerName: text(userInfo.name || booking.customerName, "Client"),
    schedule,
    ...(remainingBalance !== undefined ? { remainingBalance } : {}),
    ...(text(booking.rejectionReason) ? { decisionReason: text(booking.rejectionReason, "") } : {}),
    ...additions,
  }
}

export function renderEmailTemplate(eventType: EmailEventType, payload: BookingEmailPayload): EmailTemplate {
  const copy = eventCopy(eventType)
  const booking = bookingRows(payload)
  const payment = paymentRows(payload.payment)
  const detailsPath = `${copy.actionPath}?highlight=${encodeURIComponent(payload.bookingReference)}`
  const link = buildLink(detailsPath)
  const textLines = [
    `One Estela Place — ${copy.subject}`,
    "",
    `Hello ${payload.customerName || "Client"},`,
    copy.intro,
    "",
    ...booking.text,
  ]

  if (eventType === "booking_schedule_updated") {
    textLines.push(
      `Original Schedule: ${scheduleLabel(payload.originalSchedule)}`,
      `Immediately Previous Schedule: ${scheduleLabel(payload.previousSchedule)}`,
      `New Effective Schedule: ${scheduleLabel(payload.effectiveSchedule || payload.schedule)}`,
    )
  }
  if (eventType === "booking_rejected" && payload.decisionReason) {
    textLines.push("", `Reason: ${payload.decisionReason}`)
  }
  if (payment.text.length) textLines.push("", ...payment.text)
  if (includesRemainingBalance(eventType, payload)) textLines.push("", `Remaining Balance: ${formatMoney(payload.remainingBalance)}`)
  textLines.push("", `View details: ${link}`, "", "One Estela Place", "Please do not reply with passwords or payment proof attachments.")

  const extraRows = eventType === "booking_schedule_updated"
    ? `${scheduleHtml("Original Schedule", payload.originalSchedule)}${scheduleHtml("Immediately Previous", payload.previousSchedule)}${scheduleHtml("New Effective Schedule", payload.effectiveSchedule || payload.schedule)}`
    : ""
  const reasonRow = eventType === "booking_rejected" && payload.decisionReason
    ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top;">Reason</td><td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:700;vertical-align:top;">${htmlEscape(payload.decisionReason)}</td></tr>`
    : ""
  const balanceRows = includesRemainingBalance(eventType, payload)
    ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:38%;vertical-align:top;">Remaining Balance</td><td style="padding:8px 0;color:#ea580c;font-size:16px;font-weight:800;vertical-align:top;">${htmlEscape(formatMoney(payload.remainingBalance))}</td></tr>`
    : ""
  const greeting = `Hello ${htmlEscape(payload.customerName || "Client")},`
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,Helvetica,sans-serif;"><div style="padding:24px 12px;"><div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;"><div style="background:#ea580c;padding:24px 28px;color:#ffffff;"><div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;opacity:.9;">One Estela Place</div><h1 style="margin:10px 0 0;font-size:25px;line-height:1.2;">${htmlEscape(copy.heading)}</h1></div><div style="padding:28px;"><p style="margin:0 0 10px;font-size:16px;font-weight:700;">${greeting}</p><p style="margin:0 0 22px;color:#475569;font-size:15px;line-height:1.6;">${htmlEscape(copy.intro)}</p><table role="presentation" style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">${booking.html}${extraRows}${reasonRow}${payment.html}${balanceRows}</table><p style="margin:24px 0;text-align:center;"><a href="${htmlEscape(link)}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;font-size:14px;">View in Client Portal</a></p><p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">For your security, One Estela Place will never ask you to send a password by email. Payment status in the authenticated Client Portal is authoritative.</p></div><div style="padding:16px 28px;background:#f8fafc;color:#64748b;font-size:12px;">One Estela Place · Automated notification</div></div></div></body></html>`
  return { subject: copy.subject, text: textLines.join("\n"), html }
}
