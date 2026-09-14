"use client"

import { useState } from "react"
import { Eye, EyeOff, Pencil, Save, X } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSPanoramaUpload } from "./cms-image-upload"
import { CMSStatusBadge, EmptyState } from "./cms-status-badge"

export function CMSVirtualTourTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { venues, offices, updateVenue, updateOffice } = useCMS()
  const { toast } = useToast()
  const [editing, setEditing] = useState<{ id: string; type: "venue" | "office"; panoImage: string } | null>(null)

  const allSpaces = [
    ...venues.map((v: any) => ({ ...v, _type: "venue" as const, _label: "Event Venue" })),
    ...offices.map((o: any) => ({ ...o, _type: "office" as const, _label: "Office Space" })),
  ]

  const handleSave = () => {
    if (!editing) return
    const pano = editing.panoImage
    if (editing.type === "venue") updateVenue(editing.id, { panoImage: pano, panoramaUrl: pano, updatedAt: new Date().toISOString() })
    else updateOffice(editing.id, { panoImage: pano, panoramaUrl: pano, updatedAt: new Date().toISOString() })
    toast({ title: "Panorama saved", description: "360 tour image updated.", className: "bg-emerald-500 text-white border-none" })
    setEditing(null)
  }

  return (
    <div>
      <CMSSectionHeader title="Virtual Tour" description="Manage 360 panorama images for venues and office spaces."
        currentSection="virtualTour" onNavigate={onNavigate} />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <p className="text-[11px] font-semibold text-slate-500">
            360 Panorama images appear in the virtual tour viewer on the landing page.
          </p>
        </div>

        {allSpaces.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  <th className="px-4 py-2.5">Space Name</th>
                  <th className="px-4 py-2.5 hidden sm:table-cell">Type</th>
                  <th className="px-4 py-2.5">360 Image</th>
                  <th className="px-4 py-2.5 hidden md:table-cell">Status</th>
                  <th className="px-4 py-2.5 text-right w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {allSpaces.map((s: any) => (
                  <tr key={s.id} className="border-b border-slate-50 text-sm transition hover:bg-slate-50/50">
                    <td className="px-4 py-2.5 font-bold text-slate-900">{s.name || "Untitled"}</td>
                    <td className="px-4 py-2.5 text-slate-600 hidden sm:table-cell">{s._label}</td>
                    <td className="px-4 py-2.5">
                      {s.panoImage ? (
                        <div className="h-9 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                          <img src={s.panoImage} alt="" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }} />
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold text-rose-500">No image</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell"><CMSStatusBadge status={s.panoImage ? "published" : "needs-photo"} /></td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <button type="button" onClick={() => setEditing({ id: s.id, type: s._type, panoImage: s.panoImage || "" })}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                        <button type="button" onClick={() => { if (s._type === "venue") updateVenue(s.id, { isHidden: !s.isHidden, updatedAt: new Date().toISOString() }); else updateOffice(s.id, { isHidden: !s.isHidden, updatedAt: new Date().toISOString() }) }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">{s.isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={<Pencil className="h-8 w-8 text-purple-400" />} title="No spaces available"
              description="Add venues or offices first to set up 360 virtual tours." />
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl max-h-[calc(100dvh-32px)] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <div>
                <h2 className="text-base font-black text-slate-950">Edit Panorama</h2>
                <p className="text-xs font-semibold text-slate-500">{allSpaces.find((s: any) => s.id === editing.id)?.name}</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5">
              <CMSPanoramaUpload value={editing.panoImage} onValueChange={(v) => setEditing({ ...editing, panoImage: v })} />
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
              <Button type="button" onClick={handleSave} className="w-full sm:w-auto h-11 flex-1 rounded-lg bg-purple-600 text-xs font-bold text-white hover:bg-purple-700">
                <Save className="mr-1.5 h-3.5 w-3.5" /> Save
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)} className="h-9 rounded-lg border-slate-200 text-xs font-bold">
                <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
