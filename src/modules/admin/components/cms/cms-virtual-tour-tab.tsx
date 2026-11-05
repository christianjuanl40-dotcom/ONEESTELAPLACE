"use client"

import { useEffect, useRef, useState } from "react"
import { Eye, EyeOff, Pencil, Save, X } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader } from "@shared/components/ui/table"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@shared/components/ui/dialog"
import { IconButton } from "@shared/components/ui/icon-button"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSPanoramaUpload } from "./cms-image-upload"
import { CMSStatusBadge, EmptyState } from "./cms-status-badge"
import { getCatalogStatus, type CatalogStatus } from "@/src/modules/shared/lib/catalog-status"

export function CMSVirtualTourTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { venues, offices, updateVenue, updateOffice } = useCMS()
  const { toast } = useToast()
  const [editing, setEditing] = useState<{ id: string; type: "venue" | "office"; panoImage: string } | null>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (editing || !restoreFocusRef.current) return
    const target = restoreFocusRef.current
    const frame = window.requestAnimationFrame(() => {
      if (target.isConnected) target.focus()
      if (restoreFocusRef.current === target) restoreFocusRef.current = null
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editing])

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

  const openEditor = (space: any, target?: HTMLElement) => {
    restoreFocusRef.current = target || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setEditing({ id: space.id, type: space._type, panoImage: space.panoImage || "" })
  }

  return (
    <div>
      <CMSSectionHeader title="Virtual Tour"
        currentSection="virtualTour" onNavigate={onNavigate} />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <p className="text-[11px] font-semibold text-slate-500">
            360 Panorama images appear in the virtual tour viewer on the landing page.
          </p>
        </div>

        {allSpaces.length > 0 ? (
          <Table className="min-w-[680px]">
              <caption className="sr-only">Virtual tour panorama management records</caption>
              <TableHeader className="bg-slate-50/80">
                <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-black">
                  <TableHead scope="col" className="oe-table-head">Space Name</TableHead>
                  <TableHead scope="col" className="oe-table-head hidden sm:table-cell">Type</TableHead>
                  <TableHead scope="col" className="oe-table-head">360 Image</TableHead>
                  <TableHead scope="col" className="oe-table-head hidden md:table-cell">Status</TableHead>
                  <TableHead scope="col" className="oe-table-head w-20 text-right">Actions</TableHead>
                </tr>
              </TableHeader>
              <TableBody>
                {allSpaces.map((s: any) => (
                  <tr key={s.id} className="border-b border-slate-50 text-sm transition hover:bg-slate-50/50">
                    <TableCell className="font-bold text-slate-900">{s.name || "Untitled"}</TableCell>
                    <TableCell className="hidden text-slate-600 sm:table-cell">{s._label}</TableCell>
                    <TableCell>
                      {s.panoImage ? (
                        <div className="h-9 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                          <img src={s.panoImage} alt="" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }} />
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold text-rose-500">No image</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell"><CMSStatusBadge status={getCatalogStatus(s)} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <IconButton label={`Edit panorama for ${s.name || "space"}`} onClick={(event) => openEditor(s, event.currentTarget)}><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></IconButton>
                        <IconButton label={getCatalogStatus(s) === "published" ? `Mark ${s.name || "space"} under renovation` : `Publish ${s.name || "space"}`}
                          onClick={() => {
                            const catalogStatus: CatalogStatus = getCatalogStatus(s) === "published" ? "under_renovation" : "published"
                            const data = { catalogStatus, isHidden: catalogStatus === "under_renovation", updatedAt: new Date().toISOString() }
                            if (s._type === "venue") updateVenue(s.id, data); else updateOffice(s.id, data)
                          }}>{getCatalogStatus(s) === "under_renovation" ? <Eye className="h-3.5 w-3.5" aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}</IconButton>
                      </div>
                    </TableCell>
                  </tr>
                ))}
              </TableBody>
          </Table>
        ) : (
          <div className="p-5">
            <EmptyState icon={<Pencil className="h-8 w-8 text-purple-400" />} title="No spaces available"
              description="Add venues or offices first to set up 360 virtual tours." />
          </div>
        )}
      </section>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null) }}>
        {editing && <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocusRef.current?.focus(); restoreFocusRef.current = null }} className="w-[calc(100vw-2rem)] max-w-md p-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <div>
                <DialogTitle className="text-base font-black text-slate-950">Edit Panorama</DialogTitle>
                <DialogDescription className="sr-only">Update the 360 tour image for this catalog space.</DialogDescription>
                <p className="text-xs font-semibold text-slate-500">{allSpaces.find((s: any) => s.id === editing.id)?.name}</p>
              </div>
              <DialogClose asChild><IconButton label="Close panorama editor"><X className="h-4 w-4" /></IconButton></DialogClose>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
              <CMSPanoramaUpload value={editing.panoImage} onValueChange={(v) => setEditing({ ...editing, panoImage: v })} />
            </div>
            <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
              <Button type="button" variant="brand" onClick={handleSave} className="h-11 w-full flex-1 rounded-lg text-xs">
                <Save className="mr-1.5 h-3.5 w-3.5" /> Save
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)} className="h-9 rounded-lg border-slate-200 text-xs font-bold">
                <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
              </Button>
            </div>
          </div>
        </DialogContent>}
      </Dialog>
    </div>
  )
}
