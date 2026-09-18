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
    const viewportSize = containerRef.current?.clientWidth || CROP_SIZE
    const scaleX = viewportSize / img.naturalWidth
    const scaleY = viewportSize / img.naturalHeight
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
      <DialogContent
        aria-describedby={undefined}
        className="w-[calc(100vw-2rem)] max-w-[520px] overflow-hidden rounded-2xl p-0"
      >
        <DialogHeader className="shrink-0 border-b border-slate-100 px-5 py-4 pr-14">
          <DialogTitle className="text-lg font-black text-slate-950 sm:text-xl">Adjust Photo</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-5">
          <div className="flex flex-col items-center gap-4">
            <div
              ref={containerRef}
              className="relative aspect-square max-w-full overflow-hidden rounded-xl bg-slate-950/90 shadow-inner touch-none"
              style={{ width: "min(260px, calc(100vw - 5rem))", height: "min(260px, calc(100vw - 5rem))" }}
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
                <button
                  type="button"
                  aria-label="Zoom out"
                  onClick={() => setScale((current) => Math.max(0.5, current - 0.1))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-orange-200 hover:text-orange-600"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <input
                  type="range"
                  aria-label="Zoom"
                  min={50}
                  max={400}
                  value={Math.min(400, Math.max(50, Math.round(scale * 100)))}
                  onChange={(e) => setScale(Number(e.target.value) / 100)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-orange-600"
                />
                <button
                  type="button"
                  aria-label="Zoom in"
                  onClick={() => setScale((current) => Math.min(4, current + 0.1))}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-orange-200 hover:text-orange-600"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
              </div>
            )}
            <p className="text-xs font-medium text-slate-500">Drag to reposition</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-white px-5 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} className="h-10 w-full rounded-xl bg-white sm:w-auto">
            Cancel
          </Button>
          <Button
            onClick={applyCrop}
            className="h-10 w-full rounded-xl bg-orange-600 font-bold text-white hover:bg-orange-700 sm:w-auto"
          >
            Apply Photo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
