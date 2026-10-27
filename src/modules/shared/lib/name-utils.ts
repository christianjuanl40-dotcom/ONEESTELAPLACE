export interface NameParts {
  firstName: string
  middleName: string
  lastName: string
}

export interface NameSource extends Partial<NameParts> {
  fullName?: unknown
  name?: unknown
}

function cleanNamePart(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""
}

export function getStructuredName(source: NameSource | null | undefined): NameParts {
  return {
    firstName: cleanNamePart(source?.firstName),
    middleName: cleanNamePart(source?.middleName),
    lastName: cleanNamePart(source?.lastName),
  }
}

export function formatDisplayName(
  source: NameSource | null | undefined,
  fallback = "",
): string {
  const parts = getStructuredName(source)
  const structuredName = [parts.firstName, parts.middleName, parts.lastName]
    .filter(Boolean)
    .join(" ")

  if (structuredName) return structuredName

  return cleanNamePart(source?.fullName) || cleanNamePart(source?.name) || cleanNamePart(fallback)
}
