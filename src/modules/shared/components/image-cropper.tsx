"use client"

import { useRef, useState, useCallback } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/src/modules/shared/components/ui/dialog"
import { Button } from "@/src/modules/shared/components/ui/button"
import { ZoomIn, ZoomOut } from "lucide-react"

interface ImageCropperProps {
  open: boolean
  imageUrl: string
  onCrop: (croppedDataUrl: string) => void
  onClose: () => void
}

const CROP_SIZE = 260

export function ImageCropper({ open, imageUrl, onCrop, onClose }: ImageCropperProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)

  const handleLoad = useCallback(() => {
    const img = imgRef.current
    if (!img) return
    const scaleX = CROP_SIZE / img.naturalWidth
    const scaleY = CROP_SIZE / img.naturalHeight
    setScale(Math.max(scaleX, scaleY))
    setOffset({ x: 0, y: 0 })
    setLoaded(true)
  }, [])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return
    setOffset({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }

  const handleMouseUp = () => setDragging(false)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return
    setDragging(true)
    setDragStart({ x: e.touches[0].clientX - offset.x, y: e.touches[0].clientY - offset.y })
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragging || e.touches.length !== 1) return
    setOffset({ x: e.touches[0].clientX - dragStart.x, y: e.touches[0].clientY - dragStart.y })
  }
  const handleTouchEnd = () => setDragging(false)

  const applyCrop = useCallback(() => {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container) return

    const cr = container.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    const sx = (cr.left - ir.left) * (img.naturalWidth / ir.width)
    const sy = (cr.top - ir.top) * (img.naturalHeight / ir.height)
    const sw = cr.width * (img.naturalWidth / ir.width)
    const sh = cr.height * (img.naturalHeight / ir.height)

    const canvas = document.createElement("canvas")
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 256, 256)
    onCrop(canvas.toDataURL("image/jpeg", 0.92))
    onClose()
  }, [onCrop, onClose])

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent aria-describedby={undefined} className="w-[95vw] overflow-y-auto max-h-[90dvh] sm:max-w-[440px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-slate-900">Adjust Photo</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-4">
          <div
            ref={containerRef}
            className="relative overflow-hidden rounded-xl bg-black/10"
            style={{ width: CROP_SIZE, height: CROP_SIZE }}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop preview"
              draggable={false}
              onLoad={handleLoad}
              className="max-w-none select-none"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                cursor: dragging ? "grabbing" : "grab",
                transformOrigin: "0 0",
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
            />
          </div>
          {loaded && (
            <div className="flex w-full max-w-[260px] items-center gap-2">
              <ZoomOut className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                type="range"
                min={50}
                max={400}
                value={Math.round(scale * 100)}
                onChange={(e) => setScale(Number(e.target.value) / 100)}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
              />
              <ZoomIn className="h-4 w-4 shrink-0 text-slate-400" />
            </div>
          )}
          <p className="text-xs text-slate-500">Drag to reposition · Slide to zoom</p>
        </div>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} className="h-11 w-full rounded-md sm:w-auto">
            Cancel
          </Button>
          <Button
            onClick={applyCrop}
            className="h-11 w-full rounded-md bg-slate-900 text-white hover:bg-slate-800 sm:w-auto"
          >
            Apply Crop
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
