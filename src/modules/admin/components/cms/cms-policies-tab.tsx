"use client"

import { useState } from "react"
import { BookOpen, ChevronDown, Eye, EyeOff, Pencil, RotateCcw, Save, X, FileText, Building2 } from "lucide-react"
import { Button } from "@shared/components/ui/button"
import { Textarea } from "@shared/components/ui/textarea"
import { Switch } from "@shared/components/ui/switch"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@shared/components/ui/tabs"
import { useToast } from "@shared/hooks/use-toast"
import { useCMS, type Policy, type PolicyType } from "@admin/contexts/cms-context"
import { CMSSectionHeader } from "./cms-section-header"
import { CMSStatusBadge } from "./cms-status-badge"
import { POLICY_LABELS, DEFAULT_POLICY_CONTENT, ALL_POLICY_KEYS } from "@/src/modules/shared/lib/policies"

export function CMSPoliciesTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { cmsData, updatePolicy, saveCMSData } = useCMS()
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [contractTab, setContractTab] = useState("event-venue")

  const policies = ALL_POLICY_KEYS.filter(k => k !== "contractSigningEV" && k !== "contractSigningOR").map((key) => {
    const existing = cmsData.policies.find((p: Policy) => p.type === key)
    return existing || {
      id: key,
      title: POLICY_LABELS[key],
      content: DEFAULT_POLICY_CONTENT[key],
      type: key,
      isPublished: true,
      createdAt: new Date().toISOString(),
    }
  })

  const openEdit = (p: Policy) => {
    setEditingId(p.id)
    setEditContent(p.content)
    setExpandedId(p.id)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditContent("")
  }

  const handleSave = (p: Policy) => {
    if (!editContent.trim()) {
      toast({ title: "Content required", description: "Policy content cannot be empty.", variant: "destructive" })
      return
    }
    if (cmsData.policies.find((x: Policy) => x.id === p.id)) {
      updatePolicy(p.id, { content: editContent.trim(), updatedAt: new Date().toISOString() })
    } else {
      saveCMSData({
        ...cmsData,
        policies: [...cmsData.policies, { ...p, content: editContent.trim(), updatedAt: new Date().toISOString() }],
      })
    }
    toast({ title: "Policy updated", description: `${p.title} has been saved successfully.`, className: "bg-emerald-500 text-white border-none" })
    setEditingId(null)
    setEditContent("")
  }

  const handleReset = (p: Policy) => {
    const defaultContent = DEFAULT_POLICY_CONTENT[p.type]
    if (cmsData.policies.find((x: Policy) => x.id === p.id)) {
      updatePolicy(p.id, { content: defaultContent, updatedAt: new Date().toISOString() })
    } else {
      saveCMSData({
        ...cmsData,
        policies: [...cmsData.policies, { ...p, content: defaultContent, updatedAt: new Date().toISOString() }],
      })
    }
    if (editingId === p.id) {
      setEditContent(defaultContent)
    }
    toast({ title: "Policy reset", description: `${p.title} restored to default booking policy.`, className: "bg-emerald-500 text-white border-none" })
  }

  const getOrCreateContractPolicy = (type: PolicyType): Policy => {
    const existing = cmsData.policies.find((p: Policy) => p.type === type)
    return existing || {
      id: type,
      title: POLICY_LABELS[type],
      content: DEFAULT_POLICY_CONTENT[type],
      type,
      isPublished: true,
      createdAt: new Date().toISOString(),
    } as Policy
  }

  const handleContractSave = (type: PolicyType, content: string) => {
    if (!content.trim()) return
    const existing = cmsData.policies.find((p: Policy) => p.type === type)
    if (existing) {
      updatePolicy(existing.id, { content: content.trim(), updatedAt: new Date().toISOString() })
    } else {
      saveCMSData({
        ...cmsData,
        policies: [...cmsData.policies, { id: type, title: POLICY_LABELS[type], content: content.trim(), type, isPublished: true, createdAt: new Date().toISOString() } as Policy],
      })
    }
    toast({ title: "Contract saved", description: `${POLICY_LABELS[type]} has been updated.`, className: "bg-emerald-500 text-white border-none" })
  }

  const evContract = getOrCreateContractPolicy("contractSigningEV")
  const orContract = getOrCreateContractPolicy("contractSigningOR")

  return (
    <div>
      <CMSSectionHeader title="Terms &amp; Policies" description="Manage event venue terms, office space terms, cancellation, refund, payment policies, and contract information."
        currentSection="policies" onNavigate={onNavigate} />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-3">
          <p className="text-[11px] font-semibold text-slate-500">
            Contract Information
          </p>
        </div>
        <div className="p-6">
          <Tabs value={contractTab} onValueChange={setContractTab}>
            <TabsList className="mb-4 bg-slate-100">
              <TabsTrigger value="event-venue" className="text-xs font-bold data-[state=active]:bg-white">
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                Event Venue Contract
              </TabsTrigger>
              <TabsTrigger value="office-rental" className="text-xs font-bold data-[state=active]:bg-white">
                <Building2 className="mr-1.5 h-3.5 w-3.5" />
                Office Rental Contract
              </TabsTrigger>
            </TabsList>
            <TabsContent value="event-venue" className="space-y-3">
              <Textarea
                value={evContract.content}
                onChange={(e) => {
                  const updated = { ...evContract, content: e.target.value }
                  const idx = cmsData.policies.findIndex((p: Policy) => p.type === "contractSigningEV")
                  if (idx >= 0) {
                    updatePolicy(cmsData.policies[idx].id, { content: e.target.value, updatedAt: new Date().toISOString() })
                  } else {
                    saveCMSData({
                      ...cmsData,
                      policies: [...cmsData.policies, { id: "contractSigningEV", title: POLICY_LABELS.contractSigningEV, content: e.target.value, type: "contractSigningEV", isPublished: true, createdAt: new Date().toISOString() }],
                    })
                  }
                }}
                className="w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold leading-relaxed"
                placeholder="Event venue contract details, requirements, reminders, and download instructions..."
              />
              <div className="flex items-center gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => handleReset(evContract)}
                  className="h-9 rounded-lg border-slate-200 px-4 text-xs font-bold">
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to Default
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="office-rental" className="space-y-3">
              <Textarea
                value={orContract.content}
                onChange={(e) => {
                  const idx = cmsData.policies.findIndex((p: Policy) => p.type === "contractSigningOR")
                  if (idx >= 0) {
                    updatePolicy(cmsData.policies[idx].id, { content: e.target.value, updatedAt: new Date().toISOString() })
                  } else {
                    saveCMSData({
                      ...cmsData,
                      policies: [...cmsData.policies, { id: "contractSigningOR", title: POLICY_LABELS.contractSigningOR, content: e.target.value, type: "contractSigningOR", isPublished: true, createdAt: new Date().toISOString() }],
                    })
                  }
                }}
                className="w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold leading-relaxed"
                placeholder="Office rental contract details, requirements, rental terms, reminders, and download instructions..."
              />
              <div className="flex items-center gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => handleReset(orContract)}
                  className="h-9 rounded-lg border-slate-200 px-4 text-xs font-bold">
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to Default
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-3">
          <p className="text-[11px] font-semibold text-slate-500">
            {policies.length} policy sections · These policies are shown to customers during the booking process.
          </p>
        </div>
        {policies.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {policies.map((policy) => {
              const isEditing = editingId === policy.id
              const isExpanded = expandedId === policy.id
              const isDefault = DEFAULT_POLICY_CONTENT[policy.type] === policy.content

              return (
                <div key={policy.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : policy.id)}
                    className="flex w-full items-center justify-between gap-3 px-6 py-3.5 text-left transition hover:bg-slate-50/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <BookOpen className="h-4 w-4 shrink-0 text-amber-500" />
                      <span className="text-sm font-bold text-slate-900">{POLICY_LABELS[policy.type] || policy.title}</span>
                      <CMSStatusBadge status={policy.isPublished ? "published" : "hidden"} />
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openEdit(policy) }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); updatePolicy(policy.id, { isPublished: !policy.isPublished }) }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        {policy.isPublished ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <ChevronDown className={`h-4 w-4 text-slate-400 transition ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-6 pb-4">
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                        {isEditing ? (
                          <div className="space-y-3">
                            <Textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              className="w-full min-h-[80px] resize-none rounded-lg border-slate-200 text-sm font-semibold leading-relaxed"
                            />
                            <div className="flex items-center gap-2">
                              <Button type="button" onClick={() => handleSave(policy)}
                                className="w-full sm:w-auto h-11 rounded-lg bg-amber-600 px-4 text-xs font-bold text-white hover:bg-amber-700">
                                <Save className="mr-1.5 h-3.5 w-3.5" /> Save Changes
                              </Button>
                              <Button type="button" variant="outline" onClick={cancelEdit}
                                className="h-9 rounded-lg border-slate-200 px-4 text-xs font-bold">
                                <X className="mr-1.5 h-3.5 w-3.5" /> Cancel
                              </Button>
                              {!isDefault && (
                                <Button type="button" variant="outline" onClick={() => handleReset(policy)}
                                  className="h-9 rounded-lg border-slate-200 px-4 text-xs font-bold text-slate-500">
                                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to Default
                                </Button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <pre className="whitespace-pre-wrap text-sm font-semibold leading-relaxed text-slate-700 font-sans">
                              {policy.content}
                            </pre>
                            {!isDefault && (
                              <p className="text-[11px] font-semibold text-amber-600">
                                This policy has been modified from the default. Click edit to view or restore the original.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="p-6 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-500">No policy data available.</p>
          </div>
        )}
      </section>
    </div>
  )
}
