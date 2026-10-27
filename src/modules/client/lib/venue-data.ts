import type { SpaceDescription } from "@/src/modules/shared/lib/space-description"
import { getCatalogStatus, type CatalogStatus } from "@/src/modules/shared/lib/catalog-status"

let cachedVenues: any[] | null = null
let cachedOffices: any[] | null = null

export function setCachedVenuesAndOffices(venues: any[], offices: any[]) {
  cachedVenues = venues
  cachedOffices = offices
}

export type PublicSpace = SpaceDescription & {
  id: string
  name: string
  legacyNames?: string[]
  category: "venue" | "office"
  price: number
  capacity: string
  description: string
  image: string
  panoramaUrl: string
  type?: string
  panoImage?: string
  catalogStatus?: CatalogStatus
  isHidden?: boolean
  downPaymentPercentage?: number
  rooms?: any[]
}

export type PublicSpacesResult = {
  eventVenues: PublicSpace[]
  officeSpaces: PublicSpace[]
}

const DEFAULT_VENUES: PublicSpace[] = [
  {
    id: "v1", name: "The Milestone Event", category: "venue", price: 15000,
    capacity: "80–100 pax", description: "Premium space for grand celebrations and corporate events.",
    image: "/images/venue-chandelier.png", panoramaUrl: "", panoImage: "",
  },
  {
    id: "v2", name: "The Moment Event", category: "venue", price: 10000,
    capacity: "30–50 pax", description: "Intimate setting perfect for memorable milestones.",
    image: "/images/venue-interior.jpg", panoramaUrl: "", panoImage: "",
  },
  {
    id: "v3", name: "Conference Room", category: "venue", price: 3000,
    capacity: "4–10 pax", description: "Professional environment equipped for critical decisions.",
    image: "/images/venue-interior.jpg", panoramaUrl: "", panoImage: "",
  },
  {
    id: "v4", name: "Business Room", category: "venue", price: 5000,
    capacity: "10–15 pax", description: "Spacious meeting area ideal for collaborations.",
    image: "/images/venue-interior.jpg", panoramaUrl: "", panoImage: "",
  },
]

const DEFAULT_OFFICES: PublicSpace[] = [
  {
    id: "office-a", name: "Office A", category: "office", price: 15000,
    capacity: "1-4 pax per room", description: "Premium office wing with 8 individual private rooms.",
    image: "/images/venue-interior.jpg", panoramaUrl: "", panoImage: "",
  },
  {
    id: "office-b", name: "Office B", category: "office", price: 15000,
    capacity: "1-4 pax per room", description: "Executive office wing with 8 individual private rooms.",
    image: "/images/venue-interior.jpg", panoramaUrl: "", panoImage: "",
  },
]

function normalizeItem(item: any, category: "venue" | "office"): PublicSpace {
  const catalogStatus = getCatalogStatus(item)
  return {
    id: String(item.id || ""),
    name: String(item.name || "Unnamed Space"),
    legacyNames: Array.isArray(item.legacyNames) ? item.legacyNames.filter((name: unknown) => typeof name === "string") : [],
    category,
    price: Number(item.price) || 0,
    capacity: String(item.capacity || ""),
    description: String(item.description || ""),
    detailedDescription: String(item.detailedDescription || ""),
    image: String(item.image || ""),
    panoramaUrl: String(item.panoramaUrl || item.panoImage || item.panorama || item.tourImage || ""),
    panoImage: String(item.panoImage || item.panoramaUrl || item.panorama || item.tourImage || ""),
    catalogStatus,
    // Keep the old public shape available to older consumers during the rollout.
    isHidden: catalogStatus === "under_renovation",
    downPaymentPercentage: Number(item.downPaymentPercentage) || 50,
    ...(Object.prototype.hasOwnProperty.call(item, "rooms")
      ? { rooms: Array.isArray(item.rooms) ? item.rooms.filter((r: any) => !r.isArchived) : [] }
      : {}),
  }
}

export function getPublicSpacesFromData(cmsData: any): PublicSpacesResult {
  const rawVenues = Array.isArray(cmsData?.venues) ? cmsData.venues : DEFAULT_VENUES
  const rawOffices = Array.isArray(cmsData?.offices) ? cmsData.offices : DEFAULT_OFFICES

  return {
    eventVenues: rawVenues
      .filter((v: any) => !v.isArchived)
      .map((v: any) => normalizeItem(v, "venue")),
    officeSpaces: rawOffices
      .filter((o: any) => !o.isArchived)
      .map((o: any) => normalizeItem(o, "office")),
  }
}

export function getPublicSpaces(): PublicSpacesResult {
  return getPublicSpacesFromData({ venues: cachedVenues, offices: cachedOffices })
}

export function getPanoramaSource(space: PublicSpace | null | undefined): string {
  if (!space) return ""
  return space.panoramaUrl || space.image || ""
}
