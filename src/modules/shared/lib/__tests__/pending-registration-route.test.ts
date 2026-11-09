import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const boundary = vi.hoisted(() => ({
  issue: vi.fn(),
  resend: vi.fn(),
  verify: vi.fn(),
  status: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/pending-registration", () => ({
  PendingRegistrationError: class PendingRegistrationError extends Error {
    status: number
    code: string
    retryAfterSeconds?: number
    constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
      super(message)
      this.status = status
      this.code = code
      this.retryAfterSeconds = retryAfterSeconds
    }
  },
  PENDING_REGISTRATION_AUTH_COOKIE: "oe_registration_authorization",
  PENDING_REGISTRATION_COOKIE: "oe_pending_registration",
  issuePendingRegistration: boundary.issue,
  resendPendingRegistration: boundary.resend,
  verifyPendingRegistration: boundary.verify,
  getPendingRegistrationStatus: boundary.status,
}))
vi.mock("@/lib/server-auth", () => ({
  ApiAuthError: class ApiAuthError extends Error {
    status: number
    constructor(status: number, message: string) { super(message); this.status = status }
  },
  isApiAuthError: (error: unknown) => error instanceof Error && "status" in error,
}))

import { POST } from "@/app/api/auth/register/otp/route"

beforeEach(() => {
  boundary.issue.mockReset().mockResolvedValue({
    status: "sent",
    registrationId: "registration-123456789",
    email: "client@example.test",
    retryAfterSeconds: 60,
    expiresInSeconds: 600,
  })
  boundary.resend.mockReset().mockResolvedValue({
    status: "sent",
    registrationId: "registration-123456789",
    email: "client@example.test",
    retryAfterSeconds: 60,
    expiresInSeconds: 600,
  })
  boundary.verify.mockReset().mockResolvedValue({
    status: "verified",
    email: "client@example.test",
    authorizationToken: "server-only-token",
    authorizationExpiresInSeconds: 600,
  })
  boundary.status.mockReset().mockResolvedValue({
    status: "active",
    email: "client@example.test",
    expiresInSeconds: 600,
  })
})

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/register/otp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

describe("pending registration OTP route", () => {
  it("issues from profile fields and stores only the pending-registration cookie", async () => {
    const response = await POST(request({
      firstName: "Juan",
      lastName: "Cruz",
      email: "client@example.test",
      password: "must-not-be-forwarded",
    }, { "x-forwarded-for": "203.0.113.50" }))

    expect(response.status).toBe(200)
    expect(boundary.issue).toHaveBeenCalledWith({
      firstName: "Juan",
      middleName: "",
      lastName: "Cruz",
      email: "client@example.test",
      phone: "",
    }, "203.0.113.50")
    expect(JSON.stringify(await response.json())).not.toContain("must-not-be-forwarded")
    expect(response.cookies.get("oe_pending_registration")?.value).toBe("registration-123456789")
    expect(response.cookies.get("oe_registration_authorization")?.value).toBe("")
  })

  it("binds verify and resend to the HttpOnly registration cookie and never returns the authorization token", async () => {
    const headers = { cookie: "oe_pending_registration=registration-123456789" }
    const verifyResponse = await POST(request({ action: "verify", registrationId: "registration-123456789", code: "004201" }, headers))
    expect(verifyResponse.status).toBe(200)
    expect(boundary.verify).toHaveBeenCalledWith("registration-123456789", "004201")
    expect(await verifyResponse.json()).toEqual({
      success: true,
      status: "verified",
      email: "client@example.test",
      authorizationExpiresInSeconds: 600,
    })
    expect(verifyResponse.cookies.get("oe_registration_authorization")?.value).toBe("server-only-token")

    const resendResponse = await POST(request({ action: "resend" }, headers))
    expect(resendResponse.status).toBe(200)
    expect(boundary.resend).toHaveBeenCalledWith("registration-123456789", "")
  })

  it("returns a safe error for a mismatched browser registration id", async () => {
    const response = await POST(request({ action: "status", registrationId: "other-registration-123456" }, {
      cookie: "oe_pending_registration=registration-123456789",
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: "This signup session is invalid." })
    expect(boundary.status).not.toHaveBeenCalled()
  })
})
