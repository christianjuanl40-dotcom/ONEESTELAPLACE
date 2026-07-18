"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/src/modules/shared/auth/auth-context"
import { CMSHomepageTab } from "@admin/components/cms/cms-homepage-tab"
import { CMSVenuesTab } from "@admin/components/cms/cms-venues-tab"
import { CMSOfficesTab } from "@admin/components/cms/cms-offices-tab"
import { CMSFaqsTab } from "@admin/components/cms/cms-faqs-tab"
import { CMSPoliciesTab } from "@admin/components/cms/cms-policies-tab"
import { CMSPastClientsTab } from "@admin/components/cms/cms-past-clients-tab"
import { CMSContractsTab } from "@admin/components/cms/cms-contracts-tab"
import { CMSPaymentTab } from "@admin/components/cms/cms-payment-tab"

export default function CMSPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState("homepage")

  useEffect(() => {
    if (user && user.role === "staff" && !user.permissions?.cms) {
      router.replace("/dashboard")
    }
  }, [user, router])

  return (
    <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
      <div className="mb-7 border-b border-slate-200 pb-6">
        <p className="inline-flex items-center gap-1.5 rounded-md bg-orange-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-orange-700">
          Admin CMS Settings
        </p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
          CMS Settings
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-slate-500 max-w-2xl">
          Manage landing page content, event venues, office spaces, 360 virtual tours,
          past client gallery, FAQs, and policies.
        </p>
      </div>

      <div>
        {activeTab === "homepage" && <CMSHomepageTab onNavigate={setActiveTab} />}
        {activeTab === "venues" && <CMSVenuesTab onNavigate={setActiveTab} />}
        {activeTab === "offices" && <CMSOfficesTab onNavigate={setActiveTab} />}
        {activeTab === "faqs" && <CMSFaqsTab onNavigate={setActiveTab} />}
        {activeTab === "policies" && <CMSPoliciesTab onNavigate={setActiveTab} />}
        {activeTab === "pastClients" && <CMSPastClientsTab onNavigate={setActiveTab} />}
        {activeTab === "contracts" && <CMSContractsTab onNavigate={setActiveTab} />}
        {activeTab === "payment" && <CMSPaymentTab onNavigate={setActiveTab} />}
      </div>
    </div>
  )
}
