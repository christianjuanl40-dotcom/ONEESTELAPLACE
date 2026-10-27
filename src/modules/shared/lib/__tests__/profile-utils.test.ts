import { describe, expect, it } from "vitest"
import {
  normalizeProfileContactUpdate,
  normalizeProfileEmail,
} from "../profile-utils"

describe("profile contact updates", () => {
  it("normalizes the authoritative email and preserves the phone value", () => {
    expect(
      normalizeProfileContactUpdate({
        email: "  Client@Example.COM ",
        phone: " +63 900 000 0000 ",
      }),
    ).toEqual({
      email: "client@example.com",
      phone: "+63 900 000 0000",
    })
  })

  it("rejects invalid email values instead of creating a success state", () => {
    expect(() => normalizeProfileEmail("not-an-email")).toThrow("valid email")
  })

  it("does not accept protected profile fields as contact updates", () => {
    const update = normalizeProfileContactUpdate({
      email: "client@example.com",
      phone: "",
      role: "admin",
      status: "inactive",
    })

    expect(update).toEqual({ email: "client@example.com", phone: "" })
    expect(update).not.toHaveProperty("role")
    expect(update).not.toHaveProperty("status")
  })
})
