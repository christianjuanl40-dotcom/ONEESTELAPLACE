export type FacilityType = "venue" | "office";

export interface Facility {
  id: string;
  name: string;
  type: FacilityType;
  price: number;
  minPax: number;
  maxPax: number;
}

export const FACILITIES: Record<string, Facility> = {
  v1: { id: "v1", name: "The Milestone Event", type: "venue", price: 15000, minPax: 50, maxPax: 150 },
  v2: { id: "v2", name: "The Moment Event", type: "venue", price: 25000, minPax: 100, maxPax: 250 },
  v3: { id: "v3", name: "Conference Room", type: "venue", price: 50000, minPax: 150, maxPax: 500 },
  v4: { id: "v4", name: "Business Room", type: "venue", price: 20000, minPax: 30, maxPax: 100 },
  ...Object.fromEntries(
    Array.from({ length: 16 }).map((_, i) => [
      `o${i + 1}`, { id: `o${i + 1}`, name: `Office Room ${i + 1}`, type: "office", price: 5000, minPax: 1, maxPax: 10 }
    ])
  )
};

export const getFacility = (id: string) => FACILITIES[id] || FACILITIES["v1"];

// Ito yung naiwang function! Idinagdag na natin:
export const getAllVenues = () => Object.values(FACILITIES).filter(f => f.type === "venue");
export const getAllOffices = () => Object.values(FACILITIES).filter(f => f.type === "office");