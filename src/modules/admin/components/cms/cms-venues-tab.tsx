"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { Textarea } from "@shared/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader } from "@shared/components/ui/table"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@shared/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@shared/components/ui/alert-dialog"
import { IconButton } from "@shared/components/ui/icon-button"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSImageUpload, CMSPanoramaUpload } from "./cms-image-upload"
import { CMSStatusBadge, EmptyState } from "./cms-status-badge"
import { toPrice } from "@/src/modules/shared/lib/number-utils"
import { getImageSource } from "@/src/modules/shared/lib/file-utils"
import { getCatalogStatus, type CatalogStatus } from "@/src/modules/shared/lib/catalog-status"

type VenueForm = { name: string; capacity: string; price: number | string; downPaymentPercentage: number | string; description: string; detailedDescription: string; image: string; panoImage: string; catalogStatus: CatalogStatus }
type CatalogStatusFilter = CatalogStatus | "all"
const EMPTY_FORM: VenueForm = { name: "", capacity: "", price: "", downPaymentPercentage: 50, description: "", detailedDescription: "", image: "", panoImage: "", catalogStatus: "published" }

export function CMSVenuesTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { venues, updateVenue, addVenue, deleteVenue } = useCMS()
  const { toast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<VenueForm>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [filter, setFilter] = useState<CatalogStatusFilter>("all")
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const resetForm = () => { setForm(EMPTY_FORM); setEditingId(null); setShowModal(false) }
  const rememberFocus = (target?: HTMLElement) => {
    restoreFocusRef.current = target || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  }
  useEffect(() => {
    if (showModal || !restoreFocusRef.current) return
    const target = restoreFocusRef.current
    const frame = window.requestAnimationFrame(() => {
      if (target.isConnected) target.focus()
      if (restoreFocusRef.current === target) restoreFocusRef.current = null
    })
    return () => window.cancelAnimationFrame(frame)
  }, [showModal])
  const openNew = (target?: HTMLElement) => { rememberFocus(target); resetForm(); setShowModal(true) }
  const openEdit = (v: any, target?: HTMLElement) => { rememberFocus(target); setEditingId(v.id); setForm({ name: v.name || "", capacity: v.capacity || "", price: v.price ?? "", downPaymentPercentage: v.downPaymentPercentage ?? 50, description: v.description || "", detailedDescription: v.detailedDescription || "", image: v.image || "", panoImage: v.panoImage || v.panoramaUrl || v.panorama || v.pano || v.tourImage || "", catalogStatus: getCatalogStatus(v) }); setShowModal(true) }

  const handleSave = async () => {
    if (isSaving) return
    if (!form.name.trim()) { toast({ title: "Name required", description: "Enter a venue name.", variant: "destructive" }); return }
    const pano = form.panoImage || ""
    const currentVenue = venues.find((v) => v.id === editingId)
    const currentPano = currentVenue?.panoImage || currentVenue?.panoramaUrl || currentVenue?.panorama || currentVenue?.pano || currentVenue?.tourImage || ""
    const panoramaFields = !editingId || pano !== currentPano ? { panoImage: pano, panoramaUrl: pano } : {}
    const data = { name: form.name.trim(), capacity: form.capacity?.trim() || "", price: toPrice(form.price), downPaymentPercentage: Math.min(100, Math.max(0, Number(form.downPaymentPercentage) || 50)), description: form.description || "", detailedDescription: form.detailedDescription || "", image: form.image || "/placeholder.jpg", ...panoramaFields, catalogStatus: editingId ? form.catalogStatus : "published" as const, updatedAt: new Date().toISOString() }
    setIsSaving(true)
    try {
      const saved = editingId ? await updateVenue(editingId, data) : await addVenue({ ...data, type: "venue" })
      if (saved) resetForm()
    } catch {
      toast({ title: "Save failed", description: "Could not save the venue. Please try again.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = (id: string) => { deleteVenue(id); setConfirmDelete(null); toast({ title: "Venue archived", description: "Venue has been archived.", className: "bg-emerald-500 text-white border-none" }) }

  const filtered = venues.filter((v: any) => !v.isArchived && (filter === "all" || getCatalogStatus(v) === filter))

  return (
    <div>
      <CMSSectionHeader title="Event Venues"
        currentSection="venues" onNavigate={onNavigate}
        action={<Button type="button" variant="brand" onClick={(event) => openNew(event.currentTarget)} className="h-9 shrink-0 whitespace-nowrap rounded-lg px-3.5 text-sm"><Plus className="mr-1 h-3.5 w-3.5" /> Add Venue</Button>} />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-100 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="venue-status-filter" className="text-xs font-bold text-slate-600">Status</label>
            <div className="relative">
              <select id="venue-status-filter" value={filter} onChange={(event) => setFilter(event.target.value as CatalogStatusFilter)}
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
          <Table className="min-w-[650px]">
              <caption className="sr-only">Event venue catalog records</caption>
              <TableHeader className="bg-slate-50/80">
                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-black">
                  <TableHead scope="col" className="w-14" aria-label="Preview" />
                  <TableHead scope="col" className="oe-table-head">Name</TableHead>
                  <TableHead scope="col" className="oe-table-head hidden sm:table-cell">Capacity</TableHead>
                  <TableHead scope="col" className="oe-table-head">Price</TableHead>
                  <TableHead scope="col" className="oe-table-head hidden md:table-cell">Status</TableHead>
                  <TableHead scope="col" className="oe-table-head w-28 text-right">Actions</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {filtered.map((v: any) => (
                  <tr key={v.id} className="border-b border-slate-50 text-sm transition hover:bg-slate-50/50">
                    <TableCell className="align-middle">
                      <div className="h-10 w-14 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                        <img src={getImageSource(v.image)} alt="" className="h-full w-full object-cover"
                          onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }} />
                      </div>
                    </TableCell>
                    <TableCell className="font-bold text-slate-900">{v.name || "Untitled"}</TableCell>
                    <TableCell className="hidden text-slate-600 sm:table-cell">{v.capacity || "—"}</TableCell>
                    <TableCell className="font-semibold tabular-nums text-slate-800">₱{toPrice(v.price).toLocaleString("en-PH")}</TableCell>
                    <TableCell className="hidden md:table-cell"><CMSStatusBadge status={getCatalogStatus(v)} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <IconButton label={`Edit ${v.name || "venue"}`} onClick={(event) => openEdit(v, event.currentTarget)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></IconButton>
                        <IconButton label={`Archive ${v.name || "venue"}`} tone="danger" onClick={() => setConfirmDelete(v.id)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></IconButton>
                      </div>
                    </TableCell>
                  </tr>
                ))}
              </TableBody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={filter === "under_renovation" ? undefined : <Plus className="h-8 w-8 text-emerald-400" />}
              title={filter === "under_renovation" ? "No venues under renovation." : filter === "published" ? "No published venues." : "No venues yet"}
              description={filter === "all" ? "Add a venue to get started." : undefined}
              action={filter === "under_renovation" ? undefined : <Button type="button" variant="brand" onClick={(event) => openNew(event.currentTarget)} className="h-9 rounded-lg text-xs"><Plus className="mr-1.5 h-4 w-4" /> Add Venue</Button>} />
          </div>
        )}
      </section>

      <Dialog open={showModal} onOpenChange={(open) => { if (!open && !isSaving) resetForm() }}>
        <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocusRef.current?.focus(); restoreFocusRef.current = null }} className="w-[calc(100vw-2rem)] max-w-lg p-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <div>
                <DialogTitle className="text-base font-black text-slate-950">{editingId ? "Edit Venue" : "Add Venue"}</DialogTitle>
                <DialogDescription className="sr-only">Create or update the event venue catalog record.</DialogDescription>
              </div>
              <DialogClose asChild><IconButton label="Close venue editor" onClick={resetForm} disabled={isSaving}><X className="h-4 w-4" /></IconButton></DialogClose>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="grid gap-4 p-5">
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label htmlFor="venue-name" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Name</label>
                  <Input id="venue-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Grand Hall" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label htmlFor="venue-capacity" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Capacity</label>
                  <Input id="venue-capacity" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="80–100 pax" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label htmlFor="venue-price" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Price (₱)</label>
                  <Input id="venue-price" type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="15000" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label htmlFor="venue-down-payment" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Down Payment (%)</label>
                  <Input id="venue-down-payment" type="number" min="0" max="100" value={form.downPaymentPercentage} onChange={(e) => setForm({ ...form, downPaymentPercentage: e.target.value })} placeholder="50" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                {editingId && <div>
                  <label htmlFor="venue-status" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Status</label>
                  <div className="relative mt-1">
                    <select id="venue-status" value={form.catalogStatus}
                      onChange={(e) => setForm({ ...form, catalogStatus: e.target.value as CatalogStatus })}
                      className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 pr-10 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100 cursor-pointer">
                      <option value="published">Published</option>
                      <option value="under_renovation">Under Renovation</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  </div>
                </div>}
              </div>
              <div>
                <label htmlFor="venue-short-description" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Short Description</label>
                <Textarea id="venue-short-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Venue description..."
                  className="mt-1 w-full min-h-[128px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <div>
                <label htmlFor="venue-detailed-description" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Expanded Description / Full Venue Details</label>
                <Textarea id="venue-detailed-description" value={form.detailedDescription} onChange={(e) => setForm({ ...form, detailedDescription: e.target.value })} placeholder="Full venue details, amenities, and reminders..." aria-describedby="venue-description-hint"
                  className="mt-1 w-full min-h-[160px] resize-y rounded-lg border-slate-200 text-sm font-semibold" />
                <p id="venue-description-hint" className="mt-1.5 text-xs text-slate-500">Paragraph breaks are preserved. Leave blank to use the short description.</p>
              </div>
              <CMSImageUpload label="Venue Photo" value={form.image} storagePath="venues" onValueChange={(v) => setForm({ ...form, image: v })} note="Used in booking, landing page, and tour preview." />
              <CMSPanoramaUpload value={form.panoImage} storagePath="panoramas" onValueChange={(v) => setForm({ ...form, panoImage: v })} />
              </div>
            </div>
            <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
              <Button type="button" variant="brand" onClick={handleSave} disabled={isSaving} className="h-11 w-full flex-1 rounded-lg text-xs">
                {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />} {isSaving ? "Saving..." : editingId ? "Save Changes" : "Add Venue"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} disabled={isSaving} className="h-9 rounded-lg border-slate-200 text-xs font-bold">
                <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmDelete)} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Venue?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmDelete) handleDelete(confirmDelete) }} className="bg-rose-600 text-white hover:bg-rose-700">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
