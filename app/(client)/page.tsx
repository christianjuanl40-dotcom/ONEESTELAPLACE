"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { PublicLayout } from "@/src/modules/client/components/public-layout"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/src/modules/shared/components/ui/accordion"
import {
  Calendar,
  Camera,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  Loader2,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { ReserveButton } from "@/src/modules/client/components/reserve-button"
import { TourButton } from "@/src/modules/client/components/tour-button"
import { useCMS } from "@/src/modules/admin/contexts/cms-context"
import { useAuth } from "@/src/modules/shared/auth/auth-context"
import type { PastClientBooking } from "@/src/modules/admin/contexts/cms-context"
import { cn } from "@/src/modules/shared/lib/utils"

function getImageSource(value?: string) {
  return value && value.trim() ? value : "/placeholder.jpg"
}

function formatDate(date?: string) {
  if (!date) return "Event date"

  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date

  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  }).format(parsed)
}

function GalleryModal({
  booking,
  onClose,
}: {
  booking: PastClientBooking | null
  onClose: () => void
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [isPortrait, setIsPortrait] = useState(false)

  useEffect(() => {
    setCurrentIndex(0)
    setZoom(1)
    setIsPortrait(false)
  }, [booking?.id])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowLeft") setCurrentIndex((i) => Math.max(0, i - 1))
      if (e.key === "ArrowRight") setCurrentIndex((i) => Math.min((booking?.photos?.length || 1) - 1, i + 1))
    }
    if (booking) {
      document.addEventListener("keydown", handleKey)
      document.body.style.overflow = "hidden"
    }
    return () => {
      document.removeEventListener("keydown", handleKey)
      document.body.style.overflow = ""
    }
  }, [booking, onClose])

  if (!booking) return null

  const photos = booking.photos || []
  const total = photos.length

  return (
    <div
      className="fixed inset-0 z-[10000] flex flex-col bg-black/95 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <header className="shrink-0 flex items-center justify-between border-b border-white/10 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{booking.eventName}</p>
          <p className="text-[11px] font-semibold text-white/60">{booking.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(3, z + 0.5)) }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-white border border-slate-600/50 shadow-lg transition hover:bg-slate-700 hover:border-slate-500"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.max(1, z - 0.5)) }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-white border border-slate-600/50 shadow-lg transition hover:bg-slate-700 hover:border-slate-500"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-white border border-slate-600/50 shadow-lg transition hover:bg-slate-700 hover:border-slate-500"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="relative flex min-h-full items-center justify-center">
          {total > 0 ? (
            <>
              <div
                className="flex items-center justify-center max-w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={photos[currentIndex]}
                  alt={`${booking.eventName} photo ${currentIndex + 1}`}
                  className={cn(
                    "rounded-lg object-contain transition-transform duration-200",
                    isPortrait ? "max-h-[55vh] w-auto" : "max-h-[80vh] w-auto"
                  )}
                  style={{ transform: `scale(${zoom})` }}
                  onLoad={(e) => {
                    const img = e.currentTarget
                    setIsPortrait(img.naturalHeight > img.naturalWidth)
                  }}
                />
              </div>

              {total > 1 && (
                <>
                  {currentIndex > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCurrentIndex((i) => i - 1); setZoom(1) }}
                      className="fixed left-4 top-1/2 -translate-y-1/2 z-[10001] flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                  )}
                  {currentIndex < total - 1 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCurrentIndex((i) => i + 1); setZoom(1) }}
                      className="fixed right-4 top-1/2 -translate-y-1/2 z-[10001] flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition hover:bg-black/80"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  )}
                  <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs font-bold text-white" onClick={(e) => e.stopPropagation()}>
                    {Math.round(zoom * 100)}% · {currentIndex + 1} of {total}
                  </span>
                </>
              )}
            </>
          ) : (
            <div className="text-center text-white/40">
              <ImageIcon className="mx-auto mb-3 h-16 w-16" />
              <p className="text-sm font-semibold">No photos available</p>
            </div>
          )}
        </div>
      </div>

      {total > 1 && (
        <footer className="shrink-0 flex items-center justify-center gap-2 border-t border-white/10 px-4 py-3 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
          {photos.map((photo, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); setCurrentIndex(i); setZoom(1) }}
              className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                i === currentIndex ? "border-white opacity-100" : "border-transparent opacity-50 hover:opacity-80"
              }`}
            >
              <img src={photo} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </footer>
      )}
    </div>
  )
}

export default function HomePage() {
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()

  const [authChecking, setAuthChecking] = useState(true)

  useEffect(() => {
    if (authLoading) return

    const redirectByRole = (role: string) => {
      const normalized = role.toLowerCase()
      if (normalized === "admin" || normalized === "staff" || normalized === "owner") {
        router.replace("/dashboard")
      } else {
        router.replace("/portal")
      }
    }

    if (user) {
      redirectByRole(user.role)
      return
    }

    setAuthChecking(false)
  }, [user, authLoading, router])

  if (authLoading || authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    )
  }

  return <LandingPageContent />
}

function LandingPageContent() {
  const { cmsData } = useCMS()

  const [galleryBooking, setGalleryBooking] = useState<PastClientBooking | null>(null)
  const [galleryPage, setGalleryPage] = useState(0)
  const [cardsPerView, setCardsPerView] = useState(3)

  const homepage = cmsData.homepage
  const faqs = cmsData.faqs.filter((f: any) => !f.isHidden)

  const pastClientBookings = useMemo(() => {
    const bookings = Array.isArray(cmsData?.pastClientBookings) ? cmsData.pastClientBookings : []

    return bookings
      .filter((b) => b.display !== false)
      .sort((a, b) => {
        return (
          new Date(b.date || b.createdAt || 0).getTime() -
          new Date(a.date || a.createdAt || 0).getTime()
        )
      })
  }, [cmsData?.pastClientBookings])

  useEffect(() => {
    const updatePerView = () => {
      const width = window.innerWidth
      if (width < 640) setCardsPerView(1)
      else if (width < 1024) setCardsPerView(2)
      else setCardsPerView(3)
    }
    updatePerView()
    window.addEventListener("resize", updatePerView)
    return () => window.removeEventListener("resize", updatePerView)
  }, [])

  useEffect(() => {
    setGalleryPage(0)
  }, [cardsPerView])

  const getCoverImage = (booking: PastClientBooking) => {
    if (booking.coverPhoto) return booking.coverPhoto
    if (booking.photos?.length > 0) return booking.photos[0]
    return "/placeholder.jpg"
  }

  return (
    <PublicLayout>
      <section
        id="home"
        className="relative flex w-full max-w-full min-h-[620px] items-center overflow-hidden overflow-x-hidden bg-slate-950 text-white"
      >
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{
            backgroundImage: `url('${getImageSource(homepage.heroImage)}')`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/60 to-orange-950/50" />

        <div className="container relative z-10 mx-auto px-4 py-24 text-center">
          <div className="mx-auto mb-5 w-fit rounded-full border border-white/20 bg-white/10 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-orange-100 backdrop-blur">
            {homepage.heroBadge}
          </div>

          <h1 className="mx-auto mb-6 max-w-4xl whitespace-pre-line text-2xl font-black leading-tight text-white drop-shadow-lg sm:text-4xl md:text-6xl">
            {homepage.heroTitle}
          </h1>

          <p className="mx-auto mb-8 max-w-2xl text-base font-semibold leading-8 text-white/90 drop-shadow-md md:text-xl">
            {homepage.heroSubtitle}
          </p>

          <div className="mx-auto flex w-full max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
            <ReserveButton
              className="h-12 w-full justify-center rounded-full border-0 bg-white px-7 text-sm font-black text-orange-600 shadow-lg transition hover:bg-orange-50 sm:w-auto"
              size="lg"
            >
              {homepage.heroPrimaryCta}
            </ReserveButton>

            <TourButton
              className="h-12 w-full justify-center rounded-full border-0 bg-orange-600 px-7 text-sm font-black text-white shadow-lg shadow-orange-600/30 transition hover:bg-orange-700 sm:w-auto"
              size="lg"
            >
              {homepage.heroSecondaryCta}
            </TourButton>
          </div>
        </div>
      </section>

      <section id="about" className="w-full bg-slate-50 py-20 overflow-x-hidden">
        <div className="container mx-auto max-w-6xl px-4">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-orange-600">
                {homepage.aboutLabel}
              </p>

              <h2 className="mb-4 text-4xl font-black text-slate-950">
                {homepage.aboutTitle}
              </h2>

              <div className="mb-8 h-1.5 w-20 rounded-full bg-orange-600" />

              <div className="space-y-6 text-lg leading-relaxed text-slate-600 break-words">
                {(homepage.aboutDescription ?? "").split("\n\n").filter(Boolean).map((para: string, i: number) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
            </div>

            <div className="relative h-[420px] overflow-hidden rounded-[2rem] shadow-2xl md:h-[550px]">
              <img
                src={getImageSource(homepage.aboutImage)}
                alt="About One Estela Place venue"
                className="h-full w-full max-w-full h-auto object-cover transition-transform duration-700 hover:scale-105"
                onError={(event) => {
                  event.currentTarget.src = "/placeholder.jpg"
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <section id="gallery" className="w-full bg-white py-20 overflow-x-hidden">
        <div className="container mx-auto max-w-7xl px-4">
          <div className="mb-12 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-orange-600">
                <Sparkles className="h-4 w-4" />
                {homepage.galleryLabel}
              </p>

              <h2 className="text-4xl font-black tracking-tight text-slate-950">
                {homepage.galleryTitle}
              </h2>

              <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-slate-500">
                {homepage.gallerySubtitle}
              </p>
            </div>

            <div className="rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-xs font-black uppercase tracking-[0.2em] text-orange-700">
              Client Event Photos
            </div>
          </div>

          {pastClientBookings.length > 0 ? (
            (() => {
              const totalPages = Math.max(1, Math.ceil(pastClientBookings.length / cardsPerView))
              const safePage = Math.min(galleryPage, totalPages - 1)
              const visibleBookings = pastClientBookings.slice(
                safePage * cardsPerView,
                safePage * cardsPerView + cardsPerView
              )

              const goToPage = (next: number) => {
                setGalleryPage(Math.max(0, Math.min(totalPages - 1, next)))
              }

              return (
                <div>
                  <div className="relative">
                    {safePage > 0 && (
                      <button
                        type="button"
                        onClick={() => goToPage(safePage - 1)}
                        aria-label="Previous bookings"
                        className="absolute -left-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-md transition hover:border-orange-300 hover:text-orange-600 hover:shadow-lg sm:-left-5"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                    )}

                    {safePage < totalPages - 1 && (
                      <button
                        type="button"
                        onClick={() => goToPage(safePage + 1)}
                        aria-label="Next bookings"
                        className="absolute -right-3 top-1/2 z-10 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-md transition hover:border-orange-300 hover:text-orange-600 hover:shadow-lg sm:-right-5"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    )}

                    <div className="overflow-hidden">
                      <div
                        key={safePage}
                        className="grid grid-cols-1 gap-6 transition-all duration-500 ease-out sm:grid-cols-2 lg:grid-cols-3"
                      >
                        {visibleBookings.map((booking) => (
                          <article
                            key={booking.id}
                            onClick={() => setGalleryBooking(booking)}
                            className="group cursor-pointer overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                          >
                            <div className="relative h-64 overflow-hidden bg-slate-100">
                              <img
                                src={getCoverImage(booking)}
                                alt={booking.eventName}
                                className="h-full w-full max-w-full h-auto object-cover transition duration-700 group-hover:scale-105"
                                onError={(imageEvent) => {
                                  imageEvent.currentTarget.src = "/placeholder.jpg"
                                }}
                              />

                              <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />

                              <div className="absolute bottom-4 left-4 rounded-full bg-white/95 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-orange-700 shadow">
                                {booking.eventType || "Event"}
                              </div>

                              {booking.photos && booking.photos.length > 0 && (
                                <div className="absolute right-4 top-4 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-sm">
                                  <Camera className="h-3 w-3" />
                                  {booking.photos.length} Photo{booking.photos.length !== 1 ? "s" : ""}
                                </div>
                              )}
                            </div>

                            <div className="p-4 sm:p-5">
                              <div className="mb-3 flex items-center gap-2 text-xs font-bold text-slate-500">
                                <Calendar className="h-4 w-4 text-orange-600" />
                                {formatDate(booking.date)}
                              </div>

                              <h3 className="text-xl font-black leading-tight text-slate-950">
                                {booking.eventName}
                              </h3>

                              <p className="mt-1 text-xs font-black uppercase tracking-[0.2em] text-orange-600">
                                {booking.name}
                                {booking.companyName && <span className="font-semibold text-slate-400"> · {booking.companyName}</span>}
                              </p>

                              {booking.testimonial && (
                                <p className="mt-3 line-clamp-3 text-sm font-medium leading-6 text-slate-600 italic">
                                  &ldquo;{booking.testimonial}&rdquo;
                                </p>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  </div>

                  {totalPages > 1 && (
                    <div className="mt-8 flex items-center justify-center gap-2">
                      {Array.from({ length: totalPages }).map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => goToPage(i)}
                          aria-label={`Go to page ${i + 1}`}
                          className={`h-2.5 rounded-full transition-all duration-300 ${
                            i === safePage
                              ? "w-7 bg-orange-600"
                              : "w-2.5 bg-slate-300 hover:bg-slate-400"
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })()
          ) : (
            <div className="rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
              <ImageIcon className="mx-auto mb-4 h-12 w-12 text-slate-300" />
              <h3 className="text-xl font-black text-slate-700">
                No client event photos uploaded yet
              </h3>
              <p className="mt-2 text-sm font-semibold text-slate-500">
                Admin can upload real past client booking photos in CMS Settings
                after getting client permission.
              </p>
            </div>
          )}
        </div>
      </section>

      <section id="faqs" className="w-full border-t border-slate-100 bg-slate-50 py-20 overflow-x-hidden">
        <div className="container mx-auto max-w-4xl px-4">
          <div className="mb-12 text-center">
            <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-orange-600">
              {homepage.faqLabel}
            </p>

            <h2 className="mb-4 text-4xl font-black text-slate-950">
              {homepage.faqTitle}
            </h2>

            <p className="text-lg text-slate-600">
              {homepage.faqSubtitle}
            </p>
          </div>

          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq: any, index: number) => (
              <AccordionItem
                key={faq.id || index}
                value={`faq-${index}`}
                className="rounded-2xl border border-slate-200 bg-white px-4 sm:px-6 shadow-sm transition-shadow hover:shadow"
              >
                <AccordionTrigger className="py-5 text-left font-bold text-slate-900 hover:text-orange-700 hover:no-underline">
                  {faq.question}
                </AccordionTrigger>

                <AccordionContent className="pb-5 leading-relaxed text-slate-600">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      <section id="booking" className="w-full bg-slate-950 py-20 text-white overflow-x-hidden">
        <div className="container mx-auto px-4 text-center">
          <Camera className="mx-auto mb-5 h-12 w-12 text-orange-500" />

          <h2 className="text-3xl font-black md:text-4xl">
            {homepage.ctaTitle}
          </h2>

          <p className="mx-auto mt-3 max-w-2xl text-sm font-semibold leading-7 text-slate-300">
            {homepage.ctaDescription}
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <ReserveButton
              className="h-12 w-full sm:w-auto rounded-full bg-orange-600 px-7 text-sm font-black text-white hover:bg-orange-700"
              size="lg"
            >
              {homepage.ctaButtonText}
            </ReserveButton>

            <TourButton
              className="h-12 w-full sm:w-auto rounded-full border border-white/20 bg-white px-7 text-sm font-black text-slate-950 hover:bg-orange-50"
              size="lg"
            >
              {homepage.ctaText}
            </TourButton>
          </div>
        </div>
      </section>

      <section id="find-us" className="w-full border-t border-slate-100 bg-white py-20 overflow-x-hidden">
        <div className="container mx-auto max-w-7xl px-4">
          <div className="mb-12 text-center">
            <p className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-orange-600">
              Location
            </p>

            <h2 className="text-4xl font-black tracking-tight text-slate-950">
              Find Us
            </h2>

            <p className="mt-3 max-w-2xl mx-auto text-sm font-semibold leading-6 text-slate-500">
              Visit One Estela Place at our location.
            </p>
          </div>

          <div className="mx-auto max-w-5xl overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50 shadow-sm">
            <iframe
              title="Map showing the location of One Estela Place at 82PJ+CMP, R. Magsaysay Ave, San Pedro, Laguna"
              src="https://www.google.com/maps?q=82PJ%2BCMP%2C%20R.%20Magsaysay%20Ave%2C%20San%20Pedro%2C%20Laguna&output=embed"
              className="h-[300px] w-full border-0 md:h-[380px] lg:h-[450px]"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>

          <div className="mt-6 flex justify-center">
            <a
              href="https://www.google.com/maps/search/?api=1&query=82PJ%2BCMP%2C%20R.%20Magsaysay%20Ave%2C%20San%20Pedro%2C%20Laguna"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open One Estela Place location in Google Maps"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-orange-600 px-7 text-sm font-black text-white shadow-sm transition hover:bg-orange-700"
            >
              📍 Open in Google Maps
            </a>
          </div>
        </div>
      </section>

      {galleryBooking && (
        <GalleryModal booking={galleryBooking} onClose={() => setGalleryBooking(null)} />
      )}
    </PublicLayout>
  )
}
