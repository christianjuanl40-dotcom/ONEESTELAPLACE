"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, Eye, EyeOff, HelpCircle, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { Textarea } from "@shared/components/ui/textarea"
import { Switch } from "@shared/components/ui/switch"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS, type FAQ } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSStatusBadge, EmptyState } from "./cms-status-badge"

export function CMSFaqsTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { cmsData, addFAQ, updateFAQ, deleteFAQ, reorderFAQs } = useCMS()
  const { toast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [isHidden, setIsHidden] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const activeFaqs = cmsData.faqs.filter((f) => !f.isArchived)
  const faqs = [...activeFaqs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const resetForm = () => { setQuestion(""); setAnswer(""); setIsHidden(false); setEditingId(null); setShowModal(false) }
  const openNew = () => { resetForm(); setShowModal(true) }
  const openEdit = (faq: FAQ) => { setEditingId(faq.id); setQuestion(faq.question); setAnswer(faq.answer); setIsHidden(faq.isHidden ?? false); setShowModal(true) }

  const handleSave = () => {
    if (!question.trim()) { toast({ title: "Question required", description: "Enter a question.", variant: "destructive" }); return }
    if (!answer.trim()) { toast({ title: "Answer required", description: "Enter an answer.", variant: "destructive" }); return }
    if (editingId) { updateFAQ(editingId, { question: question.trim(), answer: answer.trim(), isHidden }); toast({ title: "FAQ updated", description: "Changes saved.", className: "bg-emerald-500 text-white border-none" }) }
    else { addFAQ({ question: question.trim(), answer: answer.trim(), isHidden }); toast({ title: "FAQ added", description: "New FAQ created.", className: "bg-emerald-500 text-white border-none" }) }
    resetForm()
  }

  const handleDelete = (id: string) => { deleteFAQ(id); setConfirmDelete(null); toast({ title: "FAQ archived", description: "FAQ has been archived.", className: "bg-emerald-500 text-white border-none" }) }

  const moveUp = (index: number) => { if (index === 0) return; const ids = faqs.map((f) => f.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; reorderFAQs(ids) }
  const moveDown = (index: number) => { if (index >= faqs.length - 1) return; const ids = faqs.map((f) => f.id); [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]; reorderFAQs(ids) }

  const visibleCount = activeFaqs.filter((f) => !f.isHidden).length
  const hiddenCount = activeFaqs.filter((f) => f.isHidden).length

  return (
    <div>
      <CMSSectionHeader title="FAQs" description="Manage frequently asked questions shown on the landing page."
        currentSection="faqs" onNavigate={onNavigate}
        action={<Button type="button" onClick={openNew} className="h-9 rounded-lg bg-cyan-600 px-3.5 text-xs font-bold text-white hover:bg-cyan-700"><Plus className="mr-1 h-3.5 w-3.5" /> Add FAQ</Button>} />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-2.5">
          <p className="text-[11px] font-semibold text-slate-500">{visibleCount} visible · {hiddenCount} hidden · {faqs.length} total</p>
        </div>

        {faqs.length > 0 ? (
          <div className="p-4 space-y-1.5">
            {faqs.map((faq, index) => (
              <div key={faq.id} className="rounded-lg border border-slate-100 bg-white px-3.5 py-3 transition hover:border-slate-200 hover:shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-cyan-100 text-[10px] font-bold text-cyan-700">{index + 1}</span>
                      <h3 className="text-sm font-bold text-slate-900">{faq.question}</h3>
                      <CMSStatusBadge status={faq.isHidden ? "hidden" : "published"} />
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-sm text-slate-600">{faq.answer}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button type="button" onClick={() => moveUp(index)} disabled={index === 0}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => moveDown(index)} disabled={index >= faqs.length - 1}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => openEdit(faq)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => updateFAQ(faq.id, { isHidden: !faq.isHidden })} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">{faq.isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</button>
                    <button type="button" onClick={() => setConfirmDelete(faq.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={<HelpCircle className="h-8 w-8 text-cyan-400" />} title="No FAQs yet"
              description="Add frequently asked questions for your clients."
              action={<Button type="button" onClick={openNew} className="h-9 rounded-lg bg-cyan-600 text-xs font-bold text-white hover:bg-cyan-700"><Plus className="mr-1.5 h-4 w-4" /> Add FAQ</Button>} />
          </div>
        )}
      </section>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl max-h-[calc(100dvh-32px)] overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <h2 className="text-base font-black text-slate-950">{editingId ? "Edit FAQ" : "Add FAQ"}</h2>
              <button type="button" onClick={resetForm} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 p-5">
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Question</label>
                <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How long is the standard venue rental?" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 sm:text-xs">Answer</label>
                <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="The standard venue rental is 6 hours..."
                  className="mt-1 w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <Switch checked={isHidden} onCheckedChange={setIsHidden} />
                <span className="text-xs font-semibold text-slate-700">Hide from landing page</span>
              </label>
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
              <Button type="button" onClick={handleSave} className="w-full sm:w-auto h-11 flex-1 rounded-lg bg-cyan-600 text-xs font-bold text-white hover:bg-cyan-700">
                <Save className="mr-1.5 h-3.5 w-3.5" /> {editingId ? "Save Changes" : "Add FAQ"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} className="h-9 rounded-lg border-slate-200 text-xs font-bold"><X className="mr-1.5 h-3.5 w-3.5" /> Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xs rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-base font-black text-slate-900">Delete FAQ?</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">This cannot be undone.</p>
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" onClick={() => setConfirmDelete(null)} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">Cancel</Button>
              <Button type="button" onClick={() => handleDelete(confirmDelete)} className="h-9 flex-1 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
