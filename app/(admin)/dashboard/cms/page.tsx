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
