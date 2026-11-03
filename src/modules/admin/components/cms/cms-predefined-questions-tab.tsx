"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@shared/components/ui/dialog"
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
import { EmptyState } from "./cms-status-badge"

type QuestionForm = Pick<ChatSuggestionQuestion, "question" | "answer" | "statusGroup" | "enabled" | "autoReplyEnabled" | "priority" | "isPublished">
type PublicationStatus = "draft" | "published" | "disabled" | "archived"
type StatusFilter = "all" | PublicationStatus
type CategoryFilter = "all" | ChatSuggestionKind
type SaveFeedback = { type: "success" | "error"; message: string } | null

const EMPTY_FORM: QuestionForm = {
  question: "",
  answer: "",
  statusGroup: "no_booking",
  enabled: true,
  autoReplyEnabled: true,
  priority: 10,
  isPublished: false,
}

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "disabled", label: "Disabled" },
  { value: "archived", label: "Archived" },
]

const STATUS_STYLES: Record<PublicationStatus, string> = {
  draft: "border-amber-100 bg-amber-50 text-amber-700",
  published: "border-emerald-100 bg-emerald-50 text-emerald-700",
  disabled: "border-slate-200 bg-slate-100 text-slate-600",
  archived: "border-slate-200 bg-slate-100 text-slate-500",
}

const STATUS_GROUP_ORDER = new Map(
  CHAT_SUGGESTION_STATUS_GROUPS.map((group, index) => [group.value, index]),
)

function cloneQuestions(questions: ChatSuggestionQuestion[]) {
  return questions.map((question) => ({ ...question }))
}

function getStatusLabel(statusGroup: ChatSuggestionKind) {
  return CHAT_SUGGESTION_STATUS_GROUPS.find((group) => group.value === statusGroup)?.label || statusGroup
}

function getPublicationStatus(question: ChatSuggestionQuestion): PublicationStatus {
  if (question.isArchived) return "archived"
  if (!question.enabled) return "disabled"
  return question.isPublished ? "published" : "draft"
}

function getOrdinal(value: number) {
  const remainder = value % 100
  if (remainder >= 11 && remainder <= 13) return `${value}th`
  switch (value % 10) {
    case 1: return `${value}st`
    case 2: return `${value}nd`
    case 3: return `${value}rd`
    default: return `${value}th`
  }
}

function sortByCategoryOrder(left: ChatSuggestionQuestion, right: ChatSuggestionQuestion) {
  return (
    (STATUS_GROUP_ORDER.get(left.statusGroup) ?? 0) - (STATUS_GROUP_ORDER.get(right.statusGroup) ?? 0)
    || left.priority - right.priority
    || left.questionId.localeCompare(right.questionId)
  )
}

function getDisplayOrder(question: ChatSuggestionQuestion, questions: ChatSuggestionQuestion[]) {
  if (question.isArchived) return null
  const categoryQuestions = questions
    .filter((candidate) => !candidate.isArchived && candidate.statusGroup === question.statusGroup)
    .sort(sortByCategoryOrder)
  const index = categoryQuestions.findIndex((candidate) => candidate.questionId === question.questionId)
  return index >= 0 ? index + 1 : null
}

function PublicationStatusBadge({ status }: { status: PublicationStatus }) {
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-bold leading-tight ${STATUS_STYLES[status]}`}>
      {STATUS_FILTERS.find((option) => option.value === status)?.label}
    </span>
  )
}

const iconButtonClass = "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"

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
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<QuestionForm>(EMPTY_FORM)
  const [formDirty, setFormDirty] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<string | null>(null)
  const [preview, setPreview] = useState<ChatSuggestionQuestion | null>(null)
  const [expandedAnswers, setExpandedAnswers] = useState<Set<string>>(() => new Set())
  const [searchQuery, setSearchQuery] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  useEffect(() => {
    if (!dirty) {
      setDraft(cloneQuestions(predefinedQuestions))
      setDraftRevision(predefinedQuestionsRevision)
    }
  }, [dirty, predefinedQuestions, predefinedQuestionsRevision])

  useEffect(() => {
    if (!dirty && !formDirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [dirty, formDirty])

  const questions = useMemo(() => [...draft].sort((left, right) => {
    if (left.isArchived !== right.isArchived) return left.isArchived ? 1 : -1
    return sortByCategoryOrder(left, right)
  }), [draft])

  const filteredQuestions = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase()
    return questions.filter((question) => {
      const matchesSearch = !normalizedSearch
        || question.question.toLocaleLowerCase().includes(normalizedSearch)
        || question.answer.toLocaleLowerCase().includes(normalizedSearch)
      const matchesCategory = categoryFilter === "all" || question.statusGroup === categoryFilter
      const matchesStatus = statusFilter === "all" || getPublicationStatus(question) === statusFilter
      return matchesSearch && matchesCategory && matchesStatus
    })
  }, [categoryFilter, questions, searchQuery, statusFilter])

  const persistedQuestionIds = useMemo(() => new Set(
    predefinedQuestionsConfigured ? predefinedQuestions.map((question) => question.questionId) : [],
  ), [predefinedQuestions, predefinedQuestionsConfigured])

  const hasFilters = Boolean(searchQuery.trim() || categoryFilter !== "all" || statusFilter !== "all")

  const markDirty = () => {
    setDirty(true)
    setSaveFeedback(null)
  }

  const updateQuestion = (questionId: string, update: Partial<ChatSuggestionQuestion>) => {
    setDraft((current) => current.map((question) => question.questionId === questionId ? { ...question, ...update } : question))
    markDirty()
  }

  const updateForm = (update: Partial<QuestionForm>) => {
    setForm((current) => ({ ...current, ...update }))
    setFormDirty(true)
  }

  const clearForm = () => {
    setShowModal(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormDirty(false)
  }

  const closeEditor = () => {
    if (formDirty && !window.confirm("You have unapplied question edits. Close the editor and discard them?")) return false
    clearForm()
    return true
  }

  const openNew = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setFormDirty(false)
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
    setFormDirty(false)
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
      setSaveFeedback({ type: "error", message: errors[0] })
      toast({ title: "Review question", description: errors[0], variant: "destructive" })
      return
    }
    setDraft(nextDraft)
    markDirty()
    clearForm()
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

  const handleDelete = (question: ChatSuggestionQuestion) => {
    if (!window.confirm(`Delete the unsaved question “${question.question}”?`)) return
    setDraft((current) => current.filter((candidate) => candidate.questionId !== question.questionId))
    setExpandedAnswers((current) => {
      const next = new Set(current)
      next.delete(question.questionId)
      return next
    })
    if (preview?.questionId === question.questionId) setPreview(null)
    markDirty()
  }

  const handleSave = async () => {
    const errors = validateChatSuggestionQuestions(draft)
    if (errors.length > 0) {
      setSaveFeedback({ type: "error", message: errors[0] })
      toast({ title: "Review questions", description: errors[0], variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const saved = await savePredefinedQuestions(draft, draftRevision)
      if (saved) {
        setDirty(false)
        setSaveFeedback({ type: "success", message: "Changes saved to Firestore. Customer chat will use the published entries after review." })
      } else {
        setSaveFeedback({ type: "error", message: "Changes were not saved. Review the error message and try again." })
      }
    } catch {
      setSaveFeedback({ type: "error", message: "Changes were not saved. Please try again." })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDiscard = () => {
    if (!window.confirm("Discard all unsaved predefined question changes and reload the latest saved configuration?")) return
    setDraft(cloneQuestions(predefinedQuestions))
    setDraftRevision(predefinedQuestionsRevision)
    setDirty(false)
    setSaveFeedback(null)
    setExpandedAnswers(new Set())
    if (formDirty) clearForm()
  }

  const handleNavigate = (tab: string) => {
    if ((dirty || formDirty) && !window.confirm("You have unsaved predefined question changes. Leave this section and discard them?")) return
    onNavigate(tab)
  }

  const clearFilters = () => {
    setSearchQuery("")
    setCategoryFilter("all")
    setStatusFilter("all")
  }

  const toggleAnswer = (questionId: string) => {
    setExpandedAnswers((current) => {
      const next = new Set(current)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
  }

  return (
    <div>
      <CMSSectionHeader
        title=""
        currentSection="predefinedQuestions"
        onNavigate={handleNavigate}
        compact
        action={(
          <div className="flex w-full shrink-0 flex-wrap justify-end gap-2 sm:w-auto">
            {dirty && <span role="status" className="inline-flex h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-2.5 text-xs font-bold text-amber-800">Unsaved changes</span>}
            {dirty && <Button type="button" variant="outline" onClick={handleDiscard} className="h-9 rounded-lg border-slate-200 px-2.5 text-xs font-bold text-slate-600">Discard draft</Button>}
            <Button type="button" onClick={openNew} className="h-9 rounded-lg bg-orange-600 px-3.5 text-sm font-bold text-white hover:bg-orange-700">
              <Plus className="mr-1 h-3.5 w-3.5" /> Add Question
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={!dirty || isSaving} className="h-9 rounded-lg bg-slate-900 px-3.5 text-sm font-bold text-white hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50">
              {isSaving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        )}
      />

      <section aria-label="Predefined Questions & Answers" className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
          {saveFeedback && (
            <div role={saveFeedback.type === "error" ? "alert" : "status"} className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs font-semibold leading-5 ${saveFeedback.type === "error" ? "border-rose-100 bg-rose-50 text-rose-700" : "border-emerald-100 bg-emerald-50 text-emerald-700"}`}>
              {saveFeedback.type === "error" ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{saveFeedback.message}</span>
            </div>
          )}
          {predefinedQuestionsError && (
            <div role="alert" className="mb-3 rounded-lg border border-rose-100 bg-rose-50 p-3 text-xs font-semibold text-rose-700">{predefinedQuestionsError}</div>
          )}
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)_minmax(180px,0.45fr)_auto] md:items-center">
            <label className="relative block">
              <span className="sr-only">Search Questions</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search Questions" className="h-10 rounded-lg border-slate-200 pl-9 text-sm font-semibold placeholder:text-slate-400" />
            </label>
            <label>
              <span className="sr-only">Category Filter</span>
              <select aria-label="Category Filter" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20">
                <option value="all">All categories</option>
                {CHAT_SUGGESTION_STATUS_GROUPS.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Publication Status Filter</span>
              <select aria-label="Publication Status Filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20">
                {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {hasFilters ? (
              <Button type="button" variant="outline" onClick={clearFilters} className="h-10 rounded-lg border-slate-200 px-3 text-xs font-bold text-slate-600">Clear filters</Button>
            ) : <span className="hidden md:block" aria-hidden="true" />}
          </div>
        </div>

        {predefinedQuestionsLoading ? (
          <div className="p-8 text-center text-sm font-semibold text-slate-500">Loading predefined questions...</div>
        ) : filteredQuestions.length > 0 ? (
          <div>
            <div className="hidden border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(150px,0.8fr)_110px_108px_auto] lg:gap-3 sm:px-5">
              <span>Question</span>
              <span>Category</span>
              <span>Publication</span>
              <span>Display order</span>
              <span className="text-right">Actions</span>
            </div>
            <div className="divide-y divide-slate-100">
              {filteredQuestions.map((question) => {
                const publicationStatus = getPublicationStatus(question)
                const displayOrder = getDisplayOrder(question, draft)
                const answerExpanded = expandedAnswers.has(question.questionId)
                const canDelete = !persistedQuestionIds.has(question.questionId)
                return (
                  <article key={question.questionId} className={`px-3 py-3 sm:px-5 ${question.isArchived ? "bg-slate-50/70" : "bg-white"}`}>
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(150px,0.8fr)_110px_108px_auto] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-start gap-2">
                          <button type="button" onClick={() => toggleAnswer(question.questionId)} aria-expanded={answerExpanded} aria-controls={`answer-${question.questionId}`} className={`${iconButtonClass} mt-[-2px]`} title={answerExpanded ? "Hide answer" : "Show answer"}>
                            {answerExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            <span className="sr-only">{answerExpanded ? "Hide answer" : "Show answer"}</span>
                          </button>
                          <div className="min-w-0 flex-1">
                            <h3 className={`break-words text-sm font-bold ${question.isArchived ? "text-slate-500" : "text-slate-900"}`}>{question.question || "Untitled question"}</h3>
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-slate-400">
                              <button type="button" onClick={() => toggleAnswer(question.questionId)} aria-expanded={answerExpanded} aria-controls={`answer-${question.questionId}`} className="text-orange-700 hover:text-orange-800">{answerExpanded ? "Hide answer" : "Show answer"}</button>
                              <span aria-hidden="true">·</span>
                              <span>{question.autoReplyEnabled ? "Automated reply on" : "Automatic reply disabled"}</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-600">
                        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 lg:hidden">Category</span>
                        <span className="max-w-full truncate rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{getStatusLabel(question.statusGroup)}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 lg:hidden">Publication</span>
                        <PublicationStatusBadge status={publicationStatus} />
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 lg:hidden">Order</span>
                        <span className="text-xs font-bold tabular-nums text-slate-700">{displayOrder ? `Display order: ${getOrdinal(displayOrder)}` : "—"}</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1 lg:justify-end">
                        <button type="button" onClick={() => setPreview(question)} aria-label={`Preview ${question.question}`} title="Preview customer chat" className={iconButtonClass}><Eye className="h-4 w-4" /></button>
                        {!question.isArchived && <button type="button" onClick={() => openEdit(question)} aria-label={`Edit ${question.question}`} title="Edit question" className={iconButtonClass}><Pencil className="h-4 w-4" /></button>}
                        {!question.isArchived && <button type="button" onClick={() => updateQuestion(question.questionId, { enabled: !question.enabled })} aria-label={`${question.enabled ? "Disable" : "Enable"} ${question.question}`} title={question.enabled ? "Disable question" : "Enable question"} className={iconButtonClass}>{question.enabled ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>}
                        {!question.isArchived && <button type="button" onClick={() => setConfirmArchive(question.questionId)} aria-label={`Archive ${question.question}`} title="Archive question" className={`${iconButtonClass} text-rose-400 hover:bg-rose-50 hover:text-rose-600`}><Archive className="h-4 w-4" /></button>}
                        {!question.isArchived && canDelete && <button type="button" onClick={() => handleDelete(question)} aria-label={`Delete ${question.question}`} title="Delete unsaved question" className={`${iconButtonClass} text-rose-400 hover:bg-rose-50 hover:text-rose-600`}><Trash2 className="h-4 w-4" /></button>}
                        {question.isArchived && <button type="button" onClick={() => handleRestore(question.questionId)} aria-label={`Restore ${question.question}`} title="Restore question" className={iconButtonClass}><Undo2 className="h-4 w-4" /></button>}
                      </div>
                    </div>

                    {answerExpanded && (
                      <div id={`answer-${question.questionId}`} className="ml-10 mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:ml-10 sm:p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Corresponding automated answer</p>
                          <span className={`rounded-md border px-2 py-1 text-[10px] font-bold ${question.autoReplyEnabled ? "border-blue-100 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500"}`}>
                            {question.autoReplyEnabled ? "Automated Support" : "Automatic reply disabled"}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm font-medium leading-6 text-slate-700">{question.answer || "No automatic answer configured."}</p>
                        {!question.isArchived && (
                          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-200 pt-3">
                            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600"><Switch checked={question.isPublished} onCheckedChange={(checked) => updateQuestion(question.questionId, { isPublished: checked })} /> Publish to customer chat</label>
                            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600"><Switch checked={question.autoReplyEnabled} onCheckedChange={(checked) => updateQuestion(question.questionId, { autoReplyEnabled: checked })} /> Automatic reply</label>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </div>
        ) : questions.length > 0 ? (
          <div className="p-5"><EmptyState icon={<Search className="h-8 w-8 text-orange-400" />} title="No questions match these filters" description="Try a different search, category, or publication status." action={<Button type="button" onClick={clearFilters} className="h-9 rounded-lg bg-orange-600 text-xs font-bold text-white hover:bg-orange-700">Clear filters</Button>} /></div>
        ) : (
          <div className="p-5"><EmptyState icon={<MessageCircleQuestion className="h-8 w-8 text-orange-400" />} title="No predefined questions yet" description="Add a reviewed question and answer for a customer status group." action={<Button type="button" onClick={openNew} className="h-9 rounded-lg bg-orange-600 text-xs font-bold text-white hover:bg-orange-700"><Plus className="mr-1.5 h-4 w-4" /> Add Question</Button>} /></div>
        )}
      </section>

      <Dialog open={showModal} onOpenChange={(open) => { if (open) setShowModal(true); else closeEditor() }}>
        <DialogContent showCloseButton={false} className="max-w-2xl p-0">
          <DialogHeader className="shrink-0 flex-row items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 text-left">
            <div className="min-w-0">
              <DialogTitle className="text-base font-black text-slate-950">{editingId ? "Edit Predefined Question" : "Add Predefined Question"}</DialogTitle>
              <DialogDescription className="mt-1 text-xs font-medium leading-5 text-slate-500">Answers are shown as plain text and never execute HTML or scripts.</DialogDescription>
            </div>
            <button type="button" onClick={() => closeEditor()} aria-label="Close question editor" className={iconButtonClass}><X className="h-4 w-4" /></button>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="grid gap-4">
              <div>
                <label htmlFor="predefined-question" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Question</label>
                <Input id="predefined-question" value={form.question} onChange={(event) => updateForm({ question: event.target.value })} placeholder="How do I check my booking status?" className="mt-1 h-11 rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <div>
                <label htmlFor="predefined-answer" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Automated answer</label>
                <Textarea id="predefined-answer" value={form.answer} onChange={(event) => updateForm({ answer: event.target.value })} placeholder="Write a reviewed support answer..." className="mt-1 min-h-[150px] resize-y rounded-lg border-slate-200 text-sm font-semibold" />
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_170px]">
                <div>
                  <label htmlFor="predefined-status" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Category</label>
                  <select id="predefined-status" value={form.statusGroup} onChange={(event) => updateForm({ statusGroup: event.target.value as ChatSuggestionKind })} className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20">{CHAT_SUGGESTION_STATUS_GROUPS.map((group) => <option key={group.value} value={group.value}>{group.label}</option>)}</select>
                </div>
                <div>
                  <label htmlFor="predefined-priority" className="text-[10px] font-black uppercase tracking-[0.2em] text-black sm:text-xs">Display order</label>
                  <Input id="predefined-priority" type="number" min={0} max={9999} step={1} value={form.priority} onChange={(event) => updateForm({ priority: Number(event.target.value) })} className="mt-1 h-11 rounded-lg border-slate-200 text-sm font-semibold" />
                  <p className="mt-1 text-[11px] font-medium leading-4 text-slate-500">Lower values appear first within this category.</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700"><Switch checked={form.enabled} onCheckedChange={(checked) => updateForm({ enabled: checked })} /> Enabled</label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700"><Switch checked={form.autoReplyEnabled} onCheckedChange={(checked) => updateForm({ autoReplyEnabled: checked })} /> Auto reply</label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-700"><Switch checked={form.isPublished} onCheckedChange={(checked) => updateForm({ isPublished: checked })} /> Published</label>
              </div>
              <div className="rounded-lg border border-orange-100 bg-orange-50/70 p-3 text-xs font-semibold leading-5 text-orange-900">
                <p className="font-black">Administrator review required</p>
                <p className="mt-0.5">Keep Published off while reviewing. Saving a published entry makes it eligible for the customer&apos;s status-specific chat suggestions.</p>
              </div>
              {form.autoReplyEnabled && !form.answer.trim() && <p className="text-xs font-semibold text-rose-600">An answer is required while automatic replies are enabled.</p>}
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 border-t border-slate-100 bg-white px-5 py-3.5 sm:flex-row">
            <Button type="button" onClick={handleFormSave} className="h-10 flex-1 rounded-lg bg-orange-600 text-xs font-bold text-white hover:bg-orange-700"><Save className="mr-1.5 h-3.5 w-3.5" /> {editingId ? "Apply Changes" : "Add Question"}</Button>
            <Button type="button" variant="outline" onClick={() => closeEditor()} className="h-10 rounded-lg border-slate-200 text-xs font-bold"><X className="mr-1.5 h-3.5 w-3.5" /> Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null) }}>
        <DialogContent showCloseButton={false} className="max-w-lg p-0">
          <DialogHeader className="shrink-0 flex-row items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 text-left">
            <div className="min-w-0">
              <DialogTitle className="text-base font-black text-slate-950">Customer Chat Preview</DialogTitle>
              <DialogDescription className="mt-1 text-xs font-medium leading-5 text-slate-500">Preview only. Nothing will be sent and chat history will not change.</DialogDescription>
            </div>
            <button type="button" onClick={() => setPreview(null)} aria-label="Close preview" className={iconButtonClass}><X className="h-4 w-4" /></button>
          </DialogHeader>
          {preview && (
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Selected predefined question</p>
                    <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{getStatusLabel(preview.statusGroup)}</span>
                  </div>
                  <div className="ml-auto max-w-[92%] rounded-2xl rounded-tr-sm bg-orange-600 px-4 py-3 text-sm font-medium leading-6 text-white">{preview.question}</div>
                </div>
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Corresponding automated answer</p>
                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold ${preview.autoReplyEnabled ? "border-blue-100 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-100 text-slate-500"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${preview.autoReplyEnabled ? "bg-blue-500" : "bg-slate-400"}`} />
                      Automated Support{preview.autoReplyEnabled ? "" : " · Disabled"}
                    </span>
                  </div>
                  <div className="max-w-[92%] rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium leading-6 text-slate-700">
                    {preview.answer || "No automatic answer configured."}
                  </div>
                </div>
                <div className="rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-xs font-semibold leading-5 text-blue-800">
                  This is a non-interactive preview. It does not send a message, trigger an automated reply, or modify customer chat history.
                </div>
              </div>
            </div>
          )}
          <div className="flex shrink-0 justify-end border-t border-slate-100 px-5 py-3.5">
            <Button type="button" variant="outline" onClick={() => setPreview(null)} className="h-9 rounded-lg border-slate-200 text-xs font-bold">Close</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmArchive)} onOpenChange={(open) => { if (!open) setConfirmArchive(null) }}>
        <DialogContent showCloseButton={false} className="max-w-md p-0">
          <DialogHeader className="shrink-0 border-b border-slate-100 px-5 py-4 text-left">
            <DialogTitle className="text-base font-black text-slate-900">Archive question?</DialogTitle>
            <DialogDescription className="mt-1 text-sm font-semibold leading-5 text-slate-500">The stable ID and history will be retained, but this question will not be shown to customers after you save.</DialogDescription>
          </DialogHeader>
          <div className="flex shrink-0 flex-col-reverse gap-2 px-5 py-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setConfirmArchive(null)} className="h-9 rounded-lg border-slate-200 text-xs font-bold">Cancel</Button>
            <Button type="button" onClick={() => { if (confirmArchive) handleArchive(confirmArchive) }} className="h-9 rounded-lg bg-rose-600 text-xs font-bold text-white hover:bg-rose-700"><Archive className="mr-1.5 h-3.5 w-3.5" /> Archive</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
