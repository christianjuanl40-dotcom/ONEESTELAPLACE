export type TableSortDirection = "asc" | "desc"

export type TableSortableValue = string | number | Date | null | undefined

function isMissing(value: TableSortableValue) {
  if (value === null || value === undefined) return true
  if (typeof value === "number") return !Number.isFinite(value)
  if (value instanceof Date) return Number.isNaN(value.getTime())
  return value.trim().length === 0
}

function comparePresentValues(left: Exclude<TableSortableValue, null | undefined>, right: Exclude<TableSortableValue, null | undefined>) {
  const leftValue = left instanceof Date ? left.getTime() : left
  const rightValue = right instanceof Date ? right.getTime() : right

  if (typeof leftValue === "number" && typeof rightValue === "number") {
    return leftValue - rightValue
  }

  return String(leftValue).localeCompare(String(rightValue), undefined, {
    numeric: true,
    sensitivity: "base",
  })
}

/**
 * Sort a copy of a collection without mutating the source array. Missing values
 * stay at the end in either direction and equal values retain their source
 * order so filter/sort interactions remain predictable.
 */
export function stableSortBy<T>(
  items: readonly T[],
  getValue: (item: T) => TableSortableValue,
  direction: TableSortDirection = "asc",
) {
  return items
    .map((item, index) => ({ item, index, value: getValue(item) }))
    .sort((left, right) => {
      const leftMissing = isMissing(left.value)
      const rightMissing = isMissing(right.value)

      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) return left.index - right.index
        return leftMissing ? 1 : -1
      }

      const comparison = comparePresentValues(left.value!, right.value!)
      return comparison === 0
        ? left.index - right.index
        : direction === "asc"
          ? comparison
          : -comparison
    })
    .map(({ item }) => item)
}

export type PaginatedItems<T> = {
  items: T[]
  page: number
  pageSize: number
  totalPages: number
  startIndex: number
  endIndex: number
}

/** Clamp an arbitrary page and return a predictable slice, including empty data. */
export function paginateItems<T>(items: readonly T[], page: number, pageSize: number): PaginatedItems<T> {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 1
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize))
  const safePage = Number.isFinite(page) && page > 0
    ? Math.min(Math.floor(page), totalPages)
    : 1
  const startIndex = items.length === 0 ? 0 : (safePage - 1) * safePageSize
  const endIndex = Math.min(startIndex + safePageSize, items.length)

  return {
    items: items.slice(startIndex, endIndex),
    page: safePage,
    pageSize: safePageSize,
    totalPages,
    startIndex,
    endIndex,
  }
}

export function normalizeTableSearchTerm(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase()
}

export function matchesTableSearchTerm(term: unknown, values: readonly unknown[]) {
  const normalizedTerm = normalizeTableSearchTerm(term)
  if (!normalizedTerm) return true

  return values.some((value) => normalizeTableSearchTerm(value).includes(normalizedTerm))
}
