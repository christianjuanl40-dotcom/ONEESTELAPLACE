import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const boundary = vi.hoisted(() => ({ process: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/email-worker", () => ({ processEmailOutbox: boundary.process }))

import { GET, POST } from "@/app/api/internal/email-worker/route"

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv("CRON_SECRET", "worker-secret")
  vi.stubEnv("EMAIL_SENDING_ENABLED", "true")
  vi.stubEnv("SMTP_HOST", "smtp.gmail.com")
  vi.stubEnv("SMTP_USER", "mailer@example.test")
  vi.stubEnv("SMTP_APP_PASSWORD", "fake-password")
  vi.stubEnv("EMAIL_FROM", "mailer@example.test")
  vi.stubEnv("APP_BASE_URL", "https://one-estela.example")
  boundary.process.mockReset().mockResolvedValue({
    status: "processed",
    processed: 1,
    sent: 1,
    retried: 0,
    failed: 0,
    blocked: 0,
  })
})

describe("protected email worker route", () => {
  it("does not reveal the route or invoke the worker without the secret", async () => {
    const response = await GET(new NextRequest("http://localhost/api/internal/email-worker"))
    expect(response.status).toBe(404)
    expect(boundary.process).not.toHaveBeenCalled()
  })

  it("accepts the constant-time Bearer secret and bounds worker invocation to the request limit", async () => {
    const request = new NextRequest("http://localhost/api/internal/email-worker?limit=12", {
      headers: { Authorization: "Bearer worker-secret" },
    })
    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(boundary.process).toHaveBeenCalledWith(12)
    await expect(response.json()).resolves.toMatchObject({ status: "processed", sent: 1 })
  })

  it("returns a safe server error when the worker throws", async () => {
    boundary.process.mockRejectedValue(new Error("private SMTP diagnostic"))
    const response = await GET(new NextRequest("http://localhost/api/internal/email-worker", {
      headers: { "x-cron-secret": "worker-secret" },
    }))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Email worker processing failed." })
  })
})
