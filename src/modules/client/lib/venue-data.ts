let cachedVenues: any[] | null = null
let cachedOffices: any[] | null = null

export function setCachedVenuesAndOffices(venues: any[], offices: any[]) {
  cachedVenues = venues
  cachedOffices = offices
}

export type PublicSpace = {
  id: string
  name: string
  category: "venue" | "office"
  price: number
  capacity: string
  description: string
  image: string
  panoramaUrl: string
  type?: string
  panoImage?: string
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
  return {
    id: String(item.id || ""),
    name: String(item.name || "Unnamed Space"),
    category,
    price: Number(item.price) || 0,
    capacity: String(item.capacity || ""),
    description: String(item.description || ""),
    image: String(item.image || ""),
    panoramaUrl: String(item.panoramaUrl || item.panoImage || item.panorama || item.tourImage || ""),
    panoImage: String(item.panoImage || item.panoramaUrl || item.panorama || item.tourImage || ""),
    isHidden: item.isHidden === true,
    downPaymentPercentage: Number(item.downPaymentPercentage) || 50,
    rooms: Array.isArray(item.rooms) ? item.rooms.filter((r: any) => !r.isArchived) : [],
  }
}

const NON_BOOKABLE_VENUE_NAMES = ["Grand Ballroom", "Intimate Lounge"]

export function getPublicSpacesFromData(cmsData: any): PublicSpacesResult {
  const rawVenues = Array.isArray(cmsData?.venues) ? cmsData.venues : []
  const rawOffices = Array.isArray(cmsData?.offices) ? cmsData.offices : []

  const mergeSpaces = <T extends { id: string }>(cmsItems: T[], defaults: T[]) => {
    if (cmsItems.length === 0) return defaults;
    const merged = [...cmsItems];
    for (const def of defaults) {
      if (!merged.some((m) => String(m.id) === String(def.id))) {
        merged.push(def);
      }
    }
    return merged;
  }

  return {
    eventVenues: mergeSpaces(rawVenues, DEFAULT_VENUES)
      .filter((v: any) => !v.isArchived)
      .map((v: any) => normalizeItem(v, "venue"))
      .filter((v) => !NON_BOOKABLE_VENUE_NAMES.includes(v.name)),
    officeSpaces: mergeSpaces(rawOffices, DEFAULT_OFFICES)
      .filter((o: any) => !o.isArchived)
      .map((o: any) => normalizeItem(o, "office")),
  }
}

export function getPublicSpaces(): PublicSpacesResult {
  if (cachedVenues || cachedOffices) {
    return getPublicSpacesFromData({ venues: cachedVenues || [], offices: cachedOffices || [] })
  }
  return {
    eventVenues: DEFAULT_VENUES.filter((v) => !NON_BOOKABLE_VENUE_NAMES.includes(v.name)),
    officeSpaces: DEFAULT_OFFICES,
  }
}

export function getPanoramaSource(space: PublicSpace | null | undefined): string {
  if (!space) return ""
  return space.panoramaUrl || space.image || ""
}
