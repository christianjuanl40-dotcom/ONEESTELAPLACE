"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/src/modules/shared/components/ui/dialog"
import { Badge } from "@/src/modules/shared/components/ui/badge"
import {
  RotateCcw, ZoomIn, ZoomOut, X, ChevronLeft, ChevronRight, Users, PlayCircle, PauseCircle, Loader2
} from "lucide-react"

declare global {
  interface Window {
    pannellum?: any;
  }
}

interface VirtualTourProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface TourAngle {
  id: string
  name: string
  image: string
  thumbnail: string
}

interface TourArea {
  id: string
  name: string
  description: string
  capacity?: string
  amenities?: string[]
  angles: TourAngle[]
  category: "event" | "office"
  floor?: "ground" | "second"
}

export function VirtualTour({ open, onOpenChange }: VirtualTourProps) {
  const [currentAreaIndex, setCurrentAreaIndex] = useState(0)
  const [currentAngleIndex, setCurrentAngleIndex] = useState(0)
  
  const [isAutoRotating, setIsAutoRotating] = useState(true)
  const [libLoaded, setLibLoaded] = useState(false)
  const [isViewerReady, setIsViewerReady] = useState(false)
  
  const [activeTab, setActiveTab] = useState<"event" | "office">("event")
  const viewerRef = useRef<any>(null)

  const tourAreas: TourArea[] = []

  const currentArea = tourAreas[currentAreaIndex] || { id: "", name: "", description: "", capacity: "", amenities: [], category: "event" as const, angles: [] }
  const currentAngle = currentArea.angles[currentAngleIndex] || { id: "", name: "", image: "", thumbnail: "" }
  const filteredAreas = tourAreas.filter(a => a.category === activeTab)

  // --- STEP 1: I-LOAD ANG PANNELLUM LIBRARY (CDN) ---
  useEffect(() => {
    // Kung na-load na, wag na ulitin
    if (window.pannellum) { setLibLoaded(true); return; }

    // I-load ang CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css";
    document.head.appendChild(link);

    // I-load ang JS
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js";
    script.async = true;
    script.onload = () => setLibLoaded(true);
    document.body.appendChild(script);

    return () => {
      // Cleanup: wag na burahin ang lib para cached na sa susunod na bukas
    };
  }, []);

  // --- STEP 2: INITIALIZE ANG 360 VIEWER KAPAG BUKAS ANG MODAL ---
  useEffect(() => {
    if (!open || !libLoaded || !window.pannellum) return;

    // Siguraduhin nating malinis ang container bago i-init
    const container = document.getElementById("panorama-viewer");
    if (!container) return;
    
    // Kung may existing viewer, i-destroy muna natin para fresh
    if (viewerRef.current) {
      viewerRef.current.destroy();
    }

    // ✨ ITO NA ANG MAGIC INITIALIZATION NG TUNAY NA 360! ✨
    setIsViewerReady(false);
    viewerRef.current = window.pannellum.viewer('panorama-viewer', {
      type: 'equirectangular',
      panorama: currentAngle.image, // URL ng 360 image
      autoLoad: true, // Matic maglo-load
      autoRotate: isAutoRotating ? -2 : 0, // Bilis ng ikot (-2 degrees per second)
      showControls: false, // Itatago natin default controls para custom UI natin gamitin
      hfov: 110, // Field of view (zoom level)
      // Event: Kapag tapos na mag-load, mawawala ang loader
      onLoad: () => setIsViewerReady(true)
    });

    return () => {
      // Cleanup kapag nagsara ang modal
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [open, libLoaded, currentAreaIndex, currentAngleIndex]); // Magre-reload kapag nagpalit ng area/angle

  // --- CONTROLS LOGIC NA NAKA-CONNECT SA LIBRARY ---
  const handleZoomIn = () => { if (viewerRef.current) viewerRef.current.setHfov(viewerRef.current.getHfov() - 10) }
  const handleZoomOut = () => { if (viewerRef.current) viewerRef.current.setHfov(viewerRef.current.getHfov() + 10) }
  
  const toggleAutoRotate = () => {
    if (!viewerRef.current) return;
    const nextState = !isAutoRotating;
    setIsAutoRotating(nextState);
    if (nextState) { viewerRef.current.startAutoRotate(-2); } 
    else { viewerRef.current.stopAutoRotate(); }
  }

  const resetView = () => {
    if (!viewerRef.current) return;
    viewerRef.current.setHfov(110);
    viewerRef.current.setPitch(0);
    viewerRef.current.setYaw(0);
  }

  const switchAreaById = (id: string) => {
    const index = tourAreas.findIndex(a => a.id === id)
    if (index !== -1) {
      setCurrentAreaIndex(index)
      setCurrentAngleIndex(0)
    }
  }

  const closeTour = () => onOpenChange(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* MOBILE-FIRST FULL SCREEN MODAL */}
      <DialogContent className="max-w-[95vw] md:max-w-[90vw] w-full h-[100vh] h-[100dvh] md:h-[90vh] p-0 overflow-hidden border-none bg-black rounded-none md:rounded-[2rem] shadow-2xl z-[99999] [&>button]:hidden">
        <DialogTitle className="sr-only">Virtual Tour</DialogTitle>
        
        {/* ✨ THE 360 VIEWPORT CONTAINER ✨ */}
        <div className="absolute inset-0 w-full h-full bg-black relative">
          <div id="panorama-viewer" className="w-full h-full"></div>
          
          {/* Loader habang naglo-load ang library o image */}
          {(!libLoaded || !isViewerReady) && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black gap-3">
              <Loader2 className="w-8 h-8 text-[#ea580c] animate-spin" />
              <p className="text-white text-xs font-black tracking-[0.2em] uppercase">Loading 360° View...</p>
            </div>
          )}
        </div>

        {/* TOP LEFT: VENUE INFORMATION */}
        <div className="absolute top-0 left-0 right-0 p-6 md:p-8 bg-gradient-to-b from-black/95 via-black/40 to-transparent pointer-events-none z-20">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-3 pointer-events-auto">
              <Badge className="bg-[#ea580c] text-white border-none px-3 py-1 font-black tracking-[0.2em] uppercase text-[10px] shadow-sm">
                {currentArea.category === "event" ? "Event Venue" : "Office Space"}
              </Badge>
              {currentArea.capacity && (
                <Badge variant="outline" className="text-white border-white/30 font-bold bg-white/10 px-3 py-1 shadow-sm backdrop-blur-md hidden sm:flex">
                  <Users className="w-3.5 h-3.5 mr-1.5" /> {currentArea.capacity}
                </Badge>
              )}
            </div>
            
            <h2 className="text-3xl md:text-5xl font-black text-white drop-shadow-xl leading-tight mb-2">
              {currentArea.name}
            </h2>
            <p className="text-sm md:text-base text-white/90 font-medium leading-relaxed drop-shadow-md">
              {currentArea.description}
            </p>
          </div>
        </div>

        {/* TOP RIGHT: CLOSE BUTTON */}
        <button 
          onClick={closeTour} 
          className="absolute top-6 right-6 z-[99999] w-12 h-12 flex items-center justify-center bg-black/40 hover:bg-white hover:text-black backdrop-blur-md text-white rounded-full transition-all active:scale-95 border border-white/20 shadow-xl"
        >
          <X className="w-5 h-5" />
        </button>

        {/* BOTTOM SECTION: CONTROLS & GALLERY */}
        <div className="absolute bottom-0 left-0 right-0 pt-20 pb-6 px-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent pointer-events-none z-20 flex flex-col gap-4">
          
          <div className="flex flex-col md:flex-row justify-between items-end gap-4 pointer-events-auto">
            
            {/* TABS */}
            <div className="flex bg-white/10 p-1 rounded-full backdrop-blur-md border border-white/10 shrink-0">
              <button onClick={() => setActiveTab("event")} className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-[0.2em] transition-colors ${activeTab === "event" ? "bg-[#ea580c] text-white shadow-md" : "text-white/70 hover:text-white"}`}>
                Venues
              </button>
              <button onClick={() => setActiveTab("office")} className={`px-6 py-2 rounded-full text-xs font-bold uppercase tracking-[0.2em] transition-colors ${activeTab === "office" ? "bg-[#ea580c] text-white shadow-md" : "text-white/70 hover:text-white"}`}>
                Offices
              </button>
            </div>

            {/* 360 CONTROLS (Naka-connect na sa library!) */}
            <div className="flex items-center gap-1.5 bg-black/60 p-2 rounded-full backdrop-blur-md border border-white/20 shadow-xl">
              <button onClick={toggleAutoRotate} className={`p-2.5 rounded-full transition-colors ${isAutoRotating ? 'bg-[#ea580c] text-white' : 'text-white hover:bg-white/20'}`} title="Play/Pause 360 Rotation">
                {isAutoRotating ? <PauseCircle className="w-5 h-5" /> : <PlayCircle className="w-5 h-5" />}
              </button>
              <div className="w-px h-6 bg-white/20 mx-1"></div>
              <button onClick={handleZoomOut} className="p-2.5 text-white hover:bg-white/20 rounded-full transition-colors"><ZoomOut className="w-5 h-5" /></button>
              <button onClick={resetView} className="p-2.5 text-white hover:bg-white/20 rounded-full transition-colors"><RotateCcw className="w-5 h-5" /></button>
              <button onClick={handleZoomIn} className="p-2.5 text-white hover:bg-white/20 rounded-full transition-colors"><ZoomIn className="w-5 h-5" /></button>
            </div>
          </div>

          {/* GALLERY */}
          <div className="w-full overflow-x-auto custom-scrollbar pb-2 pointer-events-auto shrink-0">
            <div className="flex gap-4 w-max">
              {filteredAreas.map((area) => {
                const globalIndex = tourAreas.findIndex(a => a.id === area.id)
                const isActive = globalIndex === currentAreaIndex

                return (
                  <div 
                    key={area.id} 
                    onClick={() => switchAreaById(area.id)} 
                    className={`relative w-48 h-28 rounded-2xl overflow-hidden cursor-pointer border-2 transition-all duration-300 ${
                      isActive ? 'border-[#ea580c] scale-105 shadow-[0_0_20px_rgba(234,88,12,0.5)] z-10' : 'border-white/10 hover:border-white/50 opacity-70 hover:opacity-100'
                    }`}
                  >
                    <img src={area.angles[0].thumbnail} alt={area.name} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex items-end p-3">
                      <span className="text-white text-xs font-bold leading-tight drop-shadow-md">
                        {area.name}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  )
}