"use client"

import { type ChangeEvent, useState } from "react"
import { ImageIcon, Loader2, Upload, X } from "lucide-react"
import { useToast } from "@shared/hooks/use-toast"
import { validateImageFile, uploadCMSImage, removeImage } from "@shared/lib/image-upload"
import { getImageSource } from "@/src/modules/shared/lib/file-utils"

export function CMSImageUpload({
  label, value, note, accent = "orange", storagePath, onValueChange,
}: {
  label: string; value?: string; note?: string; accent?: "orange" | "blue" | "purple" | "rose"; storagePath?: string; onValueChange: (v: string) => void
}) {
  const { toast } = useToast()
  const [uploading, setUploading] = useState(false)

  const accentColors: Record<string, string> = {
    orange: "bg-orange-50 text-orange-600 border-orange-200 hover:border-orange-300",
    blue: "bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-300",
    purple: "bg-purple-50 text-purple-600 border-purple-200 hover:border-purple-300",
    rose: "bg-rose-50 text-rose-600 border-rose-200 hover:border-rose-300",
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ""

    setUploading(true)
    try {
      validateImageFile(file)
      const path = storagePath || "images"
      const downloadUrl = await uploadCMSImage(file, path)
      if (value) {
        await removeImage(value)
      }
      onValueChange(downloadUrl)
    } catch (error: any) {
      const msg = error?.message || ""
      if (msg.includes("Only") || msg.includes("size exceeds")) {
        toast({ title: "Invalid File", description: msg, variant: "destructive" })
      } else {
        toast({ title: "Upload Failed", description: "Could not upload image. Please try again.", variant: "destructive" })
      }
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async () => {
    onValueChange(await removeImage(value || ""))
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</label>
        <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
      </div>

      <div className="flex flex-col gap-3">
        {value ? (
          <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
            <img src={getImageSource(value)} alt={label} className="h-32 w-full object-cover"
              onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }} />
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition hover:opacity-100">
              {uploading ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[10px] font-bold text-slate-800 shadow">
                  <Loader2 className="h-3 w-3 animate-spin" /> Uploading...
                </span>
              ) : (
                <>
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" onChange={handleFile} hidden />
                    <span className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[10px] font-bold text-slate-800 shadow">
                      <Upload className="h-3 w-3" /> Replace
                    </span>
                  </label>
                  <button type="button" onClick={handleRemove}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[10px] font-bold text-rose-600 shadow hover:bg-rose-50">
                    <X className="h-3 w-3" /> Remove
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white py-5 transition ${uploading ? "opacity-50 pointer-events-none" : accentColors[accent].replace(/bg-\w+-50/g, "hover:" + (accent === "orange" ? "bg-orange-50/30" : accent === "blue" ? "bg-blue-50/30" : accent === "purple" ? "bg-purple-50/30" : "bg-rose-50/30"))}`}>
            <input type="file" accept="image/*" onChange={handleFile} hidden />
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accentColors[accent]}`}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            </div>
            <div>
              <p className="text-xs font-bold text-slate-700">{uploading ? "Uploading..." : "Upload Photo"}</p>
              <p className="text-[10px] font-semibold text-slate-500">{uploading ? "Please wait..." : "Click to browse (max 2.5MB)"}</p>
            </div>
          </label>
        )}

        {note && <p className="text-[11px] font-medium text-slate-500">{note}</p>}
      </div>
    </div>
  )
}

export function CMSPanoramaUpload({ value, storagePath, onValueChange }: { value?: string; storagePath?: string; onValueChange: (v: string) => void }) {
  const { toast } = useToast()
  const [uploading, setUploading] = useState(false)

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ""

    setUploading(true)
    try {
      validateImageFile(file, true)
      const path = storagePath || "panoramas"
      const downloadUrl = await uploadCMSImage(file, path)
      if (value) {
        await removeImage(value)
      }
      onValueChange(downloadUrl)
    } catch (error: any) {
      const msg = error?.message || ""
      if (msg.includes("Only") || msg.includes("size exceeds")) {
        toast({ title: "Invalid File", description: msg, variant: "destructive" })
      } else {
        toast({ title: "Upload Failed", description: "Could not upload image. Please try again.", variant: "destructive" })
      }
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async () => {
    onValueChange(await removeImage(value || ""))
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">360 Panorama Image</label>
        <ImageIcon className="h-3.5 w-3.5 text-purple-400" />
      </div>

      <div className="flex flex-col gap-3">
        {value ? (
          <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white">
            <img src={value} alt="Panorama" className="h-28 w-full object-cover" onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }} />
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition hover:opacity-100">
              {uploading ? (
                <span className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[10px] font-bold text-slate-800 shadow">
                  <Loader2 className="h-3 w-3 animate-spin" /> Uploading...
                </span>
              ) : (
                <>
                  <label className="cursor-pointer">
                    <input type="file" accept="image/*" onChange={handleFile} hidden />
                    <span className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[10px] font-bold text-slate-800 shadow"><Upload className="h-3 w-3" /> Replace</span>
                  </label>
                  <button type="button" onClick={handleRemove}
                    className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-[10px] font-bold text-rose-600 shadow hover:bg-rose-50"><X className="h-3 w-3" /> Remove</button>
                </>
              )}
            </div>
          </div>
        ) : (
          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 bg-white py-4 transition hover:border-purple-300 hover:bg-purple-50/30 ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
            <input type="file" accept="image/*" onChange={handleFile} hidden />
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600">{uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}</div>
            <div>
              <p className="text-xs font-bold text-slate-700">{uploading ? "Uploading..." : "Upload 360 Panorama"}</p>
              <p className="text-[10px] font-semibold text-slate-500">{uploading ? "Please wait..." : "Wide 360 image, max 10MB"}</p>
            </div>
          </label>
        )}
      </div>
    </div>
  )
}
