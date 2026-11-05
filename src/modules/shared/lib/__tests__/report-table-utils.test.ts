import { describe, expect, it } from "vitest"
import {
  matchesTableSearchTerm,
  normalizeTableSearchTerm,
  paginateItems,
  stableSortBy,
} from "../report-table-utils"

describe("report table utilities", () => {
  it("sorts numeric, date, and text values without mutating the source", () => {
    const rows = [
      { id: "late", amount: 100, date: new Date("2026-10-20"), name: "Zulu" },
      { id: "early", amount: 2, date: new Date("2026-01-20"), name: "alpha" },
      { id: "middle", amount: 25, date: new Date("2026-05-20"), name: "Bravo" },
    ]

    expect(stableSortBy(rows, (row) => row.amount, "asc").map((row) => row.id)).toEqual([
      "early",
      "middle",
      "late",
    ])
    expect(stableSortBy(rows, (row) => row.date, "desc").map((row) => row.id)).toEqual([
      "late",
      "middle",
      "early",
    ])
    expect(stableSortBy(rows, (row) => row.name, "asc").map((row) => row.id)).toEqual([
      "early",
      "middle",
      "late",
    ])
    expect(rows.map((row) => row.id)).toEqual(["late", "early", "middle"])
  })

  it("keeps equal values stable and puts missing values last in both directions", () => {
    const rows = [
      { id: "first", value: 10 },
      { id: "missing", value: undefined },
      { id: "second", value: 10 },
      { id: "blank", value: "" },
    ]

    expect(stableSortBy(rows, (row) => row.value, "asc").map((row) => row.id)).toEqual([
      "first",
      "second",
      "missing",
      "blank",
    ])
    expect(stableSortBy(rows, (row) => row.value, "desc").map((row) => row.id)).toEqual([
      "first",
      "second",
      "missing",
      "blank",
    ])
  })

  it("clamps page boundaries and handles exact page sizes", () => {
    const rows = ["a", "b", "c", "d", "e", "f"]

    expect(paginateItems(rows, 1, 2)).toMatchObject({
      items: ["a", "b"],
      page: 1,
      totalPages: 3,
      startIndex: 0,
      endIndex: 2,
    })
    expect(paginateItems(rows, 2, 2).items).toEqual(["c", "d"])
    expect(paginateItems(rows, 99, 2).items).toEqual(["e", "f"])
    expect(paginateItems(rows, 1, 6).items).toEqual(rows)
    expect(paginateItems([], 4, 25)).toMatchObject({ items: [], page: 1, totalPages: 1, startIndex: 0, endIndex: 0 })
  })

  it("normalizes whitespace and matches only the supplied displayed fields", () => {
    expect(normalizeTableSearchTerm("  Fixture CLIENT  ")).toBe("fixture client")
    expect(matchesTableSearchTerm("  client ", ["BK-1", "Fixture Client"])).toBe(true)
    expect(matchesTableSearchTerm("private", ["BK-1", "Fixture Client"])).toBe(false)
    expect(matchesTableSearchTerm("", [undefined, null])).toBe(true)
  })
})
