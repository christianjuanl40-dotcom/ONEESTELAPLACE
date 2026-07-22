"use client"

import { useState } from "react"
import { ChevronDown, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { Textarea } from "@shared/components/ui/textarea"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSImageUpload, CMSPanoramaUpload } from "./cms-image-upload"
import { CMSStatusBadge, EmptyState } from "./cms-status-badge"
import { toPrice } from "@/src/modules/shared/lib/number-utils"
import { getImageSource } from "@/src/modules/shared/lib/file-utils"

type VenueForm = { name: string; capacity: string; price: number | string; downPaymentPercentage: number | string; description: string; image: string; panoImage: string }
const EMPTY_FORM: VenueForm = { name: "", capacity: "", price: "", downPaymentPercentage: 50, description: "", image: "", panoImage: "" }

export function CMSVenuesTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { venues, updateVenue, addVenue, deleteVenue } = useCMS()
  const { toast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<VenueForm>(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [filter, setFilter] = useState<"all" | "published" | "hidden">("all")

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setShowModal(false) }
  const openNew = () => { resetForm(); setShowModal(true) }
  const openEdit = (v: any) => { setEditingId(v.id); setForm({ name: v.name || "", capacity: v.capacity || "", price: v.price ?? "", downPaymentPercentage: v.downPaymentPercentage ?? 50, description: v.description || "", image: v.image || "", panoImage: v.panoImage || "" }); setShowModal(true) }

  const handleSave = () => {
    if (!form.name.trim()) { toast({ title: "Name required", description: "Enter a venue name.", variant: "destructive" }); return }
    const pano = form.panoImage || ""
    const data = { name: form.name.trim(), capacity: form.capacity?.trim() || "", price: toPrice(form.price), downPaymentPercentage: Math.min(100, Math.max(0, Number(form.downPaymentPercentage) || 50)), description: form.description || "", image: form.image || "/placeholder.jpg", panoImage: pano, panoramaUrl: pano, updatedAt: new Date().toISOString() }
    if (editingId) { updateVenue(editingId, data); toast({ title: "Venue updated", description: "Changes saved.", className: "bg-emerald-500 text-white border-none" }) }
    else { addVenue({ ...data, type: "venue" }); toast({ title: "Venue added", description: "New venue created.", className: "bg-emerald-500 text-white border-none" }) }
    resetForm()
  }

  const handleDelete = (id: string) => { deleteVenue(id); setConfirmDelete(null); toast({ title: "Venue archived", description: "Venue has been archived.", className: "bg-emerald-500 text-white border-none" }) }

  const filtered = venues.filter((v: any) => { if (v.isArchived) return false; if (filter === "published") return !v.isHidden; if (filter === "hidden") return v.isHidden; return true })

  return (
    <div>
      <CMSSectionHeader title="Event Venues" description="Manage published and hidden event venue spaces."
        currentSection="venues" onNavigate={onNavigate}
        action={<Button type="button" onClick={openNew} className="h-9 rounded-lg bg-emerald-600 px-3.5 text-xs font-bold text-white hover:bg-emerald-700"><Plus className="mr-1 h-3.5 w-3.5" /> Add Venue</Button>} />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(["all", "published", "hidden"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-bold tracking-wide transition ${filter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}>
                {f === "all" ? `All (${venues.length})` : f === "published" ? `Published (${venues.filter((v: any) => !v.isHidden).length})` : `Hidden (${venues.filter((v: any) => v.isHidden).length})`}
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
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5 hidden sm:table-cell">Capacity</th>
                  <th className="px-4 py-2.5">Price</th>
                  <th className="px-4 py-2.5 hidden md:table-cell">Status</th>
                  <th className="px-4 py-2.5 text-right w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v: any) => (
                  <tr key={v.id} className="border-b border-slate-50 text-sm transition hover:bg-slate-50/50">
                    <td className="px-4 py-2.5">
                      <div className="h-10 w-14 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                        <img src={getImageSource(v.image)} alt="" className="h-full w-full object-cover"
                          onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }} />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-bold text-slate-900">{v.name || "Untitled"}</td>
                    <td className="px-4 py-2.5 text-slate-600 hidden sm:table-cell">{v.capacity || "—"}</td>
                    <td className="px-4 py-2.5 font-semibold text-slate-800">₱{toPrice(v.price).toLocaleString("en-PH")}</td>
                    <td className="px-4 py-2.5 hidden md:table-cell"><CMSStatusBadge status={v.isHidden ? "hidden" : (!v.image || v.image === "/placeholder.jpg") ? "needs-photo" : "published"} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <button type="button" onClick={() => openEdit(v)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => setConfirmDelete(v.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={<Plus className="h-8 w-8 text-emerald-400" />}
              title="No venues yet"
              description={filter === "hidden" ? "No hidden venues." : "Add your first event venue."}
              action={<Button type="button" onClick={openNew} className="h-9 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"><Plus className="mr-1.5 h-4 w-4" /> Add Venue</Button>} />
          </div>
        )}
      </section>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl max-h-[calc(100dvh-32px)] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <h2 className="text-base font-black text-slate-950">{editingId ? "Edit Venue" : "Add Venue"}</h2>
              <button type="button" onClick={resetForm} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 p-5">
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Name</label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Grand Hall" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Capacity</label>
                  <Input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="80–100 pax" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Price (₱)</label>
                  <Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="15000" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Down Payment (%)</label>
                  <Input type="number" min="0" max="100" value={form.downPaymentPercentage} onChange={(e) => setForm({ ...form, downPaymentPercentage: e.target.value })} placeholder="50" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Status</label>
                  <div className="relative mt-1">
                    <select value={editingId ? (venues.find((v: any) => v.id === editingId)?.isHidden ? "hidden" : "published") : "published"}
                      onChange={(e) => { const v = venues.find((v: any) => v.id === editingId); if (v) updateVenue(v.id, { isHidden: e.target.value === "hidden" }) }}
                      className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 cursor-pointer">
                      <option value="published">Published</option>
                      <option value="hidden">Hidden</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Description</label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Venue description..."
                  className="mt-1 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <CMSImageUpload label="Venue Photo" value={form.image} storagePath="venues" onValueChange={(v) => setForm({ ...form, image: v })} note="Used in booking, landing page, and tour preview." />
              <CMSPanoramaUpload value={form.panoImage} storagePath="panoramas" onValueChange={(v) => setForm({ ...form, panoImage: v })} />
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
              <Button type="button" onClick={handleSave} className="w-full sm:w-auto h-11 flex-1 rounded-lg bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700">
                <Save className="mr-1.5 h-3.5 w-3.5" /> {editingId ? "Save Changes" : "Add Venue"}
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
            <h3 className="text-base font-black text-slate-900">Delete Venue?</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">This cannot be undone.</p>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">Cancel</Button>
              <Button type="button" onClick={() => handleDelete(confirmDelete)} className="h-9 flex-1 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
