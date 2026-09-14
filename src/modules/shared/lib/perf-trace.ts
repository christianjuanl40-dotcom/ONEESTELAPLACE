"use client"

const TRACE_FLAG = "perf=1"

function isTraceEnabled(): boolean {
  if (typeof window !== "undefined" && window.location.search.includes(TRACE_FLAG)) return true
  return process.env.NEXT_PUBLIC_PERF_TRACE === "1"
}

let anchor = 0
const listenerStarts = new Map<string, number>()

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

export function perfMark(label: string): void {
  if (!isTraceEnabled()) return
  const t = now()
  if (!anchor) anchor = t
  console.info(`[PERF] +${(t - anchor).toFixed(1)}ms  ${label}`)
}

export type PerfListenerEvent = "START" | "FIRST_SNAPSHOT" | "SNAPSHOT" | "ERROR" | "STOP"

export function perfListener(area: string, event: PerfListenerEvent, docs?: number): void {
  if (!isTraceEnabled()) return
  const t = now()
  if (!anchor) anchor = t
  const key = `listener:${area}`
  switch (event) {
    case "START":
      listenerStarts.set(key, t)
      console.info(`[PERF][${area}] listener START: +${(t - anchor).toFixed(1)}ms`)
      break
    case "FIRST_SNAPSHOT": {
      const start = listenerStarts.get(key) ?? anchor
      listenerStarts.delete(key)
      console.info(
        `[PERF][${area}] FIRST SNAPSHOT after ${(t - start).toFixed(0)}ms — docs: ${docs ?? "?"}`,
      )
      break
    }
    case "SNAPSHOT":
      console.info(`[PERF][${area}] snapshot update — docs: ${docs ?? "?"}`)
      break
    case "ERROR":
      console.info(`[PERF][${area}] ERROR`)
      break
    case "STOP":
      console.info(`[PERF][${area}] listener STOP`)
      break
  }
}

export function perfResetAnchor(): void {
  anchor = 0
  listenerStarts.clear()
}
