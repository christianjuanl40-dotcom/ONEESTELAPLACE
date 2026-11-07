import { describe, expect, it } from "vitest"
import {
  getChatErrorKind,
  getChatErrorMessage,
} from "../chat-errors"

describe("chat read error classification", () => {
  it("keeps permission failures actionable without weakening the read", () => {
    const error = { code: "permission-denied" }

    expect(getChatErrorKind(error)).toBe("permission-denied")
    expect(getChatErrorMessage(error)).toContain("not authorized")
  })

  it("keeps missing-index failures visible until the approved index is deployed", () => {
    const error = { code: "failed-precondition" }

    expect(getChatErrorKind(error)).toBe("failed-precondition")
    expect(getChatErrorMessage(error)).toContain("index configuration")
  })

  it("keeps transient failures visible and retryable", () => {
    const error = { code: "unavailable" }

    expect(getChatErrorKind(error)).toBe("unavailable")
    expect(getChatErrorMessage(error, "Unread messages")).toContain("connection")
  })
})
