import { describe, expect, it } from "vitest"
import { formatDisplayName, getStructuredName } from "../name-utils"

describe("structured client names", () => {
  it("keeps first, middle, and last names separate", () => {
    expect(
      getStructuredName({
        firstName: "Gabrielle",
        middleName: "Maria",
        lastName: "Manalig",
      }),
    ).toEqual({ firstName: "Gabrielle", middleName: "Maria", lastName: "Manalig" })
  })

  it("formats an optional middle name without extra spaces", () => {
    expect(formatDisplayName({ firstName: "Gabrielle", middleName: "Maria", lastName: "Manalig" })).toBe(
      "Gabrielle Maria Manalig",
    )
    expect(formatDisplayName({ firstName: "Gabrielle", middleName: "", lastName: "Manalig" })).toBe(
      "Gabrielle Manalig",
    )
  })

  it("does not split an unstructured multi-word surname", () => {
    expect(formatDisplayName({ fullName: "Gabrielle De Leon" })).toBe("Gabrielle De Leon")
    expect(getStructuredName({ fullName: "Gabrielle De Leon" })).toEqual({
      firstName: "",
      middleName: "",
      lastName: "",
    })
  })

  it("uses a legacy display fallback only when structured fields are absent", () => {
    expect(formatDisplayName({ fullName: "", name: "Legacy Client" }, "Client")).toBe("Legacy Client")
    expect(formatDisplayName({}, "Client")).toBe("Client")
  })
})
