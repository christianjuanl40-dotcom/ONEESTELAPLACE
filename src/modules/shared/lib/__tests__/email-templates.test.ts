import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { EMAIL_EVENT_TYPES } from "@/lib/email-config"
import { buildBookingEmailPayload, renderEmailTemplate } from "@/lib/email-templates"

afterEach(() => vi.unstubAllEnvs())

const booking = {
  id: "BK-EMAIL-01",
  eventName: "<script>alert('xss')</script>",
  venue: "Main Hall & Garden",
  date: "2099-06-15",
  startTime: "08:00",
  endTime: "14:00",
  userInfo: { name: "<Client>" },
  proofUrl: "data:image/png;base64,secret-proof",
  adminLogs: [{ message: "internal note" }],
}

describe("branded transactional email templates", () => {
  it("renders every supported event with a fixed portal link", () => {
    vi.stubEnv("APP_BASE_URL", "https://one-estela.example")
    const payload = buildBookingEmailPayload(booking)

    for (const eventType of EMAIL_EVENT_TYPES) {
      const template = renderEmailTemplate(eventType, payload)
      expect(template.subject.length).toBeGreaterThan(0)
      expect(template.text).toContain("Booking Reference: BK-EMAIL-01")
      expect(template.html).toContain("https://one-estela.example/portal/")
      expect(template.html).not.toContain("<script>")
      expect(template.html).toContain("&lt;script&gt;")
    }
  })

  it("includes committed schedule comparisons, payment details, and balance values", () => {
    vi.stubEnv("APP_BASE_URL", "https://one-estela.example")
    const payload = buildBookingEmailPayload(booking, {
      originalSchedule: { date: "2099-06-01", time: "08:00 - 14:00" },
      previousSchedule: { date: "2099-06-08", time: "08:00 - 14:00" },
      effectiveSchedule: { date: "2099-06-15", time: "08:00 - 14:00" },
      payment: { method: "Bank Transfer", amount: 12500, status: "Pending", reference: "00123", paymentNumber: "2" },
      remainingBalance: 87500,
    })

    const schedule = renderEmailTemplate("booking_schedule_updated", payload)
    expect(schedule.text).toContain("Original Schedule:")
    expect(schedule.text).toContain("Immediately Previous Schedule:")
    expect(schedule.text).toContain("New Effective Schedule:")

    const payment = renderEmailTemplate("payment_submitted", payload)
    expect(payment.text).toContain("Payment Method: Bank Transfer")
    expect(payment.text).toContain("Reference: 00123")
    expect(payment.text).toContain("₱12,500.00")

    const reminder = renderEmailTemplate("balance_reminder", payload)
    expect(reminder.text).toContain("Remaining Balance: ₱87,500.00")
    expect(reminder.html).not.toContain("data:image/png")
    expect(reminder.html).not.toContain("internal note")
  })
})
