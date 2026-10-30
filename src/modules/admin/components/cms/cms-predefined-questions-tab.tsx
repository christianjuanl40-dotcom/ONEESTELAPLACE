"use client"

import { useEffect, useMemo, useState } from "react"
import { Eye, EyeOff, MessageCircleQuestion, Pencil, Plus, Save, Trash2, Undo2, X } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Input } from "@shared/components/ui/input"
import { Textarea } from "@shared/components/ui/textarea"
import { Switch } from "@shared/components/ui/switch"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS } from "@admin/contexts/cms-context"
import {
  CHAT_SUGGESTION_STATUS_GROUPS,
  validateChatSuggestionQuestions,
  type ChatSuggestionKind,
  type ChatSuggestionQuestion,
} from "@shared/lib/chat-suggestions"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSStatusBadge, EmptyState } from "./cms-status-badge"

type QuestionForm = Pick<ChatSuggestionQuestion, "question" | "answer" | "statusGroup" | "enabled" | "autoReplyEnabled" | "priority" | "isPublished">

const EMPTY_FORM: QuestionForm = {
  question: "",
  answer: "",
  statusGroup: "no_booking",
  enabled: true,
  autoReplyEnabled: true,
  priority: 10,
  isPublished: false,
}

function cloneQuestions(questions: ChatSuggestionQuestion[]) {
  return questions.map((question) => ({ ...question }))
}

function getStatusLabel(statusGroup: ChatSuggestionKind) {
  return CHAT_SUGGESTION_STATUS_GROUPS.find((group) => group.value === statusGroup)?.label || statusGroup
}

export function CMSPredefinedQuestionsTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const {
    predefinedQuestions,
    predefinedQuestionsRevision,
    predefinedQuestionsConfigured,
    predefinedQuestionsLoading,
    predefinedQuestionsError,
    savePredefinedQuestions,
  } = useCMS()
  const { toast } = useToast()
  const [draft, setDraft] = useState<ChatSuggestionQuestion[]>(() => cloneQuestions(predefinedQuestions))
  const [draftRevision, setDraftRevision] = useState(predefinedQuestionsRevision)
  const [dirty, setDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<QuestionForm>(EMPTY_FORM)
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null)
  const [preview, setPreview] = useState<ChatSuggestionQuestion | null>(null)

  useEffect(() => {
    if (!dirty) {
      setDraft(cloneQuestions(predefinedQuestions))
      setDraftRevision(predefinedQuestionsRevision)
    }
  }, [dirty, predefinedQuestions, predefinedQuestionsRevision])

  const questions = useMemo(() => [...draft].sort((left, right) => (
    left.isArchived === right.isArchived
      ? left.statusGroup.localeCompare(right.statusGroup) || left.priority - right.priority || left.questionId.localeCompare(right.questionId)
      : left.isArchived ? 1 : -1
  )), [draft])
  const activeQuestions = questions.filter((question) => !question.isArchived)
  const publishedCount = activeQuestions.filter((question) => question.enabled && question.isPublished).length
  const archivedCount = questions.length - activeQuestions.length

  const updateQuestion = (questionId: string, update: Partial<ChatSuggestionQuestion>) => {
    setDraft((current) => current.map((question) => question.questionId === questionId ? { ...question, ...update } : question))
    setDirty(true)
  }

  const resetForm = () => {
    setShowModal(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const openNew = () => {
    resetForm()
    setShowModal(true)
  }

  const openEdit = (question: ChatSuggestionQuestion) => {
    setEditingId(question.questionId)
    setForm({
      question: question.question,
      answer: question.answer,
      statusGroup: question.statusGroup,
      enabled: question.enabled,
      autoReplyEnabled: question.autoReplyEnabled,
      priority: question.priority,
      isPublished: question.isPublished,
    })
    setShowModal(true)
  }

  const handleFormSave = () => {
    const questionId = editingId || `chat-question-${crypto.randomUUID()}`
    const existing = draft.find((question) => question.questionId === questionId)
    const nextQuestion: ChatSuggestionQuestion = {
      ...(existing || {
        questionId,
        createdAt: new Date().toISOString(),
      }),
      ...form,
      questionId,
      updatedAt: new Date().toISOString(),
    }
    const nextDraft = editingId
      ? draft.map((question) => question.questionId === editingId ? nextQuestion : question)
      : [...draft, nextQuestion]
    const errors = validateChatSuggestionQuestions(nextDraft)
    if (errors.length > 0) {
      toast({ title: "Review question", description: errors[0], variant: "destructive" })
      return
    }
    setDraft(nextDraft)
    setDirty(true)
    resetForm()
  }

  const handleArchive = (questionId: string) => {
    updateQuestion(questionId, {
      isArchived: true,
      archivedAt: new Date().toISOString(),
      enabled: false,
      isPublished: false,
    })
    setConfirmArchive(null)
  }

  const handleRestore = (questionId: string) => {
    updateQuestion(questionId, { isArchived: false, archivedAt: undefined })
  }

  const handleSave = async () => {
    const errors = validateChatSuggestionQuestions(draft)
    if (errors.length > 0) {
      toast({ title: "Review questions", description: errors[0], variant: "destructive" })
      return
    }
    setIsSaving(true)
    const saved = await savePredefinedQuestions(draft, draftRevision)
    if (saved) setDirty(false)
    setIsSaving(false)
  }

  const handleNavigate = (tab: string) => {
    if (dirty && !window.confirm("You have unsaved predefined question changes. Leave this section and discard them?")) return
    onNavigate(tab)
  }

  return (
    <div>
      <CMSSectionHeader
        title="Predefined Questions & Answers"
        description="Manage status-aware questions and reviewed automated support answers for Client Chat Support."
        currentSection="predefinedQuestions"
        onNavigate={handleNavigate}
        action={(
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <Button type="button" onClick={openNew} className="h-9 rounded-lg bg-orange-600 px-3.5 text-sm font-bold text-white hover:bg-orange-700">
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Question
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={!dirty || isSaving} className="h-9 rounded-lg bg-slate-900 px-3.5 text-sm font-bold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50">
              <Save className="mr-1 h-3.5 w-3.5" /> {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold text-slate-500">{publishedCount} published · {activeQuestions.length} active · {archivedCount} archived</p>
            <p className="mt-0.5 text-xs text-slate-400">Priority 1 appears before priority 2. Only the first three enabled, published questions for a customer status are shown.</p>
          </div>
          {predefinedQuestionsConfigured ? <CMSStatusBadge status="published" /> : <CMSStatusBadge status="needs-review" />}
        </div>

        {!predefinedQuestionsConfigured && !predefinedQuestionsLoading && (
          <div className="mx-4 mt-4 rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-800">
            These starter entries are local defaults and have not been written to Firestore. Review the wording, choose which entries to publish, then select Save Changes.
          </div>
        )}
        {predefinedQuestionsError && (
          <div role="alert" className="mx-4 mt-4 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{predefinedQuestionsError}</div>
        )}

        {predefinedQuestionsLoading ? (
          <div className="p-8 text-center text-sm font-semibold text-slate-500">Loading predefined questions...</div>
        ) : questions.length > 0 ? (
          <div className="space-y-2 p-4">
            {questions.map((question) => (
              <div key={question.questionId} className={`rounded-lg border px-3.5 py-3 transition ${question.isArchived ? "border-slate-100 bg-slate-50 opacity-75" : "border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-700">P{question.priority}</span>
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{getStatusLabel(question.statusGroup)}</span>
                      <CMSStatusBadge status={question.isArchived ? "hidden" : question.isPublished && question.enabled ? "published" : question.enabled ? "draft" : "hidden"} />
                      {question.autoReplyEnabled && !question.isArchived && <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">Auto reply</span>}
                    </div>
                    <h3 className="mt-1.5 text-sm font-bold text-slate-900">{question.question || "Untitled question"}</h3>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{question.answer || "No automatic answer configured."}</p>
                    <p className="mt-1 text-[10px] font-medium text-slate-400">ID: {question.questionId}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-0.5">
                    <button type="button" onClick={() => setPreview(question)} aria-label={`Preview ${question.question}`} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Eye className="h-3.5 w-3.5" /></button>
                    {!question.isArchived && <button type="button" onClick={() => openEdit(question)} aria-label={`Edit ${question.question}`} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>}
                    {!question.isArchived && <button type="button" onClick={() => updateQuestion(question.questionId, { enabled: !question.enabled })} aria-label={`${question.enabled ? "Disable" : "Enable"} ${question.question}`} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700">{question.enabled ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button>}
                    {!question.isArchived && <button type="button" onClick={() => setConfirmArchive(question.questionId)} aria-label={`Archive ${question.question}`} className="flex h-7 w-7 items-center justify-center rounded-md text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>}
                    {question.isArchived && <button type="button" onClick={() => handleRestore(question.questionId)} aria-label={`Restore ${question.question}`} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Undo2 className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
                {!question.isArchived && (
                  <div className="mt-3 flex flex-wrap gap-4 border-t border-slate-100 pt-2.5">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600"><Switch checked={question.isPublished} onCheckedChange={(checked) => updateQuestion(question.questionId, { isPublished: checked })} /> Published</label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600"><Switch checked={question.autoReplyEnabled} onCheckedChange={(checked) => updateQuestion(question.questionId, { autoReplyEnabled: checked })} /> Automatic reply</label>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5"><EmptyState icon={<MessageCircleQuestion className="h-8 w-8 text-orange-400" />} title="No predefined questions yet" description="Add a reviewed question and answer for a customer status group." action={<Button type="button" onClick={openNew} className="h-9 rounded-lg bg-orange-600 text-xs font-bold text-white hover:bg-orange-700"><Plus className="mr-1.5 h-4 w-4" /> Add Question</Button>} /></div>
        )}
      </section>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8">
          <div className="max-h-[calc(100dvh-32px)] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
              <div><h2 className="text-base font-black text-slate-950">{editingId ? "Edit Predefined Question" : "Add Predefined Question"}</h2><p className="mt-0.5 text-xs font-medium text-slate-500">Answers are shown as plain text and never execute HTML or scripts.</p></div>
              <button type="button" onClick={resetForm} aria-label="Close question editor" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid gap-4 p-5">
              <div><label htmlFor="predefined-question" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Question</label><Input id="predefined-question" value={form.question} onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))} placeholder="How do I check my booking status?" className="mt-1 h-11 rounded-lg border-slate-200 text-sm font-semibold" /></div>
              <div><label htmlFor="predefined-answer" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Automated answer</label><Textarea id="predefined-answer" value={form.answer} onChange={(event) => setForm((current) => ({ ...current, answer: event.target.value }))} placeholder="Write a reviewed support answer..." className="mt-1 min-h-[150px] resize-y rounded-lg border-slate-200 text-sm font-semibold" /></div>
              <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                <div><label htmlFor="predefined-status" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Applicable status group</label><select id="predefined-status" value={form.statusGroup} onChange={(event) => setForm((current) => ({ ...current, statusGroup: event.target.value as ChatSuggestionKind }))} className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20">{CHAT_SUGGESTION_STATUS_GROUPS.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select></div>
                <div><label htmlFor="predefined-priority" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Priority</label><Input id="predefined-priority" type="number" min={0} max={9999} step={1} value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: Number(event.target.value) }))} className="mt-1 h-11 rounded-lg border-slate-200 text-sm font-semibold" /></div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700"><Switch checked={form.enabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))} /> Enabled</label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700"><Switch checked={form.autoReplyEnabled} onCheckedChange={(checked) => setForm((current) => ({ ...current, autoReplyEnabled: checked }))} /> Auto reply</label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700"><Switch checked={form.isPublished} onCheckedChange={(checked) => setForm((current) => ({ ...current, isPublished: checked }))} /> Published</label>
              </div>
              {form.autoReplyEnabled && !form.answer.trim() && <p className="text-xs font-semibold text-rose-600">An answer is required while automatic replies are enabled.</p>}
            </div>
            <div className="sticky bottom-0 flex gap-2 border-t border-slate-100 bg-white px-5 py-3.5"><Button type="button" onClick={handleFormSave} className="h-10 flex-1 rounded-lg bg-orange-600 text-xs font-bold text-white hover:bg-orange-700"><Save className="mr-1.5 h-3.5 w-3.5" /> {editingId ? "Apply Changes" : "Add Question"}</Button><Button type="button" variant="outline" onClick={resetForm} className="h-10 rounded-lg border-slate-200 text-xs font-bold"><X className="mr-1.5 h-3.5 w-3.5" /> Cancel</Button></div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5"><div><h2 className="text-base font-black text-slate-950">Customer Preview</h2><p className="text-xs font-medium text-slate-500">{getStatusLabel(preview.statusGroup)}</p></div><button type="button" onClick={() => setPreview(null)} aria-label="Close preview" className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
            <div className="space-y-4 p-5"><div><p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Customer question</p><div className="rounded-2xl rounded-tr-sm bg-orange-600 px-4 py-3 text-sm font-medium text-white">{preview.question}</div></div><div><p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">One Estela Place Support {preview.autoReplyEnabled ? "· Automated reply" : "· Automatic reply disabled"}</p><div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium leading-6 text-slate-700">{preview.answer || "No answer configured."}</div></div></div>
            <div className="border-t border-slate-100 px-5 py-3.5 text-right"><Button type="button" variant="outline" onClick={() => setPreview(null)} className="h-9 rounded-lg border-slate-200 text-xs font-bold">Close</Button></div>
          </div>
        </div>
      )}

      {confirmArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div className="w-full max-w-xs rounded-xl border border-slate-200 bg-white p-5 shadow-xl"><h3 className="text-base font-black text-slate-900">Archive question?</h3><p className="mt-1 text-sm font-semibold text-slate-500">The stable ID and history will be retained, but it will not be shown to customers after you save.</p><div className="mt-4 flex gap-2"><Button type="button" variant="outline" onClick={() => setConfirmArchive(null)} className="h-9 flex-1 rounded-lg border-slate-200 text-xs font-bold">Cancel</Button><Button type="button" onClick={() => handleArchive(confirmArchive)} className="h-9 flex-1 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700"><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Archive</Button></div></div></div>
      )}
    </div>
  )
}
