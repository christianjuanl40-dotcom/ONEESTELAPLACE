/** Shared by the customer form, booking provider, and payment-submission API.
 * References are identifiers: never coerce to numbers, remove characters, or truncate.
 */
export function validatePaymentReference(
  reference: unknown,
  method: "bank" | "cash",
): { value: string; error: string | null } {
  if (method === "cash") return { value: "", error: null }

  if (reference !== undefined && reference !== null && typeof reference !== "string") {
    return { value: "", error: "Enter a valid reference number." }
  }

  const value = typeof reference === "string" ? reference.trim() : ""
  if (!value) return { value, error: "Reference number is required." }
  if (!/^[0-9]{5,}$/.test(value)) {
    return { value, error: "Enter a valid reference number." }
  }

  return { value, error: null }
}
