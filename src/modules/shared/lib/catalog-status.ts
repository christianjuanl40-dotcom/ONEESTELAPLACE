export const CATALOG_STATUS_OPTIONS = ["published", "under_renovation"] as const

export type CatalogStatus = (typeof CATALOG_STATUS_OPTIONS)[number]

type CatalogStatusRecord = {
  catalogStatus?: unknown
  status?: unknown
  isHidden?: unknown
}

function normalizeStatusValue(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[\s-]+/g, "_")
    : ""
}

export function parseCatalogStatus(value: unknown): CatalogStatus | null {
  const normalized = normalizeStatusValue(value)
  if (normalized === "published" || normalized === "visible" || normalized === "active") return "published"
  if (
    normalized === "under_renovation"
    || normalized === "renovation"
    || normalized === "under_maintenance"
    || normalized === "maintenance"
    || normalized === "hidden"
  ) return "under_renovation"
  return null
}

/** Resolve catalog publication without conflating it with booking or calendar status. */
export function getCatalogStatus(resource: unknown): CatalogStatus {
  if (!resource || typeof resource !== "object") return "published"
  const entry = resource as CatalogStatusRecord
  return parseCatalogStatus(entry.catalogStatus)
    || parseCatalogStatus(entry.status)
    || (entry.isHidden === true ? "under_renovation" : "published")
}

export function isCatalogUnderRenovation(resource: unknown): boolean {
  return getCatalogStatus(resource) === "under_renovation"
}

export function isCatalogPublished(resource: unknown): boolean {
  return getCatalogStatus(resource) === "published"
}

export function setCatalogStatus<T extends Record<string, unknown>>(resource: T, status: CatalogStatus): T & {
  catalogStatus: CatalogStatus
  isHidden: boolean
} {
  return {
    ...resource,
    catalogStatus: status,
    // Keep the legacy field synchronized for older clients while they roll forward.
    isHidden: status === "under_renovation",
  }
}

export function getCatalogStatusLabel(status: CatalogStatus): string {
  return status === "under_renovation" ? "Under Renovation" : "Published"
}
