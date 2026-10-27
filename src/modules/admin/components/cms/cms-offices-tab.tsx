"use client"

import { useState } from "react"
import { ChevronDown, DoorOpen, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { Textarea } from "@shared/components/ui/textarea"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS, type OfficeRoom } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSImageUpload, CMSPanoramaUpload } from "./cms-image-upload"
import { CMSStatusBadge, EmptyState } from "./cms-status-badge"
import { toPrice } from "@/src/modules/shared/lib/number-utils"
import { getImageSource } from "@/src/modules/shared/lib/file-utils"
import { getCatalogStatus, type CatalogStatus } from "@/src/modules/shared/lib/catalog-status"

type OfficeForm = { name: string; capacity: string; price: number | string; downPaymentPercentage: number | string; description: string; detailedDescription: string; image: string; panoImage: string; catalogStatus: CatalogStatus }
type CatalogStatusFilter = CatalogStatus | "all"
const EMPTY_FORM: OfficeForm = { name: "", capacity: "", price: "", downPaymentPercentage: 50, description: "", detailedDescription: "", image: "", panoImage: "", catalogStatus: "published" }

type RoomForm = { name: string }
const EMPTY_ROOM_FORM: RoomForm = { name: "" }

function getNextRoomNumber(rooms: { name: string }[]): number {
  let max = 0
  for (const r of rooms) {
    const match = r.name.match(/(\d+)$/)
    if (match) {
      const n = parseInt(match[1], 10)
      if (n > max) max = n
    }
  }
  return max + 1
}

export function CMSOfficesTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { offices, updateOffice, addOffice, deleteOffice, addRoomToOffice, addRoomsToOffice, updateRoomInOffice, deleteRoomFromOffice, getOfficeRooms } = useCMS()
  const { toast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<OfficeForm>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>("all")

  const [selectedOffice, setSelectedOffice] = useState<any>(null)
  const [showRoomForm, setShowRoomForm] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [roomForm, setRoomForm] = useState<RoomForm>(EMPTY_ROOM_FORM)
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<string | null>(null)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkCount, setBulkCount] = useState<string>("1")
  const [bulkPreview, setBulkPreview] = useState<string[] | null>(null)
  const [isRoomSaving, setIsRoomSaving] = useState(false)
  const isBusy = isSaving || isRoomSaving

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setSelectedOffice(null); setShowRoomForm(false); setEditingRoomId(null); setRoomForm(EMPTY_ROOM_FORM); setConfirmDeleteRoom(null); setShowModal(false) }
  const openNew = () => { resetForm(); setShowModal(true) }
  const openEdit = (o: any) => { setSelectedOffice(o); setEditingId(o.id); setForm({ name: o.name || "", capacity: o.capacity || "", price: o.price ?? "", downPaymentPercentage: o.downPaymentPercentage ?? 50, description: o.description || "", detailedDescription: o.detailedDescription || "", image: o.image || "", panoImage: o.panoImage || o.panoramaUrl || o.panorama || o.pano || o.tourImage || "", catalogStatus: getCatalogStatus(o) }); setShowRoomForm(false); setEditingRoomId(null); setRoomForm(EMPTY_ROOM_FORM); setConfirmDeleteRoom(null); setShowModal(true) }

  const handleSave = async () => {
    if (isBusy) return
    if (!form.name.trim()) { toast({ title: "Name required", description: "Enter an office name.", variant: "destructive" }); return }
    const pano = form.panoImage || ""
    const currentOffice = offices.find((o) => o.id === editingId)
    const currentPano = currentOffice?.panoImage || currentOffice?.panoramaUrl || currentOffice?.panorama || currentOffice?.pano || currentOffice?.tourImage || ""
    const panoramaFields = !editingId || pano !== currentPano ? { panoImage: pano, panoramaUrl: pano } : {}
    const data = { name: form.name.trim(), capacity: form.capacity?.trim() || "", price: toPrice(form.price), downPaymentPercentage: Math.min(100, Math.max(0, Number(form.downPaymentPercentage) || 50)), description: form.description || "", detailedDescription: form.detailedDescription || "", image: form.image || "/placeholder.jpg", ...panoramaFields, catalogStatus: editingId ? form.catalogStatus : "published" as const, updatedAt: new Date().toISOString() }
    setIsSaving(true)
    try {
      const saved = editingId ? await updateOffice(editingId, data) : await addOffice({ ...data, type: "office", rooms: [] })
      if (saved) resetForm()
    } catch {
      toast({ title: "Save failed", description: "Could not save the office. Please try again.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (isBusy) return
    setIsSaving(true)
    try {
      if (await deleteOffice(id)) {
        setConfirmDelete(null)
        toast({ title: "Office archived", description: "Office has been archived.", className: "bg-emerald-500 text-white border-none" })
      }
    } catch {
      toast({ title: "Save failed", description: "Could not archive the office. Please try again.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const openNewRoom = () => {
    const rooms = selectedOffice ? getOfficeRooms(selectedOffice.id) : []
    const nextNum = getNextRoomNumber(rooms)
    setRoomForm({ name: `Room ${nextNum}` })
    setEditingRoomId(null)
    setShowRoomForm(true)
  }
  const openEditRoom = (room: OfficeRoom) => { setRoomForm({ name: room.name || "" }); setEditingRoomId(room.id); setShowRoomForm(true) }
  const closeRoomForm = () => { setRoomForm(EMPTY_ROOM_FORM); setEditingRoomId(null); setShowRoomForm(false) }

  const handleSaveRoom = async () => {
    if (!selectedOffice || isBusy) return
    if (!roomForm.name.trim()) { toast({ title: "Name required", description: "Enter a room name.", variant: "destructive" }); return }
    const roomData = { name: roomForm.name.trim() }
    setIsRoomSaving(true)
    try {
      const saved = editingRoomId
        ? await updateRoomInOffice(selectedOffice.id, editingRoomId, roomData)
        : await addRoomToOffice(selectedOffice.id, roomData)
      if (saved) closeRoomForm()
    } catch {
      toast({ title: "Save failed", description: "Could not save the room. Please try again.", variant: "destructive" })
    } finally {
      setIsRoomSaving(false)
    }
  }

  const handleDeleteRoom = async (roomId: string) => {
    if (!selectedOffice || isBusy) return
    setIsRoomSaving(true)
    try {
      if (await deleteRoomFromOffice(selectedOffice.id, roomId)) setConfirmDeleteRoom(null)
    } catch {
      toast({ title: "Save failed", description: "Could not archive the room. Please try again.", variant: "destructive" })
    } finally {
      setIsRoomSaving(false)
    }
  }

  const openBulkModal = () => { setBulkCount("1"); setBulkPreview(null); setShowBulkModal(true) }
  const closeBulkModal = () => { setShowBulkModal(false); setBulkPreview(null); setBulkCount("1") }

  const generateBulkPreview = () => {
    if (!selectedOffice) return
    const count = Math.max(1, parseInt(bulkCount, 10) || 1)
    const rooms = getOfficeRooms(selectedOffice.id)
    let nextNum = getNextRoomNumber(rooms)
    const names: string[] = []
    for (let i = 0; i < count; i++) { names.push(`Room ${nextNum}`); nextNum++ }
    setBulkPreview(names)
  }

  const handleBulkConfirm = async () => {
    if (!selectedOffice || !bulkPreview || isBusy) return
    setIsRoomSaving(true)
    try {
      if (await addRoomsToOffice(selectedOffice.id, bulkPreview.map((name) => ({ name })))) closeBulkModal()
    } catch {
      toast({ title: "Save failed", description: "Could not add the rooms. Please try again.", variant: "destructive" })
    } finally {
      setIsRoomSaving(false)
    }
  }

  const activeOffices = offices.filter((o: any) => !o.isArchived)
  const filtered = activeOffices.filter((o: any) => statusFilter === "all" || getCatalogStatus(o) === statusFilter)

  const selectedOfficeRooms = selectedOffice ? getOfficeRooms(selectedOffice.id) : []

  return (
    <div>
      <CMSSectionHeader title="Office Spaces"
        currentSection="offices" onNavigate={onNavigate}
        action={<Button type="button" onClick={openNew} className="h-9 shrink-0 whitespace-nowrap rounded-lg bg-blue-600 px-3.5 text-sm font-bold text-white hover:bg-blue-700"><Plus className="mr-1 h-3.5 w-3.5" /> Add Office</Button>} />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="office-status-filter" className="text-xs font-bold text-slate-600">Status</label>
            <div className="relative">
              <select id="office-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as CatalogStatusFilter)}
                className="h-9 min-w-40 appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-9 text-xs font-bold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100">
                <option value="all">All</option>
                <option value="published">Published</option>
                <option value="under_renovation">Under Renovation</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            </div>
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-black">
                  <th className="px-4 py-2.5 w-14"></th>
                  <th className="px-4 py-2.5">Office</th>
                  <th className="px-4 py-2.5 hidden md:table-cell">Capacity</th>
                  <th className="px-4 py-2.5">Price</th>
                  <th className="px-4 py-2.5 hidden md:table-cell">Rooms</th>
                  <th className="px-4 py-2.5 hidden md:table-cell">Status</th>
                  <th className="px-4 py-2.5 text-right w-36">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o: any) => {
                  const roomCount = getOfficeRooms(o.id).length
                  return (
                    <tr key={o.id} className="border-b border-slate-50 text-sm transition hover:bg-slate-50/50">
                      <td className="px-4 py-2.5">
                        <div className="h-10 w-14 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                          <img src={getImageSource(o.image)} alt="" className="h-full w-full object-cover"
                            onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-bold text-slate-900">{o.name || "Untitled"}</td>
                      <td className="px-4 py-2.5 text-slate-600 hidden md:table-cell">{o.capacity || "—"}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-800">₱{toPrice(o.price).toLocaleString("en-PH")}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          <DoorOpen className="h-3 w-3" /> {roomCount}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell"><CMSStatusBadge status={getCatalogStatus(o)} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <button type="button" onClick={() => openEdit(o)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit Office"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => setConfirmDelete(o.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-rose-400 hover:bg-rose-50 hover:text-rose-600" title="Delete Office"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={statusFilter === "under_renovation" ? undefined : <Plus className="h-8 w-8 text-blue-400" />}
              title={statusFilter === "under_renovation" ? "No offices under renovation." : statusFilter === "published" ? "No published offices." : "No office spaces"}
              description={statusFilter === "all" ? "Add an office to get started." : undefined}
              action={statusFilter === "under_renovation" ? undefined : <Button type="button" onClick={openNew} className="h-9 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700"><Plus className="mr-1.5 h-4 w-4" /> Add Office</Button>} />
          </div>
        )}
      </section>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <h2 className="text-base font-black text-slate-950">{editingId ? "Edit Office" : "Add Office"}</h2>
              <button type="button" onClick={resetForm} disabled={isBusy} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 p-5">
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Office Name</label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Office A" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Capacity</label>
                  <Input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="1-4 pax" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Monthly Price (₱)</label>
                  <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="15000" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Down Payment (%)</label>
                  <Input type="number" min="0" max="100" value={form.downPaymentPercentage} onChange={(e) => setForm({ ...form, downPaymentPercentage: e.target.value })} placeholder="50" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                {editingId && <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Status</label>
                  <div className="relative mt-1">
                    <select value={form.catalogStatus} onChange={(e) => setForm({ ...form, catalogStatus: e.target.value as CatalogStatus })}
                      className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 cursor-pointer">
                      <option value="published">Published</option>
                      <option value="under_renovation">Under Renovation</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  </div>
                </div>}
              </div>
              <div>
                <label htmlFor="office-short-description" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Short Description</label>
                <Textarea id="office-short-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Office description..."
                  className="mt-1 w-full min-h-[128px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <div>
                <label htmlFor="office-detailed-description" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Expanded Description / Full Venue Details</label>
                <Textarea id="office-detailed-description" value={form.detailedDescription} onChange={(e) => setForm({ ...form, detailedDescription: e.target.value })} placeholder="Full office details, amenities, and reminders..." aria-describedby="office-description-hint"
                  className="mt-1 w-full min-h-[160px] resize-y rounded-lg border-slate-200 text-sm font-semibold" />
                <p id="office-description-hint" className="mt-1.5 text-xs text-slate-500">Paragraph breaks are preserved. Leave blank to use the short description.</p>
              </div>
              <CMSImageUpload label="Office Photo" value={form.image} accent="blue" storagePath="offices" onValueChange={(v) => setForm({ ...form, image: v })} />
              <CMSPanoramaUpload value={form.panoImage} storagePath="panoramas" onValueChange={(v) => setForm({ ...form, panoImage: v })} />

              {editingId && selectedOffice && (
                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-3">
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-black">Room Management</h3>
                    <p className="text-[11px] font-semibold text-slate-500">{selectedOfficeRooms.length} room{selectedOfficeRooms.length !== 1 ? "s" : ""} · {selectedOffice.name}</p>
                  </div>
                  {!showRoomForm && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <Button type="button" onClick={openNewRoom} disabled={isBusy} className="h-9 rounded-lg bg-blue-600 px-3.5 text-xs font-bold text-white hover:bg-blue-700">
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add Room
                      </Button>
                      <Button type="button" onClick={openBulkModal} disabled={isBusy} variant="outline" className="h-9 rounded-lg border-slate-200 px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        <Plus className="mr-1 h-3.5 w-3.5" /> Bulk Add Rooms
                      </Button>
                    </div>
                  )}
                  {showRoomForm && (
                    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <h3 className="text-sm font-bold text-slate-900 mb-3">{editingRoomId ? "Edit Room" : "Add Room"}</h3>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">Room Name</label>
                        <Input value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} disabled={isBusy} placeholder="Room 1" className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button type="button" onClick={handleSaveRoom} disabled={isBusy} className="h-9 rounded-lg bg-blue-600 px-3.5 text-xs font-bold text-white hover:bg-blue-700">
                          {isRoomSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} {isRoomSaving ? "Saving..." : editingRoomId ? "Save" : "Add"}
                        </Button>
                        <Button type="button" variant="outline" onClick={closeRoomForm} disabled={isBusy} className="h-9 rounded-lg border-slate-200 text-xs font-bold">
                          <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                  {selectedOfficeRooms.length === 0 ? (
                    <div className="text-center py-6">
                      <DoorOpen className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-500">No rooms yet</p>
                      <p className="text-xs text-slate-400 mt-1">Click "Add Room" to create the first room.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedOfficeRooms.map((room, idx) => (
                        <div key={room.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">{idx + 1}</div>
                            <div>
                              <p className="text-sm font-bold text-slate-900">{room.name}</p>
                              <p className="text-[11px] font-semibold text-slate-500">{selectedOffice?.capacity || "1-4 pax"} · ₱{Number(selectedOffice?.price || 0).toLocaleString("en-PH")}/mo</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5">
                            <button type="button" onClick={() => openEditRoom(room)} disabled={isBusy} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                            <button type="button" onClick={() => setConfirmDeleteRoom(room.id)} disabled={isBusy} className="flex h-7 w-7 items-center justify-center rounded-md text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
              <Button type="button" onClick={handleSave} disabled={isBusy} className="w-full sm:w-auto h-11 flex-1 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700">
                {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} {isSaving ? "Saving..." : editingId ? "Save Changes" : "Add Office"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} disabled={isBusy} className="h-9 rounded-lg border-slate-200 text-xs font-bold">
                <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-black text-slate-900">Delete Office?</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">This cannot be undone.</p>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)} disabled={isBusy} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">Cancel</Button>
              <Button type="button" onClick={() => handleDelete(confirmDelete)} disabled={isBusy} className="h-9 flex-1 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> {isSaving ? "Saving..." : "Delete"}</Button>
            </div>
          </div>
        </div>
      )}

      {showBulkModal && selectedOffice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-black text-slate-900">Bulk Add Rooms</h3>
            <p className="mt-1 text-xs font-semibold text-slate-500">Generate multiple rooms at once for {selectedOffice.name}.</p>

            {!bulkPreview ? (
              <div className="mt-4">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-black">Number of Rooms</label>
                <Input type="number" min="1" value={bulkCount} onChange={(e) => setBulkCount(e.target.value)} className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-xs font-bold text-slate-700 mb-2">The following rooms will be created:</p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1">
                  {bulkPreview.map((name) => (
                    <div key={name} className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <span className="text-emerald-500">&#10003;</span> {name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 flex gap-2">
              {!bulkPreview ? (
                <Button type="button" onClick={generateBulkPreview} className="h-9 flex-1 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700">
                  Generate
                </Button>
              ) : (
                <Button type="button" onClick={handleBulkConfirm} disabled={isBusy} className="h-9 flex-1 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700">
                  {isRoomSaving ? "Saving..." : "Confirm"}
                </Button>
              )}
              <Button type="button" variant="outline" onClick={closeBulkModal} disabled={isBusy} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteRoom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-black text-slate-900">Archive Room?</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">This room will no longer be bookable. Its identity and booking history will be retained.</p>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDeleteRoom(null)} disabled={isBusy} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">Cancel</Button>
              <Button type="button" onClick={() => handleDeleteRoom(confirmDeleteRoom)} disabled={isBusy} className="h-9 flex-1 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> {isRoomSaving ? "Saving..." : "Archive"}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
