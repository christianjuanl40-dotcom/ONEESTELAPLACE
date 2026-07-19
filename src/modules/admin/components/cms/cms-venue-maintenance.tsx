"use client"

import { useMemo, useState } from "react"
import { X, Trash2 } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { useToast } from "@shared/hooks/use-toast"
import { useBookings } from "@/src/modules/client/contexts/booking-context"

interface Props {
  venueId: string
  venueName: string
  open: boolean
  onClose: () => void
}

export function CMSVenueMaintenance({ venueId, venueName, open, onClose }: Props) {
  const { maintenanceRecords, addMaintenanceRecord, removeMaintenanceRecord } = useBookings()
  const { toast } = useToast()

  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [reason, setReason] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const todayStr = new Date().toISOString().split("T")[0]

  const venueRecords = useMemo(() => {
    return maintenanceRecords.filter(
      (r) => r.spaceId === venueId,
    )
  }, [maintenanceRecords, venueId])

  const handleAdd = async () => {
    if (!startDate) {
      toast({
        title: "Date Required",
        description: "Please select at least a start date.",
        variant: "destructive",
      })
      return
    }

    const datesToAdd: string[] = []
    if (endDate && endDate >= startDate) {
      const current = new Date(startDate + "T00:00:00")
      const end = new Date(endDate + "T00:00:00")
      while (current <= end) {
        const y = current.getFullYear()
        const m = String(current.getMonth() + 1).padStart(2, "0")
        const d = String(current.getDate()).padStart(2, "0")
        datesToAdd.push(`${y}-${m}-${d}`)
        current.setDate(current.getDate() + 1)
      }
    } else {
      datesToAdd.push(startDate)
    }

    setIsSaving(true)
    let added = 0
    for (const dateStr of datesToAdd) {
      const exists = maintenanceRecords.some(
        (r) => r.spaceId === venueId && r.date === dateStr,
      )
      if (!exists) {
        addMaintenanceRecord({
          type: "venue",
          spaceId: venueId,
          spaceName: venueName,
          date: dateStr,
          startDate: dateStr,
          endDate: dateStr,
          reason: reason || "",
          status: "Active",
        })
        added++
      }
    }
    setIsSaving(false)

    setStartDate("")
    setEndDate("")
    setReason("")

    toast({
      title: "Maintenance Saved",
      description: `Blocked ${added} date${added === 1 ? "" : "s"} for ${venueName}.`,
    })
  }

  const handleRemove = (recordId: string) => {
    removeMaintenanceRecord(recordId)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl max-h-[calc(100dvh-32px)] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
          <h2 className="text-base font-black text-slate-950">
            Venue Maintenance — {venueName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {venueRecords.length > 0 && (
            <div>
              <p className="mb-2 text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">
                Blocked Dates
              </p>
              <div className="max-h-[200px] space-y-1.5 overflow-y-auto">
                {venueRecords.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-slate-700">
                        {(() => {
                          try {
                            return new Intl.DateTimeFormat("en-PH", {
                              month: "short",
                              day: "2-digit",
                              year: "numeric",
                            }).format(new Date(rec.date + "T00:00:00"))
                          } catch {
                            return rec.date
                          }
                        })()}
                      </p>
                      {rec.reason && (
                        <p className="truncate text-[9px] font-semibold text-slate-400">
                          {rec.reason}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(rec.id)}
                      className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">
                Start Date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                min={todayStr}
                className="mt-1 h-9 rounded-lg border-slate-200 text-[11px] font-bold"
              />
            </div>
            <div>
              <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">
                End Date
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || todayStr}
                className="mt-1 h-9 rounded-lg border-slate-200 text-[11px] font-bold"
              />
            </div>
          </div>

          <div>
            <label className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">
              Reason <span className="text-slate-300">(optional)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Annual plumbing inspection"
              className="mt-1 min-h-[52px] w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
          </div>

          <Button
            onClick={handleAdd}
            disabled={isSaving || !startDate}
            className="h-9 w-full rounded-lg bg-slate-900 text-[11px] font-black text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {isSaving ? "Saving..." : "Block Dates"}
          </Button>
        </div>
      </div>
    </div>
  )
}
