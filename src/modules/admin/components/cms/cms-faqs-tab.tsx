"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Eye, EyeOff, HelpCircle, Pencil, Plus, Save, Trash2, X } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { Textarea } from "@shared/components/ui/textarea"
import { Switch } from "@shared/components/ui/switch"
import { useToast } from "@shared/hooks/use-toast"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@shared/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@shared/components/ui/alert-dialog"
import { IconButton } from "@shared/components/ui/icon-button"
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
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  const activeFaqs = cmsData.faqs.filter((f) => !f.isArchived)
  const faqs = [...activeFaqs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const resetForm = () => { setQuestion(""); setAnswer(""); setIsHidden(false); setEditingId(null); setShowModal(false) }
  const rememberFocus = (target?: HTMLElement) => {
    restoreFocusRef.current = target || (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  }
  useEffect(() => {
    if (showModal || !restoreFocusRef.current) return
    const target = restoreFocusRef.current
    const frame = window.requestAnimationFrame(() => {
      if (target.isConnected) target.focus()
      if (restoreFocusRef.current === target) restoreFocusRef.current = null
    })
    return () => window.cancelAnimationFrame(frame)
  }, [showModal])
  const openNew = (target?: HTMLElement) => { rememberFocus(target); resetForm(); setShowModal(true) }
  const openEdit = (faq: FAQ, target?: HTMLElement) => { rememberFocus(target); setEditingId(faq.id); setQuestion(faq.question); setAnswer(faq.answer); setIsHidden(faq.isHidden ?? false); setShowModal(true) }

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
      <CMSSectionHeader title="FAQs"
        currentSection="faqs" onNavigate={onNavigate}
        action={<Button type="button" variant="brand" onClick={(event) => openNew(event.currentTarget)} className="h-9 shrink-0 whitespace-nowrap rounded-lg px-3.5 text-sm"><Plus className="mr-1 h-3.5 w-3.5" /> Add FAQ</Button>} />

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
                    <IconButton label={`Move ${faq.question} up`} onClick={() => moveUp(index)} disabled={index === 0} className="h-8 w-8"><ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /></IconButton>
                    <IconButton label={`Move ${faq.question} down`} onClick={() => moveDown(index)} disabled={index >= faqs.length - 1} className="h-8 w-8"><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></IconButton>
                    <IconButton label={`Edit ${faq.question}`} onClick={(event) => openEdit(faq, event.currentTarget)} className="h-8 w-8"><Pencil className="h-3.5 w-3.5" aria-hidden="true" /></IconButton>
                    <IconButton label={`${faq.isHidden ? "Show" : "Hide"} ${faq.question}`} onClick={() => updateFAQ(faq.id, { isHidden: !faq.isHidden })} className="h-8 w-8">{faq.isHidden ? <Eye className="h-3.5 w-3.5" aria-hidden="true" /> : <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />}</IconButton>
                    <IconButton label={`Archive ${faq.question}`} tone="danger" onClick={() => setConfirmDelete(faq.id)} className="h-8 w-8"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></IconButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5">
            <EmptyState icon={<HelpCircle className="h-8 w-8 text-cyan-400" />} title="No FAQs yet"
              description="Add frequently asked questions for your clients."
               action={<Button type="button" variant="brand" onClick={(event) => openNew(event.currentTarget)} className="h-9 rounded-lg text-xs"><Plus className="mr-1.5 h-4 w-4" /> Add FAQ</Button>} />
          </div>
        )}
      </section>

      <Dialog open={showModal} onOpenChange={(open) => { if (!open) resetForm() }}>
        <DialogContent showCloseButton={false} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocusRef.current?.focus(); restoreFocusRef.current = null }} className="w-[calc(100vw-2rem)] max-w-lg p-0">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <div>
                <DialogTitle className="text-base font-black text-slate-950">{editingId ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
                <DialogDescription className="sr-only">Create or update a frequently asked question and answer.</DialogDescription>
              </div>
              <DialogClose asChild><IconButton label="Close FAQ editor" onClick={resetForm}><X className="h-4 w-4" /></IconButton></DialogClose>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="grid gap-4 p-5">
              <div>
                <label htmlFor="faq-question" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Question</label>
                <Input id="faq-question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="How long is the standard venue rental?" className="mt-1 h-11 w-full rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <div>
                <label htmlFor="faq-answer" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Answer</label>
                <Textarea id="faq-answer" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="The standard venue rental is 6 hours..."
                  className="mt-1 w-full min-h-[160px] resize-none rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <Switch aria-label="Hide FAQ from landing page" checked={isHidden} onCheckedChange={setIsHidden} />
                <span className="text-xs font-semibold text-slate-700">Hide from landing page</span>
              </label>
              </div>
            </div>
            <div className="flex shrink-0 gap-2 border-t border-slate-100 bg-white px-5 py-3.5">
              <Button type="button" variant="brand" onClick={handleSave} className="h-11 w-full flex-1 rounded-lg text-xs">
                <Save className="mr-1.5 h-3.5 w-3.5" /> {editingId ? "Save Changes" : "Add FAQ"}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm} className="h-9 rounded-lg border-slate-200 text-xs font-bold"><X className="mr-1.5 h-3.5 w-3.5" /> Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(confirmDelete)} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete FAQ?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmDelete) handleDelete(confirmDelete) }} className="bg-rose-600 text-white hover:bg-rose-700">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
