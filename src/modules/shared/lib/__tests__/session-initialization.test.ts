import { describe, expect, it, vi } from "vitest"
import { createSessionInitializer, type SessionState } from "../session-initialization"
import { safeRead } from "../safe-read"

const deferred = <T>() => Promise.withResolvers<T>()

describe("session/profile initialization", () => {
  function fixture() {
    let uid: string | undefined = "A"
    const states: SessionState<{ id: string; permissions?: object }>[] = []
    const requests: ReturnType<typeof deferred<{ id: string; permissions?: object }>>[] = []
    const read = vi.fn(() => { const task = deferred<{ id: string; permissions?: object }>(); requests.push(task); return task.promise })
    const session = createSessionInitializer({ currentUid: () => uid, read,
      publish: (state: SessionState<{ id: string; permissions?: object }>) => states.push(state), errorMessage: () => "Profile could not be loaded. Retry." })
    return { session, states, requests, read, identity: (value?: string) => { uid = value } }
  }

  it("coalesces login/auth-listener reads and publishes a ready profile once", async () => {
    const { session, read, requests, states } = fixture()
    const login = session.load({ uid: "A" }), listener = session.load({ uid: "A" })
    expect(listener).toBe(login)
    await Promise.resolve()
    expect(read).toHaveBeenCalledTimes(1)
    requests[0].resolve({ id: "A" })
    await login
    expect(states.map(state => state.phase)).toEqual(["profile", "ready"])
    await session.load({ uid: "A" })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("cannot overwrite a newer account with an obsolete profile response", async () => {
    const { session, requests, states, identity } = fixture()
    const old = session.load({ uid: "A" }).catch(error => error.name)
    await Promise.resolve()
    identity("B")
    const current = session.load({ uid: "B" })
    await Promise.resolve()
    requests[1].resolve({ id: "B" }); await current
    requests[0].resolve({ id: "A" }); expect(await old).toBe("AbortError")
    expect(states.at(-1)?.user?.id).toBe("B")
  })

  it("clears private state and ignores late success after logout/disposal", async () => {
    const { session, requests, states, identity } = fixture()
    const old = session.load({ uid: "A" }).catch(error => error.name)
    await Promise.resolve(); identity(); session.clear()
    requests[0].resolve({ id: "A" }); await old
    expect(states.at(-1)).toEqual({ user: null, phase: "signed-out", error: null })
    identity("A"); const pending = session.load({ uid: "A" }).catch(error => error.name)
    await Promise.resolve(); const count = states.length; session.dispose(); requests[1].resolve({ id: "A" }); await pending
    expect(states).toHaveLength(count)
  })

  it("does not let a late old sign-in callback cancel the current account's initialization", async () => {
    const { session, requests, states, identity } = fixture()
    identity("B"); const current = session.load({ uid: "B" })
    await expect(session.load({ uid: "A" })).rejects.toMatchObject({ name: "AbortError" })
    await Promise.resolve(); requests[0].resolve({ id: "B" }); await current
    expect(states.at(-1)?.user?.id).toBe("B")
  })

  it("exposes profile failures and supports a fresh bounded retry", async () => {
    const { session, requests, states } = fixture()
    const failed = session.load({ uid: "A" }).catch(() => null)
    await Promise.resolve(); requests[0].reject(new Error("Offline")); await failed
    expect(states.at(-1)).toMatchObject({ user: null, phase: "error", error: expect.stringContaining("Retry") })
    const retry = session.load({ uid: "A" }, true)
    await Promise.resolve(); requests[1].resolve({ id: "A" }); await retry
    expect(states.at(-1)?.phase).toBe("ready")
  })

  it("reapplies changed permissions even when the UID and display profile are unchanged", async () => {
    const { session, requests, states } = fixture()
    const first = session.load({ uid: "A" }); await Promise.resolve(); requests[0].resolve({ id: "A", permissions: { payments: true } }); await first
    const refresh = session.load({ uid: "A" }, true); await Promise.resolve(); requests[1].resolve({ id: "A", permissions: { payments: false } }); await refresh
    expect(states.at(-1)?.user?.permissions).toEqual({ payments: false })
  })
})

describe("bounded safe read recovery", () => {
  it("retries a transient read once and never retries authorization errors", async () => {
    const read = vi.fn().mockRejectedValueOnce({ code: "unavailable" }).mockResolvedValue("ready")
    expect(await safeRead(read)).toBe("ready"); expect(read).toHaveBeenCalledTimes(2)
    const denied = vi.fn().mockRejectedValue({ code: "permission-denied" })
    await expect(safeRead(denied)).rejects.toMatchObject({ code: "permission-denied" }); expect(denied).toHaveBeenCalledTimes(1)
  })

  it("stops on cancellation, including obsolete uncancellable SDK requests", async () => {
    const controller = new AbortController(), request = deferred<string>()
    const read = safeRead(() => request.promise, { signal: controller.signal }).catch(error => error.name)
    controller.abort(); expect(await read).toBe("AbortError")
    request.resolve("late")
  })

  it("times out a stalled read without adding another SDK request", async () => {
    vi.useFakeTimers()
    try {
      const operation = vi.fn(() => new Promise(() => {}))
      const result = safeRead(operation, { timeoutMs: 100 }).catch(error => error.code)
      await vi.advanceTimersByTimeAsync(101)
      expect(await result).toBe("read/timeout"); expect(operation).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
})
