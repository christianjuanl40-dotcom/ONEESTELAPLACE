"use client"

import { useEffect, useState } from "react"
import { Save } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { Textarea } from "@shared/components/ui/textarea"
import { useCMS } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSImageUpload } from "./cms-image-upload"

export function CMSHomepageTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { cmsData, saveCMSData } = useCMS()
  const [form, setForm] = useState(cmsData.homepage)
  const [footer, setFooter] = useState(cmsData.footer)

  useEffect(() => { setForm(cmsData.homepage); setFooter(cmsData.footer) }, [cmsData.homepage, cmsData.footer])

  const handleSave = () => {
    saveCMSData({
      ...cmsData,
      homepage: form,
      footer: footer,
    })
  }

  return (
    <div>
      <CMSSectionHeader title="Homepage" description="Edit all landing page content, branding, and footer details."
        currentSection="homepage" onNavigate={onNavigate}
        action={<Button type="button" onClick={handleSave}
          className="w-full sm:w-auto h-11 rounded-lg bg-orange-600 px-4 text-xs font-bold text-white hover:bg-orange-700">
          <Save className="mr-1.5 h-3.5 w-3.5" /> Save Changes</Button>} />

      <div className="max-w-4xl space-y-6">

        {/* ── Hero Section ── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-black text-slate-900">Hero Section</h2>
            <p className="text-xs font-medium text-slate-500">Main landing page hero area</p>
          </div>
          <div className="grid gap-5 p-6">
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Hero Badge</label>
              <Input value={form.heroBadge || ""} onChange={(e) => setForm({ ...form, heroBadge: e.target.value })}
                className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="Event Venue · San Pedro, Laguna" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Hero Title</label>
              <Textarea value={form.heroTitle || ""} onChange={(e) => setForm({ ...form, heroTitle: e.target.value })}
                className="mt-1.5 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Hero Subtitle</label>
              <Textarea value={form.heroSubtitle || ""} onChange={(e) => setForm({ ...form, heroSubtitle: e.target.value })}
                className="mt-1.5 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
            </div>
            <CMSImageUpload label="Hero Background Image" value={form.heroImage} storagePath="hero"
              onValueChange={(v) => setForm({ ...form, heroImage: v })} note="Main hero background image on the landing page." />
          </div>
        </section>

        {/* ── About Section ── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-black text-slate-900">About / Our Story</h2>
            <p className="text-xs font-medium text-slate-500">About section content below the hero</p>
          </div>
          <div className="grid gap-5 p-6">
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Section Label</label>
              <Input value={form.aboutLabel || ""} onChange={(e) => setForm({ ...form, aboutLabel: e.target.value })}
                className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="Our Story" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Section Title</label>
              <Input value={form.aboutTitle || ""} onChange={(e) => setForm({ ...form, aboutTitle: e.target.value })}
                className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="One Estela Place Event Venue" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Description</label>
              <p className="mb-1.5 text-[10px] text-slate-400">Use double line breaks to separate paragraphs.</p>
              <Textarea value={form.aboutDescription || ""} onChange={(e) => setForm({ ...form, aboutDescription: e.target.value })}
                className="w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
            </div>
            <CMSImageUpload label="About Image" value={form.aboutImage} storagePath="about"
              onValueChange={(v) => setForm({ ...form, aboutImage: v })} note="Image displayed next to the about text." />
          </div>
        </section>

        {/* ── Gallery & FAQ Labels ── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-black text-slate-900">Gallery &amp; FAQ Labels</h2>
            <p className="text-xs font-medium text-slate-500">Section headings for Past Events and FAQs</p>
          </div>
          <div className="grid gap-5 p-6">
            <div>
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-orange-600">Gallery / Past Events</p>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Label</label>
                  <Input value={form.galleryLabel || ""} onChange={(e) => setForm({ ...form, galleryLabel: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="Past Client Bookings" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Title</label>
                  <Input value={form.galleryTitle || ""} onChange={(e) => setForm({ ...form, galleryTitle: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="Real Events Hosted at One Estela Place" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Subtitle</label>
                <Textarea value={form.gallerySubtitle || ""} onChange={(e) => setForm({ ...form, gallerySubtitle: e.target.value })}
                  className="mt-1.5 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-orange-600">FAQ Section</p>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Label</label>
                  <Input value={form.faqLabel || ""} onChange={(e) => setForm({ ...form, faqLabel: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="Help Center" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Title</label>
                  <Input value={form.faqTitle || ""} onChange={(e) => setForm({ ...form, faqTitle: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="Frequently Asked Questions" />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Subtitle</label>
                <Textarea value={form.faqSubtitle || ""} onChange={(e) => setForm({ ...form, faqSubtitle: e.target.value })}
                  className="mt-1.5 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
            </div>
          </div>
        </section>

        {/* ── Bottom CTA Section ── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-black text-slate-900">Bottom CTA Section</h2>
            <p className="text-xs font-medium text-slate-500">The call-to-action section at the bottom of the landing page</p>
          </div>
          <div className="grid gap-5 p-6">
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Title</label>
              <Input value={form.ctaTitle || ""} onChange={(e) => setForm({ ...form, ctaTitle: e.target.value })}
                className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="Ready to plan your next event?" />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Description</label>
              <Textarea value={form.ctaDescription || ""} onChange={(e) => setForm({ ...form, ctaDescription: e.target.value })}
                className="mt-1.5 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
            </div>
          </div>
        </section>

        {/* ── Contact & Footer ── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-sm font-black text-slate-900">Contact &amp; Footer</h2>
            <p className="text-xs font-medium text-slate-500">Footer contact details, branding, and social links</p>
          </div>
          <div className="grid gap-5 p-6">
            <div>
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-orange-600">Branding</p>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Brand Name</label>
                  <Input value={footer.brandName || ""} onChange={(e) => setFooter({ ...footer, brandName: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="One Estela Place" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Copyright Text</label>
                  <Input value={footer.copyrightText || ""} onChange={(e) => setFooter({ ...footer, copyrightText: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" placeholder="One Estela Place. All rights reserved." />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Footer Description</label>
                <Textarea value={footer.footerDescription || ""} onChange={(e) => setFooter({ ...footer, footerDescription: e.target.value })}
                  className="mt-1.5 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
            </div>

            <div className="border-t border-slate-200 pt-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-orange-600">Contact Details</p>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Email</label>
                  <Input value={footer.email || ""} onChange={(e) => setFooter({ ...footer, email: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Phone</label>
                  <Input value={footer.phone || ""} onChange={(e) => setFooter({ ...footer, phone: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Address</label>
                  <Input value={footer.address || ""} onChange={(e) => setFooter({ ...footer, address: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-5">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.14em] text-orange-600">Social Links</p>
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Facebook URL</label>
                  <Input value={footer.facebook || ""} onChange={(e) => setFooter({ ...footer, facebook: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Instagram URL</label>
                  <Input value={footer.instagram || ""} onChange={(e) => setFooter({ ...footer, instagram: e.target.value })}
                    className="mt-1.5 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
