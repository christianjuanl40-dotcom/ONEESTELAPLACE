"use client"

import { useState } from "react"
import { ChevronDown, DoorOpen, Pencil, Plus, Save, Trash2, X } from "lucide-react"
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

type OfficeForm = { name: string; capacity: string; price: number | string; downPaymentPercentage: number | string; description: string; image: string; panoImage: string; floor: string }
const EMPTY_FORM: OfficeForm = { name: "", capacity: "", price: "", downPaymentPercentage: 50, description: "", image: "", panoImage: "", floor: "ground" }

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
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [floorFilter, setFloorFilter] = useState<"all" | "ground" | "second">("all")

  const [showRoomsModal, setShowRoomsModal] = useState(false)
  const [selectedOffice, setSelectedOffice] = useState<any>(null)
  const [showRoomForm, setShowRoomForm] = useState(false)
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [roomForm, setRoomForm] = useState<RoomForm>(EMPTY_ROOM_FORM)
  const [confirmDeleteRoom, setConfirmDeleteRoom] = useState<string | null>(null)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkCount, setBulkCount] = useState<string>("1")
  const [bulkPreview, setBulkPreview] = useState<string[] | null>(null)

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setShowModal(false) }
  const openNew = () => { resetForm(); setShowModal(true) }
  const openEdit = (o: any) => { setEditingId(o.id); setForm({ name: o.name || "", capacity: o.capacity || "", price: o.price ?? "", downPaymentPercentage: o.downPaymentPercentage ?? 50, description: o.description || "", image: o.image || "", panoImage: o.panoImage || "", floor: o.floor || "ground" }); setShowModal(true) }

  const handleSave = () => {
    if (!form.name.trim()) { toast({ title: "Name required", description: "Enter an office name.", variant: "destructive" }); return }
    const pano = form.panoImage || ""
    const data = { name: form.name.trim(), capacity: form.capacity?.trim() || "", price: toPrice(form.price), downPaymentPercentage: Math.min(100, Math.max(0, Number(form.downPaymentPercentage) || 50)), description: form.description || "", image: form.image || "/placeholder.jpg", panoImage: pano, panoramaUrl: pano, floor: form.floor, updatedAt: new Date().toISOString() }
    if (editingId) { updateOffice(editingId, data); toast({ title: "Office updated", description: "Changes saved.", className: "bg-emerald-500 text-white border-none" }) }
    else { addOffice({ ...data, type: "office", rooms: [] }); toast({ title: "Office added", description: "New office created.", className: "bg-emerald-500 text-white border-none" }) }
    resetForm()
  }

  const handleDelete = (id: string) => { deleteOffice(id); setConfirmDelete(null); toast({ title: "Office archived", description: "Office has been archived.", className: "bg-emerald-500 text-white border-none" }) }

  const openRoomsModal = (office: any) => { setSelectedOffice(office); setShowRoomsModal(true); setShowRoomForm(false); setEditingRoomId(null); setRoomForm(EMPTY_ROOM_FORM) }
  const closeRoomsModal = () => { setShowRoomsModal(false); setSelectedOffice(null); setShowRoomForm(false); setEditingRoomId(null); setRoomForm(EMPTY_ROOM_FORM) }

  const openNewRoom = () => {
    const rooms = selectedOffice ? getOfficeRooms(selectedOffice.id) : []
    const nextNum = getNextRoomNumber(rooms)
    setRoomForm({ name: `Room ${nextNum}` })
    setEditingRoomId(null)
    setShowRoomForm(true)
  }
  const openEditRoom = (room: OfficeRoom) => { setRoomForm({ name: room.name || "" }); setEditingRoomId(room.id); setShowRoomForm(true) }
  const closeRoomForm = () => { setRoomForm(EMPTY_ROOM_FORM); setEditingRoomId(null); setShowRoomForm(false) }

  const handleSaveRoom = () => {
    if (!selectedOffice) return
    if (!roomForm.name.trim()) { toast({ title: "Name required", description: "Enter a room name.", variant: "destructive" }); return }
    const roomData = { name: roomForm.name.trim() }
    if (editingRoomId) { updateRoomInOffice(selectedOffice.id, editingRoomId, roomData); toast({ title: "Room updated", description: "Changes saved.", className: "bg-emerald-500 text-white border-none" }) }
    else { addRoomToOffice(selectedOffice.id, roomData); toast({ title: "Room added", description: "New room created.", className: "bg-emerald-500 text-white border-none" }) }
    closeRoomForm()
  }

  const handleDeleteRoom = (roomId: string) => {
    if (!selectedOffice) return
    deleteRoomFromOffice(selectedOffice.id, roomId)
    setConfirmDeleteRoom(null)
    toast({ title: "Room deleted", description: "Room has been removed.", className: "bg-emerald-500 text-white border-none" })
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

  const handleBulkConfirm = () => {
    if (!selectedOffice || !bulkPreview) return
    addRoomsToOffice(selectedOffice.id, bulkPreview.map((name) => ({ name })))
    toast({ title: "Rooms created", description: `${bulkPreview.length} room(s) added.`, className: "bg-emerald-500 text-white border-none" })
    closeBulkModal()
  }

  const activeOffices = offices.filter((o: any) => !o.isArchived)
  const filtered = activeOffices.filter((o: any) => {
    if (floorFilter === "ground") return (o.floor || "ground") === "ground" || o.floor === "Ground"
    if (floorFilter === "second") return o.floor === "second" || o.floor === "Second"
    return true
  })

  const selectedOfficeRooms = selectedOffice ? getOfficeRooms(selectedOffice.id) : []

  return (
    <div>
      <CMSSectionHeader title="Office Spaces" description="Manage published and hidden office rental spaces."
        currentSection="offices" onNavigate={onNavigate}
        action={<Button type="button" onClick={openNew} className="h-9 rounded-lg bg-blue-600 px-3.5 text-xs font-bold text-white hover:bg-blue-700"><Plus className="mr-1 h-3.5 w-3.5" /> Add Office</Button>} />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(["all", "ground", "second"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFloorFilter(f)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-bold tracking-wide transition ${floorFilter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                {f === "all" ? `All (${activeOffices.length})` : f === "ground" ? `Ground (${activeOffices.filter((o: any) => (o.floor || "ground") === "ground" || o.floor === "Ground").length})` : `Second (${activeOffices.filter((o: any) => o.floor === "second" || o.floor === "Second").length})`}
              </button>
            ))}
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  <th className="px-4 py-2.5 w-14"></th>
                  <th className="px-4 py-2.5">Office</th>
                  <th className="px-4 py-2.5 hidden sm:table-cell">Floor</th>
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
                      <td className="px-4 py-2.5 text-slate-600 hidden sm:table-cell">{o.floor === "ground" || o.floor === "Ground" ? "Ground" : "Second"}</td>
                      <td className="px-4 py-2.5 text-slate-600 hidden md:table-cell">{o.capacity || "—"}</td>
                      <td className="px-4 py-2.5 font-semibold text-slate-800">₱{toPrice(o.price).toLocaleString("en-PH")}</td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                          <DoorOpen className="h-3 w-3" /> {roomCount}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell"><CMSStatusBadge status={o.isHidden ? "hidden" : (!o.image || o.image === "/placeholder.jpg") ? "needs-photo" : "published"} /></td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <button type="button" onClick={() => openEdit(o)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Edit Office"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" onClick={() => openRoomsModal(o)} className="flex h-7 w-7 items-center justify-center rounded-md text-blue-400 hover:bg-blue-50 hover:text-blue-600" title="Manage Rooms"><DoorOpen className="h-3.5 w-3.5" /></button>
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
            <EmptyState icon={<Plus className="h-8 w-8 text-blue-400" />} title="No office spaces"
              description={floorFilter !== "all" ? "No offices on this floor." : "Add your first office space."}
              action={<Button type="button" onClick={openNew} className="h-9 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700"><Plus className="mr-1.5 h-4 w-4" /> Add Office</Button>} />
          </div>
        )}
      </section>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl max-h-[calc(100dvh-32px)] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <h2 className="text-base font-black text-slate-950">{editingId ? "Edit Office" : "Add Office"}</h2>
              <button type="button" onClick={resetForm} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 p-5">
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Office Name</label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Office A" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Capacity</label>
                  <Input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="1-4 pax" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Monthly Price (₱)</label>
                  <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="15000" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Down Payment (%)</label>
                  <Input type="number" min="0" max="100" value={form.downPaymentPercentage} onChange={(e) => setForm({ ...form, downPaymentPercentage: e.target.value })} placeholder="50" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Floor</label>
                  <div className="relative mt-1">
                    <select value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })}
                      className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 cursor-pointer">
                      <option value="ground">Ground Floor</option>
                      <option value="second">Second Floor</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Description</label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Office description..."
                  className="mt-1 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <CMSImageUpload label="Office Photo" value={form.image} accent="blue" storagePath="offices" onValueChange={(v) => setForm({ ...form, image: v })} />
              <CMSPanoramaUpload value={form.panoImage} storagePath="panoramas" onValueChange={(v) => setForm({ ...form, panoImage: v })} />
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
              <Button type="button" onClick={handleSave} className="w-full sm:w-auto h-11 flex-1 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700">
                <Save className="mr-1.5 h-3.5 w-3.5" /> {editingId ? "Save Changes" : "Add Office"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} className="h-9 rounded-lg border-slate-200 text-xs font-bold">
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
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">Cancel</Button>
              <Button type="button" onClick={() => handleDelete(confirmDelete)} className="h-9 flex-1 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete</Button>
            </div>
          </div>
        </div>
      )}

      {showRoomsModal && selectedOffice && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl max-h-[calc(100dvh-32px)] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <div>
                <h2 className="text-base font-black text-slate-950">Manage Rooms</h2>
                <p className="text-xs font-semibold text-slate-500">{selectedOffice.name} — {selectedOfficeRooms.length} room{selectedOfficeRooms.length !== 1 ? "s" : ""}</p>
              </div>
              <button type="button" onClick={closeRoomsModal} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5">
              {!showRoomForm && (
                <div className="mb-4 flex items-center gap-2">
                  <Button type="button" onClick={openNewRoom} className="h-9 rounded-lg bg-blue-600 px-3.5 text-xs font-bold text-white hover:bg-blue-700">
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add Room
                  </Button>
                  <Button type="button" onClick={openBulkModal} variant="outline" className="h-9 rounded-lg border-slate-200 px-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <Plus className="mr-1 h-3.5 w-3.5" /> Bulk Add Rooms
                  </Button>
                </div>
              )}

              {showRoomForm && (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-bold text-slate-900 mb-3">{editingRoomId ? "Edit Room" : "Add Room"}</h3>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Room Name</label>
                    <Input value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} placeholder="Room 1" className="mt-1 h-9 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Button type="button" onClick={handleSaveRoom} className="h-9 rounded-lg bg-blue-600 px-3.5 text-xs font-bold text-white hover:bg-blue-700">
                      <Save className="mr-1.5 h-3.5 w-3.5" /> {editingRoomId ? "Save" : "Add"}
                    </Button>
                    <Button type="button" variant="outline" onClick={closeRoomForm} className="h-9 rounded-lg border-slate-200 text-xs font-bold">
                      <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                    </Button>
                  </div>
                </div>
              )}

              {selectedOfficeRooms.length === 0 ? (
                <div className="text-center py-8">
                  <DoorOpen className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-500">No rooms yet</p>
                  <p className="text-xs text-slate-400 mt-1">Click "Add Room" to create the first room.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedOfficeRooms.map((room, idx) => (
                    <div key={room.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-xs font-bold text-slate-600">
                          {idx + 1}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{room.name}</p>
                          <p className="text-[11px] font-semibold text-slate-500">{selectedOffice?.capacity || "1-4 pax"} · ₱{Number(selectedOffice?.price || 0).toLocaleString("en-PH")}/mo</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button type="button" onClick={() => openEditRoom(room)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setConfirmDeleteRoom(room.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600">Number of Rooms</label>
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
                <Button type="button" onClick={handleBulkConfirm} className="h-9 flex-1 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700">
                  Confirm
                </Button>
              )}
              <Button type="button" variant="outline" onClick={closeBulkModal} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteRoom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-black text-slate-900">Delete Room?</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">This room will be removed from the office.</p>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDeleteRoom(null)} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">Cancel</Button>
              <Button type="button" onClick={() => handleDeleteRoom(confirmDeleteRoom)} className="h-9 flex-1 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
