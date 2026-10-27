export type SpaceDescription = {
  description?: string
  detailedDescription?: string
}

export function getDetailedDescription(space?: SpaceDescription | null): string {
  return space?.detailedDescription?.trim()
    ? space.detailedDescription
    : space?.description || ""
}
