import "server-only"

import { after } from "next/server"
import { processEmailOutbox } from "@/lib/email-worker"

function normalizeJobIds(jobIds: readonly string[]): string[] {
  return [...new Set(jobIds.map((jobId) => String(jobId).trim()).filter(Boolean))]
}

/**
 * Starts best-effort post-response processing for only jobs created by the
 * just-committed transaction. Failures remain in the outbox for retry or the
 * scheduled worker and never change the already-successful API response.
 */
export function scheduleImmediateEmailDispatch(jobIds: readonly string[]): void {
  const normalizedJobIds = normalizeJobIds(jobIds)
  if (!normalizedJobIds.length) return

  try {
    after(async () => {
      try {
        const result = await processEmailOutbox(
          Math.min(normalizedJobIds.length, 25),
          {},
          { jobIds: normalizedJobIds },
        )
        if (result.status === "not_ready" || result.failed > 0 || result.retried > 0 || result.blocked > 0) {
          console.warn("[email immediate dispatch] deferred to outbox fallback", {
            status: result.status,
            errorCode: result.errorCode || null,
            failed: result.failed,
            retried: result.retried,
            blocked: result.blocked,
          })
        }
      } catch (error) {
        console.error(
          "[email immediate dispatch] processing failed:",
          error instanceof Error ? error.message : "Unknown error",
        )
      }
    })
  } catch (error) {
    console.error(
      "[email immediate dispatch] scheduling failed:",
      error instanceof Error ? error.message : "Unknown error",
    )
  }
}
