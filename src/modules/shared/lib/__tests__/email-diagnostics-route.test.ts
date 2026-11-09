import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const boundary = vi.hoisted(() => ({
  config: vi.fn(),
  diagnostics: vi.fn(),
  projectId: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/email-config", () => ({
  getEmailConfig: boundary.config,
  getEmailRuntimeDiagnostics: boundary.diagnostics,
}))
vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAdminProjectId: boundary.projectId,
}))

import { GET, POST } from "@/app/api/internal/email-diagnostics/route"

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret")
  boundary.config.mockReturnValue({})
  boundary.diagnostics.mockReturnValue({
    environment: "production",
    isProduction: true,
    isStaging: false,
    emailSendingEnabled: false,
    otpSendingEnabled: false,
    otpStagingApproved: false,
    otpProductionApproved: false,
    otpSecretConfigured: false,
     smtpConfigured: false,
     appBaseUrlConfigured: false,
     transactionalReady: false,
     otpReady: false,
    otpGateReason: "otp_flag_false",
    recipientAllowlistConfigured: false,
    recipientAllowlistCount: 0,
    recipientAllowlistOnly: false,
  })
  boundary.projectId.mockReturnValue("oneestela-ae9b5")
})

afterEach(() => vi.unstubAllEnvs())

describe("email diagnostics route", () => {
  it("does not disclose whether configuration exists without the CRON secret", async () => {
    const response = await GET(new NextRequest("http://localhost/api/internal/email-diagnostics"))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "Not found." })
    expect(boundary.diagnostics).not.toHaveBeenCalled()
  })

  it("returns safe readiness data only after secret authentication", async () => {
    const response = await POST(new NextRequest("http://localhost/api/internal/email-diagnostics", {
      method: "POST",
      headers: { authorization: "Bearer test-cron-secret" },
    }))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({
      status: "not_ready",
     email: { otpGateReason: "otp_flag_false", otpSecretConfigured: false },
     firebase: { adminConfigured: true, projectMatchesProduction: true, errorCode: null },
     dispatch: {
       implementation: "after-scoped-outbox-v1",
       immediateAfter: true,
       scopedJobIds: true,
       scheduledFallback: true,
       deploymentCommitSha: null,
     },
   })
  })
})
