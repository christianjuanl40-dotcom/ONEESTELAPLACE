import { describe, expect, it } from "vitest"
import { getBookingCreationTime, sortBookingsByCreationTime } from "../booking-sorting"

describe("booking creation sorting", () => {
  it("normalizes supported Firestore, Date, ISO, and numeric timestamp forms", () => {
    const expected = Date.parse("2030-05-10T00:00:00.000Z")

    expect(getBookingCreationTime("2030-05-10T00:00:00.000Z")).toBe(expected)
    expect(getBookingCreationTime(new Date(expected))).toBe(expected)
    expect(getBookingCreationTime({ toMillis: () => expected })).toBe(expected)
    expect(getBookingCreationTime({ toDate: () => new Date(expected) })).toBe(expected)
    expect(getBookingCreationTime({ seconds: expected / 1000, nanoseconds: 0 })).toBe(expected)
    expect(getBookingCreationTime(String(expected / 1000))).toBe(expected)
    expect(getBookingCreationTime(expected)).toBe(expected)
    expect(getBookingCreationTime("not-a-timestamp")).toBeNull()
  })

  it("sorts newest first without using reservation date or mutating the source", () => {
    const rows = [
      { id: "BOOK-OLD", createdAt: "2030-01-01T00:00:00Z", date: "2030-12-31" },
      { id: "BOOK-NEW", createdAt: "2030-05-01T00:00:00Z", date: "2030-01-01" },
      { id: "BOOK-MISSING", createdAt: undefined, date: "2030-06-01" },
    ]

    expect(sortBookingsByCreationTime(rows).map((row) => row.id)).toEqual([
      "BOOK-NEW",
      "BOOK-OLD",
      "BOOK-MISSING",
    ])
    expect(rows.map((row) => row.id)).toEqual(["BOOK-OLD", "BOOK-NEW", "BOOK-MISSING"])
  })

  it("uses the immutable booking ID for equal and missing timestamps", () => {
    const rows = [
      { id: "BOOK-10", createdAt: "2030-03-01T00:00:00Z" },
      { id: "BOOK-2", createdAt: "2030-03-01T00:00:00Z" },
      { id: "BOOK-30", createdAt: "invalid" },
      { id: "BOOK-20", createdAt: undefined },
    ]

    expect(sortBookingsByCreationTime(rows).map((row) => row.id)).toEqual([
      "BOOK-2",
      "BOOK-10",
      "BOOK-20",
      "BOOK-30",
    ])
    expect(sortBookingsByCreationTime(rows, "asc").map((row) => row.id)).toEqual([
      "BOOK-2",
      "BOOK-10",
      "BOOK-20",
      "BOOK-30",
    ])
  })
})
