"use client"

import { useState, useEffect, useRef } from "react"
import {
  Banknote, Building2, ChevronDown, FileText, HelpCircle, Home,
  Newspaper, Tent, Users,
} from "lucide-react"
import type { ReactNode } from "react"

const SECTIONS = [
  { key: "homepage", label: "Homepage", icon: <Home className="h-4 w-4" /> },
  { key: "venues", label: "Event Venues", icon: <Tent className="h-4 w-4" /> },
  { key: "offices", label: "Office Spaces", icon: <Building2 className="h-4 w-4" /> },
  { key: "faqs", label: "FAQs", icon: <HelpCircle className="h-4 w-4" /> },
  { key: "policies", label: "Terms & Policies", icon: <Newspaper className="h-4 w-4" /> },
  { key: "pastClients", label: "Past Client Bookings", icon: <Users className="h-4 w-4" /> },
  { key: "contracts", label: "Contracts", icon: <FileText className="h-4 w-4" /> },
  { key: "payment", label: "Payment Settings", icon: <Banknote className="h-4 w-4" /> },
]

export function CMSSectionHeader({
  title, description, currentSection, onNavigate, action,
}: {
  title: string; description: string; currentSection: string
  onNavigate: (key: string) => void; action?: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [menuOpen])

  const currentLabel = SECTIONS.find((s) => s.key === currentSection)?.label || title

  return (
    <div className="mb-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-xl font-black tracking-tight text-slate-950">{title}</h2>
          <p className="mt-0.5 text-sm font-semibold leading-5 text-slate-500 max-w-xl">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-800"
            >
              {currentLabel}
              <ChevronDown className={`h-3.5 w-3.5 transition ${menuOpen ? "rotate-180" : ""}`} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                {SECTIONS.map((section) => (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => { onNavigate(section.key); setMenuOpen(false) }}
                    className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold transition ${
                      section.key === currentSection
                        ? "bg-orange-50 text-orange-700"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    <span className={`shrink-0 ${section.key === currentSection ? "text-orange-500" : "text-slate-400"}`}>
                      {section.icon}
                    </span>
                    <span>{section.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {action}
        </div>
      </div>
    </div>
  )
}


