export type ChatErrorKind =
  | "permission-denied"
  | "failed-precondition"
  | "unavailable"
  | "transient"
  | "unknown"

function normalizeCode(error: unknown): string {
  if (!error || typeof error !== "object") return ""
  const code = "code" in error ? (error as { code?: unknown }).code : ""
  return String(code || "").toLowerCase().replace(/^firestore\//, "")
}

export function getChatErrorKind(error: unknown): ChatErrorKind {
  const code = normalizeCode(error)
  if (code === "permission-denied" || code === "unauthenticated") return "permission-denied"
  if (code === "failed-precondition") return "failed-precondition"
  if (code === "unavailable") return "unavailable"
  if (["aborted", "deadline-exceeded", "internal", "resource-exhausted", "unknown"].includes(code)) {
    return "transient"
  }
  return "unknown"
}

export function getChatErrorMessage(error: unknown, subject = "Chat messages"): string {
  switch (getChatErrorKind(error)) {
    case "permission-denied":
      return "Chat is not authorized for this account."
    case "failed-precondition":
      return `${subject} could not be loaded because Firebase rejected the query. Retry chat. If this continues, deploy the approved Firestore chat index configuration.`
    case "unavailable":
      return `${subject} could not be loaded because the connection is unavailable. Check your connection and retry.`
    case "transient":
      return `${subject} could not be loaded right now. Check your connection and retry.`
    default:
      return `${subject} could not be loaded. Check your connection and retry.`
  }
}
