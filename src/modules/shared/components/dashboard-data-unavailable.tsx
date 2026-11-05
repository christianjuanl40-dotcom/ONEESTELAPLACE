"use client"

import { AlertCircle, RotateCcw } from "lucide-react"
import { Button } from "./ui/button"

export function DashboardDataUnavailable({
  error,
  onRetry,
}: {
  error: string | null
  onRetry: () => void
}) {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <section
        role="alert"
        aria-labelledby="dashboard-data-unavailable-title"
        className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-6 py-10 text-center"
      >
        <AlertCircle className="h-7 w-7 text-rose-600" aria-hidden="true" />
        <h1 id="dashboard-data-unavailable-title" className="mt-4 text-base font-black text-rose-900">
          Financial information unavailable
        </h1>
        <p className="mt-1 max-w-lg text-sm leading-6 text-rose-700">
          Required booking or payment data could not be loaded. No empty or partial financial totals are shown.
        </p>
        {error && <p className="mt-2 max-w-lg text-xs leading-5 text-rose-700">{error}</p>}
        <Button
          type="button"
          onClick={onRetry}
          className="mt-5 h-10 rounded-xl bg-rose-700 px-4 text-xs font-black text-white hover:bg-rose-800"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Retry dashboard data
        </Button>
      </section>
    </div>
  )
}
