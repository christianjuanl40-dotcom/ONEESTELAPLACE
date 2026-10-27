"use client"

import { useBookings } from "@/src/modules/client/contexts/booking-context"
import { Button } from "./ui/button"

export function DataLoadNotice() {
  const { dataError, retryData } = useBookings()
  if (!dataError) return null
  return <section role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
    <p>{dataError}</p>
    <Button variant="outline" onClick={retryData}>Retry data loading</Button>
  </section>
}
