export type DashboardDataSource = "bookings" | "payments"

export type DashboardDataErrors = Partial<Record<string, string>>

export type DashboardDataStatus = "loading" | "ready" | "unavailable"

export interface DashboardDataReadiness {
  status: DashboardDataStatus
  error: string | null
  failedSources: DashboardDataSource[]
}

export function getDashboardDataReadiness({
  isLoading,
  dataError,
  dataErrors = {},
}: {
  isLoading: boolean
  dataError?: string | null
  dataErrors?: DashboardDataErrors
}): DashboardDataReadiness {
  const failedSources = (["bookings", "payments"] as DashboardDataSource[]).filter(
    (source) => Boolean(dataErrors[source]),
  )
  const hasUnscopedError = Boolean(dataError) && Object.keys(dataErrors).length === 0
  const error = failedSources.length > 0 || hasUnscopedError
    ? dataError || failedSources.map((source) => dataErrors[source]).filter(Boolean).join(" ") || null
    : null

  if (isLoading) return { status: "loading", error, failedSources }
  if (hasUnscopedError && failedSources.length === 0) {
    return { status: "unavailable", error, failedSources: ["bookings", "payments"] }
  }
  if (error) return { status: "unavailable", error, failedSources }
  return { status: "ready", error: null, failedSources: [] }
}
