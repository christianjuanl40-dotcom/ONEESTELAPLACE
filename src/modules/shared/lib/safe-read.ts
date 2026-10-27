/** Bounded recovery for reads only. Never wrap a booking/payment mutation. */
export async function safeRead<T>(read: () => Promise<T>, options: { signal?: AbortSignal; timeoutMs?: number; attempts?: number } = {}): Promise<T> {
  const { signal, timeoutMs = 12000, attempts = 2 } = options
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new DOMException("Read cancelled", "AbortError")
    let timer: ReturnType<typeof setTimeout> | undefined
    let abort: (() => void) | undefined
    try {
      return await Promise.race([
        read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error("The read timed out. Check your connection and retry."), { code: "read/timeout" })), timeoutMs)
          abort = () => reject(new DOMException("Read cancelled", "AbortError"))
          signal?.addEventListener("abort", abort, { once: true })
          if (signal?.aborted) abort()
        }),
      ])
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
      if (signal?.aborted || attempt + 1 >= attempts || !["unavailable", "deadline-exceeded", "aborted"].includes(code)) throw error
    } finally {
      if (timer) clearTimeout(timer)
      if (abort) signal?.removeEventListener("abort", abort)
    }
  }
}
