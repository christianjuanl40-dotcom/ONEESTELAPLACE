import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TransactionStore } from "./helpers/transaction-store"

vi.mock("server-only", () => ({}))

import {
  finalizePendingRegistration,
  issuePendingRegistration,
  PENDING_REGISTRATION_COLLECTION,
  resendPendingRegistration,
  verifyPendingRegistration,
} from "@/lib/pending-registration"

const SECRET = "test-only-pending-registration-hmac-secret-32-bytes"
const EMAIL = "client@example.test"

function enablePendingRegistration() {
  vi.stubEnv("EMAIL_OTP_SENDING_ENABLED", "true")
  vi.stubEnv("EMAIL_OTP_SECRET", SECRET)
  vi.stubEnv("SMTP_HOST", "smtp.gmail.com")
  vi.stubEnv("SMTP_PORT", "465")
  vi.stubEnv("SMTP_SECURE", "true")
  vi.stubEnv("SMTP_USER", "mailer@example.test")
  vi.stubEnv("SMTP_APP_PASSWORD", "not-a-real-password")
  vi.stubEnv("EMAIL_FROM", "One Estela Place <mailer@example.test>")
  vi.stubEnv("EMAIL_TEST_RECIPIENT_ALLOWLIST", EMAIL)
  vi.stubEnv("NODE_ENV", "test")
}

function fixture() {
  const store = new TransactionStore()
  const users = new Map<string, Record<string, unknown>>()
  const auth = {
    getUserByEmail: vi.fn(async (email: string) => {
      const match = [...users.values()].find((user) => String(user.email || "").toLowerCase() === email.toLowerCase())
      if (!match) throw Object.assign(new Error("User not found"), { code: "auth/user-not-found" })
      return match
    }),
    getUser: vi.fn(async (uid: string) => {
      const user = users.get(uid)
      if (!user) throw Object.assign(new Error("User not found"), { code: "auth/user-not-found" })
      return user
    }),
    updateUser: vi.fn(async (uid: string, updates: Record<string, unknown>) => {
      const user = users.get(uid)
      if (!user) throw Object.assign(new Error("User not found"), { code: "auth/user-not-found" })
      Object.assign(user, updates)
      return user
    }),
  }
  const sendMail = vi.fn(async () => ({ messageId: "test-message" }))
  const now = new Date("2026-11-09T10:00:00.000Z")
  return { store, users, auth, sendMail, now }
}

function dependencies(data: ReturnType<typeof fixture>, code = "004201", ids = ["registration-123456789", "nonce-123456789"] as string[]) {
  return {
    firestore: data.store as any,
    auth: data.auth as any,
    transport: { sendMail: data.sendMail } as any,
    now: () => data.now,
    generateCode: () => code,
    generateId: () => ids.shift() || "fallback-123456789",
    secret: SECRET,
  }
}

function input() {
  return {
    firstName: "Juan",
    middleName: "Dela",
    lastName: "Cruz",
    email: ` Client@Example.test `,
    phone: "+639123456789",
  }
}

function capturedCode(sendMail: ReturnType<typeof vi.fn>): string {
  const text = String((sendMail.mock.calls.at(-1)?.[0] as { text?: string } | undefined)?.text || "")
  const match = text.match(/verification code is: (\d{6})/)
  if (!match) throw new Error("OTP code was not captured")
  return match[1]
}

beforeEach(enablePendingRegistration)
afterEach(() => vi.unstubAllEnvs())

describe("pending registration OTP flow", () => {
  it("does not create Firebase Auth or a profile before OTP verification", async () => {
    const data = fixture()
    const deps = dependencies(data)

    const result = await issuePendingRegistration(input(), "203.0.113.40", deps)

    expect(result.registrationId).toBe("registration-123456789")
    expect(data.auth.getUserByEmail).toHaveBeenCalledWith(EMAIL)
    expect(data.auth.getUser).not.toHaveBeenCalled()
    expect(data.auth.updateUser).not.toHaveBeenCalled()
    expect(data.users.size).toBe(0)
    expect(data.store.data.has(`users/${result.registrationId}`)).toBe(false)
    expect(data.store.data.get(`${PENDING_REGISTRATION_COLLECTION}/${result.registrationId}`)).toMatchObject({
      status: "active",
      email: EMAIL,
      codeDigest: expect.any(String),
    })
    expect(JSON.stringify(data.store.data.get(`${PENDING_REGISTRATION_COLLECTION}/${result.registrationId}`))).not.toContain("004201")
  })

  it("enforces cooldown, replaces the code after cooldown, and expires old challenges", async () => {
    const data = fixture()
    let codeNumber = 1
    const deps = {
      ...dependencies(data),
      generateCode: () => String(codeNumber++).padStart(6, "0"),
    }

    const issued = await issuePendingRegistration(input(), "203.0.113.41", deps)
    await expect(resendPendingRegistration(issued.registrationId, "203.0.113.41", deps)).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 60,
    })

    data.now = new Date(data.now.getTime() + 61_000)
    await resendPendingRegistration(issued.registrationId, "203.0.113.41", deps)
    await expect(verifyPendingRegistration(issued.registrationId, "000001", deps)).rejects.toMatchObject({ status: 400, code: "invalid_code" })
    await expect(verifyPendingRegistration(issued.registrationId, "000002", deps)).resolves.toMatchObject({ status: "verified" })

    const expiredData = fixture()
    const expiredDeps = dependencies(expiredData, "123456")
    const expired = await issuePendingRegistration(input(), "203.0.113.42", expiredDeps)
    expiredData.now = new Date(expiredData.now.getTime() + 601_000)
    await expect(verifyPendingRegistration(expired.registrationId, "123456", expiredDeps)).rejects.toMatchObject({ status: 400, code: "expired_code" })
    expect(expiredData.store.data.get(`${PENDING_REGISTRATION_COLLECTION}/${expired.registrationId}`)).toMatchObject({ status: "expired" })
  })

  it("locks after five incorrect attempts and rejects the correct code afterward", async () => {
    const data = fixture()
    const deps = dependencies(data, "123456")
    const issued = await issuePendingRegistration(input(), "203.0.113.43", deps)

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(verifyPendingRegistration(issued.registrationId, "000000", deps)).rejects.toMatchObject({ code: "invalid_code" })
    }
    await expect(verifyPendingRegistration(issued.registrationId, "000000", deps)).rejects.toMatchObject({
      status: 429,
      code: "attempt_limit",
    })
    await expect(verifyPendingRegistration(issued.registrationId, "123456", deps)).rejects.toMatchObject({
      status: 429,
      code: "attempt_limit",
    })
    expect(data.store.data.get(`${PENDING_REGISTRATION_COLLECTION}/${issued.registrationId}`)).toMatchObject({ status: "locked", attempts: 5 })
  })

  it("prevents OTP replay and binds finalization to the verified authorization", async () => {
    const data = fixture()
    const deps = dependencies(data)
    const issued = await issuePendingRegistration(input(), "203.0.113.44", deps)
    const verified = await verifyPendingRegistration(issued.registrationId, capturedCode(data.sendMail), deps)

    await expect(verifyPendingRegistration(issued.registrationId, "004201", deps)).rejects.toMatchObject({
      status: 409,
      code: "registration_already_verified",
    })

    data.users.set("uid-client-1", {
      uid: "uid-client-1",
      email: EMAIL,
      emailVerified: false,
      providerData: [{ providerId: "password" }],
      metadata: { creationTime: new Date(data.now.getTime() + 1_000).toISOString() },
    })

    await expect(finalizePendingRegistration({
      registrationId: issued.registrationId,
      authorizationToken: `${verified.authorizationToken}tampered`,
      uid: "uid-client-1",
    }, deps)).rejects.toMatchObject({ status: 403, code: "invalid_authorization" })
    expect(data.store.data.has("users/uid-client-1")).toBe(false)

    const finalized = await finalizePendingRegistration({
      registrationId: issued.registrationId,
      authorizationToken: verified.authorizationToken,
      uid: "uid-client-1",
    }, deps)
    expect(finalized).toMatchObject({ status: "finalized", uid: "uid-client-1", email: EMAIL })
    expect(data.users.get("uid-client-1")).toMatchObject({ emailVerified: true })
    expect(data.store.data.get("users/uid-client-1")).toMatchObject({
      uid: "uid-client-1",
      role: "client",
      emailVerificationRequired: true,
      email: EMAIL,
    })

    const updateCount = data.auth.updateUser.mock.calls.length
    await expect(finalizePendingRegistration({
      registrationId: issued.registrationId,
      authorizationToken: verified.authorizationToken,
      uid: "uid-client-1",
    }, deps)).resolves.toEqual(finalized)
    expect(data.auth.updateUser).toHaveBeenCalledTimes(updateCount)
  })

  it("does not create a profile when OTP delivery fails", async () => {
    const data = fixture()
    data.sendMail.mockRejectedValue(new Error("SMTP password must not escape"))
    const deps = dependencies(data, "004201")

    let error: unknown
    try {
      await issuePendingRegistration(input(), "203.0.113.45", deps)
    } catch (value) {
      error = value
    }

    expect(error).toMatchObject({ status: 503, code: "otp_delivery_failed" })
    expect((error as Error).message).not.toContain("SMTP password")
    expect(data.auth.updateUser).not.toHaveBeenCalled()
    expect(data.users.size).toBe(0)
    const challenge = [...data.store.data.entries()].find(([path]) => path.startsWith(`${PENDING_REGISTRATION_COLLECTION}/`))?.[1]
    expect(challenge).toMatchObject({ status: "delivery_failed", deliveryErrorCode: "smtp_send_failed" })
  })
})
