import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const boundary = vi.hoisted(() => ({
  issue: vi.fn(),
  verify: vi.fn(),
  user: { uid: "client-uid", role: "client" },
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/server-auth", () => ({
  ApiAuthError: class ApiAuthError extends Error {
    status: number
    constructor(status: number, message: string) { super(message); this.status = status }
  },
  isApiAuthError: (error: unknown) => error instanceof Error && "status" in error,
  requireAuthenticatedUser: vi.fn(async () => boundary.user),
}))
vi.mock("@/lib/email-otp", () => ({
  EmailOtpError: class EmailOtpError extends Error {
    status: number
    retryAfterSeconds?: number
    constructor(status: number, _code: string, message: string, retryAfterSeconds?: number) {
      super(message)
      this.status = status
      this.retryAfterSeconds = retryAfterSeconds
    }
  },
  issueEmailOtp: boundary.issue,
  verifyEmailOtp: boundary.verify,
}))

import { EmailOtpError } from "@/lib/email-otp"
import { POST } from "@/app/api/auth/email-otp/route"

beforeEach(() => {
  boundary.issue.mockReset().mockResolvedValue({ status: "sent", retryAfterSeconds: 60 })
  boundary.verify.mockReset().mockResolvedValue({ status: "verified", alreadyVerified: false })
})

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/email-otp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

describe("email OTP route", () => {
  it("issues without accepting browser UID/email fields and returns no code", async () => {
    const response = await POST(request({ action: "issue", uid: "attacker", email: "attacker@example.test" }, { "x-forwarded-for": "203.0.113.20" }))
    expect(response.status).toBe(200)
    expect(boundary.issue).toHaveBeenCalledWith("client-uid", "203.0.113.20")
    expect(await response.json()).toEqual({ success: true, status: "sent", retryAfterSeconds: 60 })
  })

  it("passes only the submitted code to the server verifier", async () => {
    const response = await POST(request({ action: "verify", code: "004201", uid: "wrong" }))
    expect(response.status).toBe(200)
    expect(boundary.verify).toHaveBeenCalledWith("client-uid", "004201")
    expect(await response.json()).toEqual({ status: "verified", alreadyVerified: false })
  })

  it("maps a safe rate-limit response without exposing implementation details", async () => {
    const error = new EmailOtpError(429, "rate_limited", "safe", 37)
    boundary.issue.mockRejectedValue(error)
    const response = await POST(request({ action: "resend" }))
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ error: "safe", retryAfterSeconds: 37 })
  })
})
