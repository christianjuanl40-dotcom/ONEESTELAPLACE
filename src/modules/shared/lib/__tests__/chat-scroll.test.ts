import { describe, expect, it } from "vitest"
import { isChatNearBottom } from "../../hooks/use-chat-scroll"

describe("chat scroll policy", () => {
  it("treats the bottom threshold as a user-intent boundary", () => {
    expect(isChatNearBottom({ scrollHeight: 1000, scrollTop: 850, clientHeight: 100 })).toBe(true)
    expect(isChatNearBottom({ scrollHeight: 1000, scrollTop: 804, clientHeight: 100 })).toBe(true)
    expect(isChatNearBottom({ scrollHeight: 1000, scrollTop: 803, clientHeight: 100 })).toBe(false)
  })
})
