"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Building2,
  Camera,
  Maximize2,
  PauseCircle,
  PlayCircle,
  RefreshCcw,
  Users,
  X,
} from "lucide-react"

import { Button } from "@/src/modules/shared/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/src/modules/shared/components/ui/dialog"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { getImageSource } from "@/src/modules/shared/lib/file-utils"

type SpaceType = "venues" | "offices"

type TourSpace = {
  id: string
  name: string
  description?: string
  capacity?: string
  price?: number | string
  image?: string
  panoImage?: string
}

type TourButtonProps = {
  children?: React.ReactNode
  className?: string
  size?: "default" | "sm" | "lg" | "icon"
}

declare global {
  interface Window {
    pannellum?: any
  }
}

const PANNELLUM_CSS_ID = "pannellum-css"
const PANNELLUM_SCRIPT_ID = "pannellum-script"

function normalizeSpaces(spaces?: any[]): TourSpace[] {
  if (!Array.isArray(spaces)) return []

  return spaces.map((space, index) => ({
    id: String(space.id || `${space.name || "space"}-${index}`),
    name: String(space.name || space.title || `Space ${index + 1}`),
    description: String(space.description || ""),
    capacity: String(space.capacity || ""),
    price: space.price || 0,
    image: String(space.image || ""),
    panoImage: String(space.panoImage || space.panorama || space.pano || ""),
  }))
}

function loadPannellum() {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") return resolve()

    if (window.pannellum) {
      resolve()
      return
    }

    if (!document.getElementById(PANNELLUM_CSS_ID)) {
      const link = document.createElement("link")
      link.id = PANNELLUM_CSS_ID
      link.rel = "stylesheet"
      link.href = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css"
      document.head.appendChild(link)
    }

    const existingScript = document.getElementById(PANNELLUM_SCRIPT_ID) as HTMLScriptElement | null

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true })
      existingScript.addEventListener("error", () => reject(new Error("Failed to load 360 viewer.")), { once: true })
      return
    }

    const script = document.createElement("script")
    script.id = PANNELLUM_SCRIPT_ID
    script.src = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js"
    script.async = true

    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load 360 viewer."))

    document.body.appendChild(script)
  })
}

export function TourButton({ children, className, size = "lg" }: TourButtonProps) {
  const { cmsData } = useCMS()

  const venues = useMemo(() => normalizeSpaces(cmsData?.venues), [cmsData?.venues])
  const offices = useMemo(() => normalizeSpaces(cmsData?.offices), [cmsData?.offices])

  const [open, setOpen] = useState(false)
  const [activeType, setActiveType] = useState<SpaceType>("venues")
  const [selectedId, setSelectedId] = useState("")
  const [isViewerReady, setIsViewerReady] = useState(false)
  const [viewerError, setViewerError] = useState("")
  const [isAutoPanning, setIsAutoPanning] = useState(true)

  const viewerRef = useRef<any>(null)

  const activeSpaces = activeType === "venues" ? venues : offices

  const selectedSpace = useMemo(() => {
    return activeSpaces.find((space) => space.id === selectedId) || activeSpaces[0] || null
  }, [activeSpaces, selectedId])

  const applyAutoPan = (shouldPan: boolean) => {
    const viewer = viewerRef.current
    if (!viewer) return

    try {
      if (shouldPan) {
        viewer.startAutoRotate?.(-2, 0)
      } else {
        viewer.stopAutoRotate?.()
      }
    } catch (error) {
      console.error("Failed to toggle tour auto-pan", error)
    }
  }

  useEffect(() => {
    if (!open) return

    const firstSpace = activeSpaces[0]
    if (!selectedId && firstSpace) setSelectedId(firstSpace.id)
  }, [open, activeSpaces, selectedId])

  useEffect(() => {
    if (!open || !selectedSpace) return

    let cancelled = false
    const viewerContainerId = "one-estela-tour-panorama"
    const panoramaSource = selectedSpace.panoImage || selectedSpace.image

    setIsViewerReady(false)
    setViewerError("")

    if (viewerRef.current?.destroy) {
      viewerRef.current.destroy()
      viewerRef.current = null
    }

    if (!panoramaSource) {
      setViewerError("No 360 panorama image available.")
      setIsViewerReady(true)
      return
    }

    loadPannellum()
      .then(() => {
        if (cancelled || !window.pannellum) return

        const container = document.getElementById(viewerContainerId)
        if (!container) return

        container.innerHTML = ""

        viewerRef.current = window.pannellum.viewer(viewerContainerId, {
          type: "equirectangular",
          panorama: getImageSource(panoramaSource),
          autoLoad: true,
          showControls: false,
          showZoomCtrl: false,
          showFullscreenCtrl: false,
          keyboardZoom: true,
          mouseZoom: true,
          draggable: true,
          compass: false,
          hfov: 100,
          minHfov: 50,
          maxHfov: 120,
          autoRotate: isAutoPanning ? -2 : 0,
        })

        const markReady = () => {
          if (cancelled) return
          setIsViewerReady(true)
          applyAutoPan(isAutoPanning)
        }

        if (viewerRef.current?.on) {
          viewerRef.current.on("load", markReady)
          viewerRef.current.on("error", () => {
            if (!cancelled) setIsViewerReady(true)
          })
        }

        window.setTimeout(markReady, 700)
      })
      .catch(() => {
        if (!cancelled) {
          setViewerError("Unable to load 360 viewer.")
          setIsViewerReady(true)
        }
      })

    return () => {
      cancelled = true
      if (viewerRef.current?.destroy) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, [open, selectedSpace])

  useEffect(() => {
    applyAutoPan(isAutoPanning)
  }, [isAutoPanning])

  const handleSwitchType = (type: SpaceType) => {
    setActiveType(type)
    const nextSpaces = type === "venues" ? venues : offices
    setSelectedId(nextSpaces[0]?.id || "")
  }

  const handleToggleAutoPan = () => {
    setIsAutoPanning((current) => !current)
  }

  const handleZoomIn = () => {
    if (!viewerRef.current) return
    const currentHfov = viewerRef.current.getHfov()
    viewerRef.current.setHfov(Math.max(50, currentHfov - 10))
  }

  const handleZoomOut = () => {
    if (!viewerRef.current) return
    const currentHfov = viewerRef.current.getHfov()
    viewerRef.current.setHfov(Math.min(120, currentHfov + 10))
  }

  const handleResetView = () => {
    if (!viewerRef.current) return
    viewerRef.current.setPitch(0)
    viewerRef.current.setYaw(0)
    viewerRef.current.setHfov(100)
    applyAutoPan(isAutoPanning)
  }

  const handleFullscreen = () => {
    const container = document.getElementById("one-estela-tour-panorama")
    if (!container?.requestFullscreen) return
    container.requestFullscreen()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={className} size={size}>
          {children || (
            <>
              <Camera className="mr-2 h-4 w-4" />
              Take a Tour
            </>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent aria-describedby={undefined} showCloseButton={false} className="w-[95vw] sm:max-w-[1200px] max-h-[90dvh] overflow-hidden rounded-2xl border-0 bg-black p-0 shadow-2xl">
        <DialogTitle className="sr-only">360 Tour</DialogTitle>

        <div className="relative flex h-[calc(100dvh-32px)] flex-col overflow-hidden bg-black lg:grid lg:grid-cols-[1fr_380px]">
          {/* ── SINGLE CLOSE BUTTON (modal level) ── */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute right-3 top-3 z-50 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/30 lg:right-4 lg:top-4"
          >
            <X className="h-4 w-4" />
          </button>

          {/* ── VIEWER ── */}
          <div className="relative h-[50dvh] min-h-[260px] shrink-0 overflow-hidden bg-slate-950 lg:h-full lg:min-h-0">
            <div
              id="one-estela-tour-panorama"
              className="h-full w-full"
            />

            {/* Loading / error overlay */}
            {(!isViewerReady || viewerError) && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80">
                {!viewerError ? (
                  <>
                    <div className="mb-4 h-8 w-8 animate-spin rounded-full border-[3px] border-orange-600 border-t-transparent" />
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-white/80">
                      Loading 360° View...
                    </p>
                  </>
                ) : (
                  <>
                    <Camera className="mb-3 h-10 w-10 text-orange-500" />
                    <p className="text-sm font-bold text-white">{viewerError}</p>
                    <p className="mt-1 text-xs font-semibold text-slate-400">
                      Upload a panorama image in CMS Settings.
                    </p>
                  </>
                )}
              </div>
            )}

            {/* Controls bar */}
            <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/70 p-1.5 text-white shadow-xl backdrop-blur">
              <button
                type="button"
                onClick={handleToggleAutoPan}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-600 transition hover:bg-orange-700"
                title={isAutoPanning ? "Pause auto-rotate" : "Start auto-rotate"}
              >
                {isAutoPanning ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
              </button>

              <div className="mx-0.5 h-5 w-px bg-white/15" />

              <button
                type="button"
                onClick={handleZoomOut}
                className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white transition hover:bg-white/10"
                title="Zoom out"
              >
                -
              </button>

              <button
                type="button"
                onClick={handleResetView}
                className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/10"
                title="Reset view"
              >
                <RefreshCcw className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={handleZoomIn}
                className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white transition hover:bg-white/10"
                title="Zoom in"
              >
                +
              </button>

              <div className="mx-0.5 h-5 w-px bg-white/15" />

              <button
                type="button"
                onClick={handleFullscreen}
                className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/10"
                title="Fullscreen"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── INFO PANEL ── */}
          <div className="flex flex-1 flex-col overflow-hidden border-t border-white/10 bg-black lg:flex-none lg:border-t-0 lg:border-l lg:border-white/10">
            <div className="flex-1 overflow-y-auto max-h-[90dvh] px-5 py-5 sm:px-6 sm:py-6">
              {/* Title and badge */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-orange-600 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-white">
                  {activeType === "venues" ? "Event Venue" : "Office Space"}
                </span>
                {selectedSpace?.capacity && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-[10px] font-bold text-white">
                    <Users className="h-3 w-3" />
                    {selectedSpace.capacity}
                  </span>
                )}
              </div>

              <h2 className="text-xl font-bold leading-tight text-white sm:text-2xl">
                {selectedSpace?.name || "One Estela Place"}
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {selectedSpace?.description ||
                  "Explore our available spaces through a 360° panorama view."}
              </p>

              {/* Type tabs */}
              <div className="mt-6 flex gap-1 rounded-lg border border-white/10 bg-white/[0.04] p-1">
                <button
                  type="button"
                  onClick={() => handleSwitchType("venues")}
                  className={`flex-1 rounded-md py-2 text-[11px] font-bold uppercase tracking-[0.1em] transition ${
                    activeType === "venues"
                      ? "bg-orange-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Venues
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchType("offices")}
                  className={`flex-1 rounded-md py-2 text-[11px] font-bold uppercase tracking-[0.1em] transition ${
                    activeType === "offices"
                      ? "bg-orange-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Offices
                </button>
              </div>

              {/* Space selectors */}
              {activeSpaces.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {activeSpaces.map((space) => {
                    const isActive = selectedSpace?.id === space.id

                    return (
                      <button
                        key={space.id}
                        type="button"
                        onClick={() => setSelectedId(space.id)}
                        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${
                          isActive
                            ? "border-orange-600 bg-orange-600/10"
                            : "border-white/10 bg-white/[0.03] hover:border-white/20"
                        }`}
                      >
                        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-800">
                          <img
                            src={getImageSource(space.image || space.panoImage)}
                            alt={space.name}
                            className="h-full w-full object-cover"
                            onError={(e) => { e.currentTarget.src = "/placeholder.jpg" }}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-bold ${
                            isActive ? "text-white" : "text-slate-300"
                          }`}>
                            {space.name}
                          </p>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                            {space.capacity && (
                              <span className="inline-flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {space.capacity}
                              </span>
                            )}
                            {activeType === "offices" && (
                              <Building2 className="h-3 w-3 text-orange-500" />
                            )}
                          </div>
                        </div>

                        {isActive && (
                          <div className="h-2 w-2 shrink-0 rounded-full bg-orange-600" />
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-5 py-8 text-center">
                  <Camera className="mx-auto mb-2 h-8 w-8 text-slate-500" />
                  <p className="font-bold text-white">No spaces available</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    Add venues or offices in CMS Settings first.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default TourButton
