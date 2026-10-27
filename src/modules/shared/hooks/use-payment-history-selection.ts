"use client"

import { useState } from "react"
import { getPaymentHistoryKey } from "../lib/payment-review"
import type { PaymentRecordLike } from "../lib/payment-calculations"

/** Pin even the initial selection by identity, never by position in a snapshot. */
export function usePaymentHistorySelection<T extends PaymentRecordLike>(
  bookingId: string,
  records: ReadonlyArray<T>,
) {
  const firstKey = records[0] ? getPaymentHistoryKey(records[0]) : ""
  const [selection, setSelection] = useState(() => ({ bookingId, key: firstKey }))

  // Reset synchronously on a booking switch so another booking's selected ID
  // cannot be rendered for a frame. A missing selected record stays missing;
  // an arriving/reordered submission must not silently become the selection.
  if (selection.bookingId !== bookingId || (!selection.key && firstKey)) {
    setSelection({ bookingId, key: firstKey })
  }
  const selectedKey = selection.bookingId === bookingId && selection.key ? selection.key : firstKey

  return {
    selected: records.find((record) => getPaymentHistoryKey(record) === selectedKey) || null,
    selectedKey,
    select: (record: T) => setSelection({ bookingId, key: getPaymentHistoryKey(record) }),
  }
}
