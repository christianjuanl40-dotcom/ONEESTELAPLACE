"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"

export const CHAT_SCROLL_THRESHOLD = 96

export function isChatNearBottom(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
  threshold = CHAT_SCROLL_THRESHOLD,
): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
}

export function useChatScroll(itemCount: number, conversationKey: string | null) {
  const containerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const shouldStickToBottom = useRef(true)
  const previousItemCount = useRef(itemCount)
  const previousConversation = useRef(conversationKey)
  const [isNearBottom, setIsNearBottom] = useState(true)

  const handleScroll = useCallback(() => {
    const element = containerRef.current
    if (!element) return
    const nearBottom = isChatNearBottom(element)
    shouldStickToBottom.current = nearBottom
    setIsNearBottom(nearBottom)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const element = containerRef.current
    if (!element) return
    shouldStickToBottom.current = true
    setIsNearBottom(true)
    if (typeof element.scrollTo === "function") {
      element.scrollTo({ top: element.scrollHeight, behavior })
    } else {
      element.scrollTop = element.scrollHeight
    }
  }, [])

  useLayoutEffect(() => {
    if (previousConversation.current === conversationKey) return
    previousConversation.current = conversationKey
    previousItemCount.current = itemCount
    shouldStickToBottom.current = true
    setIsNearBottom(true)
    scrollToBottom("auto")
  }, [conversationKey, itemCount, scrollToBottom])

  useLayoutEffect(() => {
    const previousCount = previousItemCount.current
    if (itemCount > previousCount && shouldStickToBottom.current) {
      scrollToBottom(previousCount === 0 ? "auto" : "smooth")
    }
    previousItemCount.current = itemCount
  }, [itemCount, scrollToBottom])

  return { containerRef, endRef, handleScroll, isNearBottom, scrollToBottom }
}
