import { describe, expect, it } from "vitest"
import {
  getCatalogStatus,
  getCatalogStatusLabel,
  isCatalogPublished,
  isCatalogUnderRenovation,
  setCatalogStatus,
} from "@/src/modules/shared/lib/catalog-status"

describe("catalog status compatibility", () => {
  it("maps legacy hidden values to Under Renovation and missing values to Published", () => {
    expect(getCatalogStatus({ isHidden: true })).toBe("under_renovation")
    expect(getCatalogStatus({ status: "Hidden" })).toBe("under_renovation")
    expect(getCatalogStatus({ status: "Under Renovation" })).toBe("under_renovation")
    expect(getCatalogStatus({})).toBe("published")
    expect(getCatalogStatus({ catalogStatus: "published", isHidden: true })).toBe("published")
  })

  it("keeps the catalog status independent from date maintenance", () => {
    const resource = setCatalogStatus({ id: "venue-1", maintenance: "active" }, "under_renovation")
    expect(resource).toMatchObject({ catalogStatus: "under_renovation", isHidden: true, maintenance: "active" })
    expect(isCatalogUnderRenovation(resource)).toBe(true)
    expect(isCatalogPublished({ catalogStatus: "published", maintenance: "active" })).toBe(true)
  })

  it("provides customer/admin labels for the two catalog states", () => {
    expect(getCatalogStatusLabel("published")).toBe("Published")
    expect(getCatalogStatusLabel("under_renovation")).toBe("Under Renovation")
  })
})
