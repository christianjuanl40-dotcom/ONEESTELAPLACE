"use client"

import { type ChangeEvent, useState } from "react"
import { Calendar, Eye, EyeOff, ImageIcon, Loader2, Pencil, Plus, Save, Star, Trash2, Upload, X, Users } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { Textarea } from "@shared/components/ui/textarea"
import { Switch } from "@shared/components/ui/switch"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSStatusBadge, EmptyState } from "./cms-status-badge"
import type { PastClientBooking } from "@admin/contexts/cms-context"
import { validateImageFile, uploadCMSImage, removeImage } from "@shared/lib/image-upload"

type Form = {
  photos: string[]
  coverPhoto: string
  name: string
  eventName: string
  eventType: string
  date: string
  testimonial: string
  companyName: string
  display: boolean
}

const EMPTY_FORM: Form = {
  photos: [],
  coverPhoto: "",
  name: "",
  eventName: "",
  eventType: "Event",
  date: "",
  testimonial: "",
  companyName: "",
  display: true,
}

export function CMSPastClientsTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { cmsData, addPastClientBooking, updatePastClientBooking, deletePastClientBooking } = useCMS()
  const { toast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const activePastBookings = (cmsData.pastClientBookings || []).filter((b) => !b.isArchived)
  const sortedBookings = [...activePastBookings].sort(
    (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()
  )

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowModal(false)
  }

  const openNew = () => {
    resetForm()
    setShowModal(true)
  }

  const openEdit = (b: PastClientBooking) => {
    setEditingId(b.id)
    setForm({
      photos: b.photos || [],
      coverPhoto: b.coverPhoto || (b.photos?.[0] || ""),
      name: b.name || "",
      eventName: b.eventName || "",
      eventType: b.eventType || "Event",
      date: b.date || "",
      testimonial: b.testimonial || "",
      companyName: b.companyName || "",
      display: b.display ?? true,
    })
    setShowModal(true)
  }

  const [uploadingPhotos, setUploadingPhotos] = useState(false)

  const handlePhotoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ""

    setUploadingPhotos(true)
    try {
      validateImageFile(file)
      const downloadUrl = await uploadCMSImage(file, "past-clients")
      const newPhotos = [...form.photos, downloadUrl]
      setForm({
        ...form,
        photos: newPhotos,
        coverPhoto: form.coverPhoto || downloadUrl,
      })
    } catch (error: any) {
      const msg = error?.message || ""
      if (msg.includes("Only") || msg.includes("size exceeds")) {
        toast({ title: "Invalid File", description: msg, variant: "destructive" })
      } else {
        toast({ title: "Upload Failed", description: "Could not upload image. Please try again.", variant: "destructive" })
      }
    } finally {
      setUploadingPhotos(false)
    }
  }

  const removePhoto = async (index: number) => {
    const removed = form.photos[index]
    const newPhotos = form.photos.filter((_, i) => i !== index)
    setForm({
      ...form,
      photos: newPhotos,
      coverPhoto: form.coverPhoto === removed ? (newPhotos[0] || "") : form.coverPhoto,
    })
    await removeImage(removed)
  }

  const setAsCover = (url: string) => {
    setForm({ ...form, coverPhoto: url })
  }

  const handleSave = () => {
    if (!form.name.trim()) {
      toast({ title: "Name required", description: "Enter the client name.", variant: "destructive" })
      return
    }
    if (!form.eventName.trim()) {
      toast({ title: "Event name required", description: "Enter the event name.", variant: "destructive" })
      return
    }
    if (!form.date) {
      toast({ title: "Date required", description: "Select the event date.", variant: "destructive" })
      return
    }
    if (form.photos.length === 0) {
      toast({ title: "Photos required", description: "Upload at least one photo.", variant: "destructive" })
      return
    }
    const payload = {
      photos: form.photos,
      coverPhoto: form.coverPhoto || form.photos[0],
      name: form.name.trim(),
      eventName: form.eventName.trim(),
      eventType: form.eventType || "Event",
      date: form.date,
      testimonial: form.testimonial.trim(),
      companyName: form.companyName.trim(),
      display: form.display,
    }
    if (editingId) {
      updatePastClientBooking(editingId, payload)
      toast({ title: "Client booking updated", description: "Changes saved.", className: "bg-emerald-500 text-white border-none" })
    } else {
      addPastClientBooking(payload)
      toast({ title: "Client booking added", description: "New client booking saved.", className: "bg-emerald-500 text-white border-none" })
    }
    resetForm()
  }

  const handleDelete = (id: string) => {
    deletePastClientBooking(id)
    setConfirmDelete(null)
    toast({ title: "Client booking archived", description: "Entry has been archived.", className: "bg-emerald-500 text-white border-none" })
  }

  const getCoverImage = (booking: PastClientBooking) => {
    if (booking.coverPhoto) return booking.coverPhoto
    if (booking.photos?.length > 0) return booking.photos[0]
    return "/placeholder.jpg"
  }

  return (
    <div>
      <CMSSectionHeader
        title="Past Client Bookings"
        description="Manage past client booking testimonials shown on the landing page."
        currentSection="pastClients"
        onNavigate={onNavigate}
        action={
          <Button type="button" onClick={openNew} className="h-9 rounded-lg bg-pink-600 px-3.5 text-xs font-bold text-white hover:bg-pink-700">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add Client Booking
          </Button>
        }
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <p className="text-[11px] font-semibold text-slate-500">
            {activePastBookings.length} client booking{activePastBookings.length !== 1 ? "s" : ""}
          </p>
        </div>

        {sortedBookings.length > 0 ? (
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {sortedBookings.map((booking) => (
              <div key={booking.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="relative h-40 overflow-hidden bg-slate-100">
                  <img
                    src={getCoverImage(booking)}
                    alt={booking.name}
className="h-full w-full object-cover"
                    onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }}
                  />
                  <div className="absolute right-2 top-2 flex items-center gap-1">
                    {booking.photos && booking.photos.length > 1 && (
                      <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white">
                        {booking.photos.length} photos
                      </span>
                    )}
                    <CMSStatusBadge status={booking.display ? "live" : "hidden"} />
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-950">{booking.name}</h3>
                    {booking.companyName && <span className="text-[10px] font-bold text-slate-400">{booking.companyName}</span>}
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-pink-600">{booking.eventName} · {booking.eventType}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                    <Calendar className="h-3 w-3" />{booking.date || "No date"}
                  </p>
                  {booking.testimonial && (
                    <p className="mt-1.5 text-xs italic text-slate-600 line-clamp-2">&ldquo;{booking.testimonial}&rdquo;</p>
                  )}
                  <div className="mt-3 flex gap-1.5">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEdit(booking)} className="h-8 flex-1 rounded-md border-slate-200 text-[10px] font-bold">
                      <Pencil className="mr-1 h-3 w-3" /> Edit
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDelete(booking.id)} className="h-8 flex-1 rounded-md border-rose-200 text-[10px] font-bold text-rose-600 hover:bg-rose-50">
                      <Trash2 className="mr-1 h-3 w-3" /> Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={<Users className="h-8 w-8 text-pink-400" />}
              title="No past client bookings yet"
              description="Add client booking testimonials to display on the landing page."
              action={
                <Button type="button" onClick={openNew} className="h-9 rounded-lg bg-pink-600 text-xs font-bold text-white hover:bg-pink-700">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Client Booking
                </Button>
              }
            />
          </div>
        )}
      </section>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl max-h-[calc(100dvh-32px)] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <h2 className="text-base font-black text-slate-950">
                {editingId ? "Edit Client Booking" : "Add Past Client Booking"}
              </h2>
              <button type="button" onClick={resetForm} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-5">
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Client Name</label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Juan Dela Cruz" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Company Name</label>
                  <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} placeholder="ABC Corp" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Event Name</label>
                  <Input value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })} placeholder="Santos Birthday" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Event Type</label>
                  <Input value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value })} placeholder="Birthday, Wedding, etc." className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Event Date</label>
                  <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div className="flex items-end pb-2">
                  <div className="flex items-center gap-2">
                    <Switch checked={form.display} onCheckedChange={(v) => setForm({ ...form, display: v })} />
                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Display on site</label>
                  </div>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Testimonial</label>
                <Textarea value={form.testimonial} onChange={(e) => setForm({ ...form, testimonial: e.target.value })} placeholder="Client testimonial..."
                  className="mt-1 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Photos</label>
                  <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
                </div>

                {form.photos.length > 0 && (
                  <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {form.photos.map((photo, i) => (
                      <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white">
                        <img src={photo} alt={`Photo ${i + 1}`} className="h-full w-full object-cover"
                          onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }} />
                        <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 transition group-hover:opacity-100">
                          <button type="button" onClick={() => setAsCover(photo)}
                            className={`flex h-6 w-6 items-center justify-center rounded-full text-white transition ${form.coverPhoto === photo ? "text-yellow-400" : "text-white/70 hover:text-yellow-400"}`}
                            title="Set as cover">
                            <Star className="h-3.5 w-3.5" fill={form.coverPhoto === photo ? "currentColor" : "none"} />
                          </button>
                          <button type="button" onClick={() => removePhoto(i)}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-white/70 transition hover:text-red-400"
                            title="Remove photo">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {form.coverPhoto === photo && (
                          <div className="absolute left-1 top-1 rounded-md bg-yellow-400 px-1 py-0.5 text-[8px] font-bold text-yellow-900">
                            Cover
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white py-4 transition hover:border-pink-300 hover:bg-pink-50/30 ${uploadingPhotos ? "opacity-50 pointer-events-none" : ""}`}>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} hidden disabled={uploadingPhotos} />
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-50 text-pink-600">
                    {uploadingPhotos ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-700">{uploadingPhotos ? "Uploading..." : "Add Photo"}</p>
                    <p className="text-[10px] font-semibold text-slate-500">{uploadingPhotos ? "Please wait..." : "Max 2.5MB each"}</p>
                  </div>
                </label>
              </div>
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
              <Button type="button" onClick={handleSave} className="w-full sm:w-auto h-11 flex-1 rounded-lg bg-pink-600 text-xs font-bold text-white hover:bg-pink-700">
                <Save className="mr-1.5 h-3.5 w-3.5" /> {editingId ? "Save Changes" : "Add Client Booking"}
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
            <h3 className="text-base font-black text-slate-900">Delete Client Booking?</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">This cannot be undone.</p>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">Cancel</Button>
              <Button type="button" onClick={() => handleDelete(confirmDelete)} className="h-9 flex-1 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700">
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
