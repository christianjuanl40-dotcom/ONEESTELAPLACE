export type SessionState<T> = { user: T | null; phase: "auth" | "profile" | "ready" | "signed-out" | "error"; error: string | null }

/** One profile read per current identity; obsolete work cannot publish state. */
export function createSessionInitializer<I extends { uid: string }, T>(options: {
  currentUid: () => string | undefined
  read: (identity: I, signal: AbortSignal) => Promise<T>
  publish: (state: SessionState<T>) => void
  errorMessage: (error: unknown) => string
}) {
  let generation = 0
  let pending: { uid: string; promise: Promise<T>; controller: AbortController } | undefined
  let ready: { uid: string; user: T } | undefined
  const invalidate = () => { generation++; pending?.controller.abort(); pending = undefined; ready = undefined }
  return {
    load(identity: I, force = false): Promise<T> {
      if (options.currentUid() !== identity.uid) return Promise.reject(new DOMException("Session changed", "AbortError"))
      if (!force && pending?.uid === identity.uid) return pending.promise
      if (!force && ready?.uid === identity.uid && options.currentUid() === identity.uid) return Promise.resolve(ready.user)
      invalidate()
      const version = generation
      const controller = new AbortController()
      const current = () => version === generation && options.currentUid() === identity.uid && !controller.signal.aborted
      options.publish({ user: null, phase: "profile", error: null })
      const promise = Promise.resolve().then(() => options.read(identity, controller.signal)).then(user => {
        if (!current()) throw new DOMException("Session changed", "AbortError")
        ready = { uid: identity.uid, user }
        options.publish({ user, phase: "ready", error: null })
        return user
      }).catch(error => {
        if (current()) options.publish({ user: null, phase: "error", error: options.errorMessage(error) })
        throw error
      }).finally(() => { if (pending?.promise === promise) pending = undefined })
      pending = { uid: identity.uid, promise, controller }
      return promise
    },
    clear() { invalidate(); options.publish({ user: null, phase: "signed-out", error: null }) },
    fail(error: unknown) { invalidate(); options.publish({ user: null, phase: "error", error: options.errorMessage(error) }) },
    dispose: invalidate,
  }
}
