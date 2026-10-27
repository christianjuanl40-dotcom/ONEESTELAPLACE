import type { AvailabilityCategory, AvailabilitySpace } from "./availability"

type Data = Record<string, unknown>
type Kind = "booking" | "maintenance" | "rental"
type Target = { space: AvailabilitySpace; item: Data; room?: Data }
export type ResourceResolution =
  | { status: "resolved"; space: AvailabilitySpace }
  | { status: "ambiguous" | "unresolved"; candidates: AvailabilitySpace[] }

const text = (value: unknown) => typeof value === "string" ? value.trim() : ""
const label = (value: unknown) => text(value).toLowerCase().replace(/\s+/g, " ")
const records = (value: unknown): Data[] => Array.isArray(value)
  ? value.filter((entry): entry is Data => Boolean(entry && typeof entry === "object")) : []
const names = (item: Data) => [item.name, ...(Array.isArray(item.legacyNames) ? item.legacyNames : [])]
  .map(label).filter(Boolean)

function explicitCategory(record: Data): AvailabilityCategory | null {
  for (const field of [record.bookingCategory, record.bookingType, record.rentalType]) {
    const value = label(field).replace(/[\s-]+/g, "_")
    if (["office", "office_rental", "office_space_rental"].includes(value)) return "office"
    if (["venue", "event", "event_venue", "event_venue_rental"].includes(value)) return "venue"
  }
  if (typeof record.isOfficeRental === "boolean") return record.isOfficeRental ? "office" : "venue"
  return text(record.officeId) ? "office" : null
}

/** Display labels and customer event titles never determine a booking category. */
export function isOfficeResourceBooking(record: object): boolean {
  return explicitCategory(record as Data) === "office"
}

function targets(catalog: Data): Target[] {
  const result: Target[] = []
  for (const category of ["venue", "office"] as const) {
    for (const item of records(catalog[category === "office" ? "offices" : "venues"])) {
      const id = text(item.id)
      if (!id) continue
      const space: AvailabilitySpace = {
        category, venueId: id, spaceId: id, name: text(item.name), catalog,
        ...(category === "office" ? { officeId: id } : {}),
      }
      result.push({ space, item })
      if (category === "office") {
        for (const room of records(item.rooms)) {
          if (text(room.id)) result.push({ item, room,
            space: { ...space, spaceId: text(room.id), roomName: text(room.name) } })
        }
      }
    }
  }
  return result
}

/** Includes archived identities so historical relationships and alias ambiguity survive archiving. */
export function getCatalogAvailabilitySpace(
  catalog: object,
  category: AvailabilityCategory,
  id: string,
  roomId?: string,
  allowBuilding = false,
): AvailabilitySpace | null {
  if (category === "office" && !roomId && !allowBuilding) return null
  const parents = records((catalog as Data)[category === "office" ? "offices" : "venues"]).filter((item) => item.id === id)
  if (parents.length !== 1) return null
  const matches = targets(catalog as Data).filter(({ space, room }) => space.category === category
    && space.venueId === id && (roomId ? Boolean(room) && space.spaceId === roomId : !room))
  return matches.length === 1 ? matches[0].space : null
}

function fullNames(target: Target): string[] {
  if (!target.room) return names(target.item)
  return names(target.item).flatMap((parent) => names(target.room!).map((room) => `${parent} - ${room}`))
}

/** Exact IDs first, then exact current/explicit historical labels. Never parse room
 * numbers, infer ID prefixes, use array positions, or match substrings. */
export function resolveResourceSpace(catalogValue: object, recordValue: object, kind: Kind = "booking"): ResourceResolution {
  const catalog = catalogValue as Data
  const record = recordValue as Data
  const category = kind === "rental" ? "office"
    : kind === "maintenance" && ["venue", "office"].includes(text(record.type)) ? record.type as AvailabilityCategory
      : explicitCategory(record)
  const allTargets = targets(catalog).filter(({ space }) => !category || space.category === category)
  let candidates = allTargets
  let atomicReference = false
  let hasReference = false
  const references = ["officeId", "venueId", "spaceId", "officeSpaceId", "roomId"] as const
  for (const field of references) {
    const reference = text(record[field])
    if (!reference) continue
    hasReference = true
    const parentField = field === "officeId" || field === "venueId"
    // Child references are scoped to an already established building. A room
    // ID in another building must not shadow this building's exact legacy alias.
    const lookupTargets = parentField ? allTargets : candidates
    const exact = lookupTargets.filter((target) => parentField
      ? target.space.venueId === reference || (field === "venueId" && target.space.spaceId === reference)
      : target.space.spaceId === reference)
    if (exact.length) {
      candidates = candidates.filter((target) => exact.includes(target))
      if (!parentField || exact.every((target) => target.room && target.space.venueId !== reference)) atomicReference = true
    } else {
      candidates = candidates.filter((target) => (parentField && names(target.item).includes(label(reference)))
        || fullNames(target).includes(label(reference))
        || (field === "roomId" && Boolean(target.room) && names(target.room!).includes(label(reference))))
      if (field === "roomId") atomicReference = true
    }
    if (!candidates.length) return { status: "unresolved", candidates: [] }
  }

  if (record.scope === "building") {
    candidates = candidates.filter((target) => target.space.category === "office" && !target.room)
    if (hasReference) atomicReference = true
  }
  if (record.scope === "room") candidates = candidates.filter((target) => Boolean(target.room))
  if (record.scope === "venue") candidates = candidates.filter((target) => target.space.category === "venue")

  // Canonical room/venue references win over immutable historical display snapshots.
  const canonicalVenue = hasReference && candidates.length === 1 && candidates[0].space.category === "venue"
  if (!atomicReference && !canonicalVenue) {
    const roomName = label(record.roomName)
    const displayNames = [record.venue, record.spaceName, record.officeSpaceName, record.name].map(label).filter(Boolean)
    if (roomName) {
      candidates = candidates.filter((target) => target.room && names(target.room).includes(roomName))
    } else if (displayNames.length) {
      candidates = candidates.filter((target) => fullNames(target).some((name) => displayNames.includes(name)))
    } else if (hasReference) {
      candidates = candidates.filter((target) => !target.room)
    } else {
      candidates = []
    }
  }
  if (candidates.length === 1) return { status: "resolved", space: candidates[0].space }
  return { status: candidates.length > 1 ? "ambiguous" : "unresolved", candidates: candidates.map((target) => target.space) }
}

export function resourceSpacesOverlap(first: AvailabilitySpace, second: AvailabilitySpace): boolean {
  if (first.category !== second.category || first.venueId !== second.venueId) return false
  return first.category === "venue" || !first.spaceId || first.spaceId === first.venueId
    || !second.spaceId || second.spaceId === second.venueId || first.spaceId === second.spaceId
}

export function ambiguousResourceAffectsSpace(catalog: Data, record: Data, space: AvailabilitySpace, kind: Kind): boolean {
  const resolved = resolveResourceSpace(catalog, record, kind)
  return resolved.status === "ambiguous" && resolved.candidates.some((candidate) => resourceSpacesOverlap(candidate, space))
}

export function unresolvedResourceAffectsSpace(catalog: Data, record: Data, space: AvailabilitySpace, kind: Kind): boolean {
  if (resolveResourceSpace(catalog, record, kind).status !== "unresolved") return false
  if (kind === "rental" && space.category !== "office") return false
  const category = kind === "maintenance" ? text(record.type) : explicitCategory(record)
  if (category && category !== space.category) return false
  return [record.officeId, record.venueId].some((id) => text(id) === space.venueId)
    || [record.spaceId, record.officeSpaceId].some((id) => text(id) === space.spaceId)
}

/** A single-resource registry is useful to pure callers; production uses the full
 * catalog so duplicate aliases across resources are detected instead of guessed. */
export function catalogForAvailabilitySpace(space: AvailabilitySpace): Data {
  return space.catalog || (space.category === "venue"
    ? { venues: [{ id: space.venueId, name: space.name }], offices: [] }
    : { venues: [], offices: [{ id: space.officeId || space.venueId, name: space.name,
        rooms: space.spaceId && space.spaceId !== space.venueId ? [{ id: space.spaceId, name: space.roomName }] : [] }] })
}
