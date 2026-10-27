import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const boundary = vi.hoisted(() => ({ auth: { currentUser: null as null | { uid: string; getIdToken: ReturnType<typeof vi.fn> }, authStateReady: vi.fn() } }))
vi.mock("@/lib/firebase", () => boundary)
import { getAuthHeaders } from "../auth-token"

beforeEach(() => { boundary.auth.currentUser = null; boundary.auth.authStateReady.mockReset().mockResolvedValue(undefined) })
afterEach(() => vi.useRealTimers())

describe("protected request identity readiness", () => {
  it("waits for restored authentication before requesting its token", async () => {
    const ready = Promise.withResolvers<void>()
    boundary.auth.authStateReady.mockReturnValue(ready.promise)
    const token = vi.fn().mockResolvedValue("token-A")
    const headers = getAuthHeaders(true)
    expect(token).not.toHaveBeenCalled()
    boundary.auth.currentUser = { uid: "A", getIdToken: token }; ready.resolve()
    expect(await headers).toEqual({ Authorization: "Bearer token-A", "Content-Type": "application/json" })
    expect(token).toHaveBeenCalledTimes(1)
  })

  it("rejects signed-out access and refuses a token resolved after an account switch", async () => {
    await expect(getAuthHeaders()).rejects.toThrow("Authentication is required.")
    const token = Promise.withResolvers<string>()
    const getIdToken = vi.fn().mockReturnValue(token.promise)
    boundary.auth.currentUser = { uid: "A", getIdToken }
    const headers = getAuthHeaders().catch(error => error.message)
    await vi.waitFor(() => expect(getIdToken).toHaveBeenCalledTimes(1))
    boundary.auth.currentUser = { uid: "B", getIdToken: vi.fn() }; token.resolve("obsolete-token")
    expect(await headers).toMatch(/account changed/)
  })

  it("cancels readiness/token waits without retrying an operation", async () => {
    const ready = Promise.withResolvers<void>(), controller = new AbortController()
    boundary.auth.authStateReady.mockReturnValue(ready.promise)
    const headers = getAuthHeaders(false, false, controller.signal).catch(error => error.name)
    controller.abort(); expect(await headers).toBe("AbortError"); ready.resolve()
    expect(boundary.auth.authStateReady).toHaveBeenCalledTimes(1)
  })
})
