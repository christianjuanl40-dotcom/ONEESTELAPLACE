import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TransactionStore } from "./helpers/transaction-store"

vi.mock("server-only", () => ({}))

import {
  createEmailOtpDigest,
  EMAIL_OTP_COLLECTION,
  generateEmailOtpCode,
  issueEmailOtp,
  verifyEmailOtp,
  EmailOtpError,
} from "@/lib/email-otp"

const SECRET = "test-only-otp-hmac-secret-32-bytes"

function enableOtp() {
  vi.stubEnv("EMAIL_OTP_SENDING_ENABLED", "true")
  vi.stubEnv("EMAIL_OTP_SECRET", SECRET)
  vi.stubEnv("SMTP_HOST", "smtp.gmail.com")
  vi.stubEnv("SMTP_PORT", "465")
  vi.stubEnv("SMTP_SECURE", "true")
  vi.stubEnv("SMTP_USER", "mailer@example.test")
  vi.stubEnv("SMTP_APP_PASSWORD", "not-a-real-password")
  vi.stubEnv("EMAIL_FROM", "One Estela Place <mailer@example.test>")
  vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST", "client@example.test")
  vi.stubEnv("NODE_ENV", "test")
}

function fixture() {
  const store = new TransactionStore()
  const authUser: { email: string; emailVerified: boolean; providerData: Array<{ providerId: string }> } = {
    email: "client@example.test",
    emailVerified: false,
    providerData: [{ providerId: "password" }],
  }
  const auth = {
    getUser: vi.fn(async () => authUser),
    updateUser: vi.fn(async (_uid: string, updates: { emailVerified?: boolean }) => {
      if (updates.emailVerified !== undefined) authUser.emailVerified = updates.emailVerified
      return authUser
    }),
  }
  const sendMail = vi.fn(async () => ({ messageId: "test-message" }))
  const now = new Date("2026-11-09T10:00:00.000Z")
  return { store, auth, authUser, sendMail, now }
}

function codeFromMessage(sendMail: ReturnType<typeof vi.fn>): string {
  const message = sendMail.mock.calls[0]?.[0] as { text?: string } | undefined
  const match = message?.text?.match(/verification code is: (\d{6})/)
  if (!match) throw new Error("fixture did not capture an OTP")
  return match[1]
}

beforeEach(() => enableOtp())
afterEach(() => vi.unstubAllEnvs())

describe("email OTP primitives", () => {
  it("generates exactly six digits and preserves leading zeroes", () => {
    expect(generateEmailOtpCode(() => 7)).toBe("000007")
    expect(generateEmailOtpCode(() => 999999)).toBe("999999")
  })

  it("binds the digest to the UID, email, code, and challenge generation", () => {
    const first = createEmailOtpDigest("uid-a", "Client@Example.test", "004201", "challenge-a", SECRET)
    expect(first).toBe(createEmailOtpDigest("uid-a", "client@example.test", "004201", "challenge-a", SECRET))
    expect(first).not.toBe(createEmailOtpDigest("uid-b", "client@example.test", "004201", "challenge-a", SECRET))
    expect(first).not.toBe(createEmailOtpDigest("uid-a", "client@example.test", "004202", "challenge-a", SECRET))
    expect(first).not.toBe(createEmailOtpDigest("uid-a", "client@example.test", "004201", "challenge-b", SECRET))
  })
})

describe("server email OTP lifecycle", () => {
  it("issues a leading-zero code without returning plaintext and verifies it once", async () => {
    const fixtureData = fixture()
    const dependencies = {
      firestore: fixtureData.store as any,
      auth: fixtureData.auth as any,
      transport: { sendMail: fixtureData.sendMail } as any,
      now: () => fixtureData.now,
      generateCode: () => "004201",
    }

    const issued = await issueEmailOtp("client", "203.0.113.10", dependencies)
    expect(issued).toEqual({ status: "sent", retryAfterSeconds: 60 })
    expect(JSON.stringify(issued)).not.toContain("004201")
    expect(fixtureData.sendMail).toHaveBeenCalledTimes(1)

    const verified = await verifyEmailOtp("client", "004201", dependencies)
    expect(verified).toEqual({ status: "verified", alreadyVerified: false })
    expect(fixtureData.authUser.emailVerified).toBe(true)
    expect(fixtureData.store.data.get(`${EMAIL_OTP_COLLECTION}/client`)).toMatchObject({
      status: "verified",
      codeDigest: null,
    })

    await expect(verifyEmailOtp("client", "004201", dependencies)).resolves.toEqual({
      status: "verified",
      alreadyVerified: true,
    })
    expect(fixtureData.auth.updateUser).toHaveBeenCalledTimes(1)
  })

  it("enforces the server resend cooldown and replaces the prior challenge later", async () => {
    const fixtureData = fixture()
    let current = fixtureData.now.getTime()
    let codeNumber = 1
    const dependencies = {
      firestore: fixtureData.store as any,
      auth: fixtureData.auth as any,
      transport: { sendMail: fixtureData.sendMail } as any,
      now: () => new Date(current),
      generateCode: () => String(codeNumber++).padStart(6, "0"),
    }

    await issueEmailOtp("client", "203.0.113.11", dependencies)
    await expect(issueEmailOtp("client", "203.0.113.11", dependencies)).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
    })

    current += 61_000
    const replacement = await issueEmailOtp("client", "203.0.113.11", dependencies)
    expect(replacement.status).toBe("sent")
    expect(fixtureData.sendMail).toHaveBeenCalledTimes(2)
    await expect(verifyEmailOtp("client", "000001", dependencies)).rejects.toMatchObject({ status: 400 })
    await expect(verifyEmailOtp("client", "000002", dependencies)).resolves.toMatchObject({ status: "verified" })
  })

  it("locks a challenge after five incorrect attempts", async () => {
    const fixtureData = fixture()
    const dependencies = {
      firestore: fixtureData.store as any,
      auth: fixtureData.auth as any,
      transport: { sendMail: fixtureData.sendMail } as any,
      now: () => fixtureData.now,
      generateCode: () => "123456",
    }
    await issueEmailOtp("client", "203.0.113.12", dependencies)

    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(verifyEmailOtp("client", "000000", dependencies)).rejects.toMatchObject({ code: "invalid_code" })
    }
    await expect(verifyEmailOtp("client", "000000", dependencies)).rejects.toMatchObject({
      status: 429,
      code: "attempt_limit",
    })
    expect(fixtureData.store.data.get(`${EMAIL_OTP_COLLECTION}/client`)).toMatchObject({ status: "locked", attempts: 5 })
  })

  it("expires a challenge and rejects a code issued before an email change", async () => {
    const fixtureData = fixture()
    let current = fixtureData.now.getTime()
    const dependencies = {
      firestore: fixtureData.store as any,
      auth: fixtureData.auth as any,
      transport: { sendMail: fixtureData.sendMail } as any,
      now: () => new Date(current),
      generateCode: () => "004201",
    }
    await issueEmailOtp("client", "203.0.113.13", dependencies)
    current += 601_000
    await expect(verifyEmailOtp("client", "004201", dependencies)).rejects.toMatchObject({ code: "expired_code" })

    const second = fixture()
    const secondDependencies = { ...dependencies, firestore: second.store as any, auth: second.auth as any, transport: { sendMail: second.sendMail } as any, now: () => second.now }
    await issueEmailOtp("client", "203.0.113.14", secondDependencies)
    second.authUser.email = "changed@example.test"
    await expect(verifyEmailOtp("client", "004201", secondDependencies)).rejects.toMatchObject({
      status: 409,
      code: "email_changed",
    })
  })

  it("invalidates delivery failures without exposing SMTP diagnostics", async () => {
    const fixtureData = fixture()
    const secretText = "smtp password must not escape"
    const dependencies = {
      firestore: fixtureData.store as any,
      auth: fixtureData.auth as any,
      transport: { sendMail: vi.fn().mockRejectedValue(new Error(secretText)) } as any,
      now: () => fixtureData.now,
      generateCode: () => "004201",
    }
    const error = await issueEmailOtp("client", "203.0.113.15", dependencies).catch((value) => value as EmailOtpError)
    expect(error).toMatchObject({ status: 503, code: "otp_delivery_failed" })
    expect((error as Error).message).not.toContain(secretText)
    expect(fixtureData.store.data.get(`${EMAIL_OTP_COLLECTION}/client`)).toMatchObject({ status: "delivery_failed" })
  })

  it("does not allow two concurrent verification calls to update Auth twice", async () => {
    const fixtureData = fixture()
    const dependencies = {
      firestore: fixtureData.store as any,
      auth: fixtureData.auth as any,
      transport: { sendMail: fixtureData.sendMail } as any,
      now: () => fixtureData.now,
      generateCode: () => "004201",
    }
    await issueEmailOtp("client", "203.0.113.16", dependencies)
    const results = await Promise.allSettled([
      verifyEmailOtp("client", "004201", dependencies),
      verifyEmailOtp("client", "004201", dependencies),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(fixtureData.auth.updateUser).toHaveBeenCalledTimes(1)
  })
})
