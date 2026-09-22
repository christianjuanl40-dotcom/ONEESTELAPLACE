import { describe, expect, it } from "vitest"
import { isPaymentWindowExpired, PAYMENT_WINDOW_MS } from "../booking-lifecycle"

describe("booking lifecycle expiry", () => {
  it("expires only after the complete 24-hour payment window", () => {
    const now = Date.parse("2026-09-21T12:00:00.000Z")
    const createdAt = new Date(now - PAYMENT_WINDOW_MS)

    expect(isPaymentWindowExpired(createdAt, now - 1)).toBe(false)
    expect(isPaymentWindowExpired(createdAt, now)).toBe(true)
  })

  it("rejects missing or invalid creation timestamps", () => {
    expect(isPaymentWindowExpired(undefined, Date.now())).toBe(false)
    expect(isPaymentWindowExpired("not-a-date", Date.now())).toBe(false)
  })
})
