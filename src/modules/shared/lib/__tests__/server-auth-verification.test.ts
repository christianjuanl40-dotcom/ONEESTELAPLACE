import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("server-only", () => ({}))

const boundary = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  getUser: vi.fn(),
  profile: { role: "client", status: "active", email: "client@example.test" } as Record<string, unknown>,
}))

vi.mock("@/lib/firebase-admin", () => ({
  getAdminAuth: () => ({ verifyIdToken: boundary.verifyIdToken, getUser: boundary.getUser }),
  getAdminFirestore: () => ({
    collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => boundary.profile }) }) }),
  }),
}))

import { ApiAuthError, enforceVerifiedClientPolicy, requireAuthenticatedUser } from "@/lib/server-auth"

beforeEach(() => {
  vi.unstubAllEnvs()
  boundary.profile = { role: "client", status: "active", email: "client@example.test" }
  boundary.verifyIdToken.mockReset().mockResolvedValue({
    uid: "client-uid",
    auth_time: 1_700_000_000,
    email: "client@example.test",
    email_verified: false,
    firebase: { sign_in_provider: "password" },
  })
  boundary.getUser.mockReset().mockResolvedValue({
    email: "client@example.test",
    emailVerified: false,
    metadata: { creationTime: "2026-11-08T00:00:00.000Z" },
    providerData: [{ providerId: "password" }],
  })
})

const request = () => new NextRequest("http://localhost/api/bookings", { headers: { Authorization: "Bearer fixture-token" } })

describe("server-side Firebase email verification policy", () => {
  it("rejects an unverified post-rollout email/password Client on protected mutations", async () => {
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_ENABLED", "true")
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "2026-11-01T00:00:00.000Z")

    await expect(requireAuthenticatedUser(request(), { requireVerifiedClient: true })).rejects.toMatchObject({
      status: 403,
      message: "Please verify your email address before continuing with this protected action.",
    })
    expect(boundary.getUser).toHaveBeenCalledWith("client-uid")
  })

  it("allows legacy Clients when their Auth creation date precedes rollout", async () => {
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_ENABLED", "true")
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "2026-11-01T00:00:00.000Z")
    boundary.getUser.mockResolvedValue({
      email: "client@example.test",
      emailVerified: false,
      metadata: { creationTime: "2026-10-31T23:59:59.000Z" },
      providerData: [{ providerId: "password" }],
    })

    const user = await requireAuthenticatedUser(request(), { requireVerifiedClient: true })
    expect(user.emailVerified).toBe(false)
    expect(user.role).toBe("client")
  })

  it("fails open when the rollout boundary is missing and skips trusted providers", async () => {
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_ENABLED", "true")
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "")
    await expect(requireAuthenticatedUser(request(), { requireVerifiedClient: true })).resolves.toMatchObject({ role: "client" })
    expect(boundary.getUser).not.toHaveBeenCalled()

    await expect(enforceVerifiedClientPolicy({
      uid: "google-client",
      role: "client",
      emailVerified: false,
      signInProvider: "google.com",
      authUser: {
        metadata: { creationTime: "2026-11-08T00:00:00.000Z" },
        providerData: [{ providerId: "google.com" }],
      },
    })).resolves.toBeUndefined()

    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "2026-11-01T00:00:00.000Z")
    await expect(enforceVerifiedClientPolicy({
      uid: "linked-google-client",
      role: "client",
      emailVerified: false,
      signInProvider: "google.com",
      authUser: {
        metadata: { creationTime: "2026-11-08T00:00:00.000Z" },
        providerData: [{ providerId: "google.com" }, { providerId: "password" }],
      },
    })).resolves.toBeUndefined()
  })

  it("allows a currently verified Client and propagates Auth verification state", async () => {
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_ENABLED", "true")
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "2026-11-01T00:00:00.000Z")
    boundary.verifyIdToken.mockResolvedValue({
      uid: "client-uid",
      auth_time: 1_700_000_000,
      email: "client@example.test",
      email_verified: true,
      firebase: { sign_in_provider: "password" },
    })
    boundary.getUser.mockResolvedValue({
      email: "client@example.test",
      emailVerified: true,
      metadata: { creationTime: "2026-11-08T00:00:00.000Z" },
      providerData: [{ providerId: "password" }],
    })

    const user = await requireAuthenticatedUser(request(), { requireVerifiedClient: true })
    expect(user.emailVerified).toBe(true)
    expect(boundary.getUser).toHaveBeenCalledWith("client-uid")
  })

  it("allows only the OTP flow to authenticate an unverified marked signup", async () => {
    boundary.profile = {
      role: "client",
      status: "active",
      email: "client@example.test",
      emailVerificationRequired: true,
    }

    await expect(requireAuthenticatedUser(request(), { allowUnverifiedClient: true })).resolves.toMatchObject({
      role: "client",
      emailVerificationRequired: true,
    })
    await expect(requireAuthenticatedUser(request(), { requireVerifiedClient: true })).rejects.toMatchObject({
      status: 403,
    })
  })

  it("uses the documented policy error type", async () => {
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_ENABLED", "true")
    vi.stubEnv("EMAIL_VERIFICATION_ENFORCEMENT_START_AT", "2026-11-01T00:00:00.000Z")
    await expect(enforceVerifiedClientPolicy({
      uid: "client-uid",
      role: "client",
      emailVerified: false,
      signInProvider: "password",
      authUser: { metadata: { creationTime: "2026-11-08T00:00:00.000Z" }, providerData: [{ providerId: "password" }] },
    })).rejects.toSatisfy((error: unknown) => error instanceof ApiAuthError && error.status === 403)
  })
})
