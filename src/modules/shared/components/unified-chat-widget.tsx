"use client"

import { ClientChatWidget } from "./chat-widget"

/**
 * Public pages retain this compatibility export while using the same secure
 * customer chat surface as the authenticated portal. Legacy client-created
 * quick replies are intentionally not supported.
 */
export function UnifiedChatWidget() {
  return <ClientChatWidget />
}
