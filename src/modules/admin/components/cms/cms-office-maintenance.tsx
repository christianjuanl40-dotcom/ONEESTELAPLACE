"use client"

import { useMemo, useState } from "react"
import { X, Trash2, Calendar } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { useToast } from "@shared/hooks/use-toast"
import { useBookings } from "@/src/modules/client/contexts/booking-context"
import { getAllOffices } from "@/lib/central-data"

interface Props {
  buildingName: string
  open: boolean
  onClose: () => void
}

function getRoomGroup(name: string): "A" | "B" {
  const v = name.toLowerCase()
  if (v.includes("a") || v.includes("1") || v === "ground") return "A"
  return "B"
}

export function CMSOfficeMaintenance({ buildingName, open, onClose }: Props) {
  const { maintenanceRecords, addMaintenanceRecord, removeMaintenanceRecord } = useBookings()
  const { toast } = useToast()

  const group = getRoomGroup(buildingName)

  const buildingRooms = useMemo(() => {
    const allOffices = getAllOffices()
    return allOffices.filter((o) => {
      const num = parseInt(o.id.slice(1))
      return group === "A" ? num >= 1 && num <= 8 : num >= 9 && num <= 16
    })
  }, [group])

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [reason, setReason] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const todayStr = new Date().toISOString().split("T")[0]

  const activeRoom = buildingRooms.find((r) => r.id === activeRoomId)

  const roomRecords = useMemo(() => {
    if (!activeRoomId) return []
    return maintenanceRecords.filter(
      (r) => r.spaceId === activeRoomId || r.spaceName === activeRoomId,
    )
  }, [maintenanceRecords, activeRoomId])

  const allRoomRecords = useMemo(() => {
    const map = new Map<string, typeof maintenanceRecords>()
    for (const r of maintenanceRecords) {
      const key = r.spaceId
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return map
  }, [maintenanceRecords])

  const handleAdd = async () => {
    if (!activeRoomId || !startDate) {
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
        (r) => r.spaceId === activeRoomId && r.date === dateStr,
      )
      if (!exists) {
        addMaintenanceRecord({
          type: "office",
          spaceId: activeRoomId,
          spaceName: activeRoom?.name || activeRoomId,
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
      description: `Blocked ${added} date${added === 1 ? "" : "s"} for ${activeRoom?.name || activeRoomId}.`,
    })
  }

  const handleRemove = (recordId: string) => {
    removeMaintenanceRecord(recordId)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl max-h-[calc(100dvh-32px)] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
          <h2 className="text-base font-black text-slate-950">
            Room Maintenance — {buildingName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {buildingRooms.map((room) => {
            const roomNum = parseInt(room.id.slice(1))
            const localNum = group === "A" ? roomNum : roomNum - 8
            const records = allRoomRecords.get(room.id) || []
            const hasActiveMaint = records.length > 0
            const isActive = activeRoomId === room.id

            return (
              <div
                key={room.id}
                className={`rounded-xl border transition ${
                  isActive
                    ? "border-orange-300 bg-orange-50/50 shadow-sm"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-xs font-black text-slate-600">
                      {localNum}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{room.name}</p>
                      <p className="text-[10px] font-semibold text-slate-400">
                        ₱{room.price.toLocaleString("en-PH")}/mo
                        {hasActiveMaint && (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-white">
                            <Calendar className="h-2.5 w-2.5" />
                            {records.length} date{records.length > 1 ? "s" : ""}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setActiveRoomId(isActive ? null : room.id)
                      setStartDate("")
                      setEndDate("")
                      setReason("")
                    }}
                    className={`h-8 rounded-lg px-3 text-[10px] font-bold ${
                      isActive
                        ? "bg-orange-600 text-white hover:bg-orange-700"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {isActive ? "Close" : "Maintenance"}
                  </Button>
                </div>

                {isActive && (
                  <div className="border-t border-orange-200 px-4 py-4 space-y-4">
                    {records.length > 0 && (
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">
                          Blocked Dates
                        </p>
                        <div className="space-y-1.5 max-h-[180px] overflow-y-auto">
                          {records.map((rec) => (
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
                                  <p className="text-[9px] font-semibold text-slate-400 truncate">
                                    {rec.reason}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleRemove(rec.id)}
                                className="shrink-0 p-1 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500"
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
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 placeholder:text-slate-300 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 resize-none min-h-[52px]"
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
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
