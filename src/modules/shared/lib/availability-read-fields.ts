/** Scheduling/hold fields only. Legacy aliases and all-date office lifecycle
 * fields must remain complete; proof, receipt, profile and note payloads are not
 * availability inputs. Transactional writers still read full documents.
 */
export const AVAILABILITY_READ_FIELDS = [
  "bookingCategory", "bookingType", "rentalType", "isOfficeRental", "officeId", "venueId", "spaceId", "officeSpaceId", "roomId",
  "scope", "type", "roomName", "venue", "spaceName", "officeSpaceName", "name",
  "date", "startDate", "endDate", "officeRentalTerm", "rentalTerm", "contractTerm",
  "startTime", "start_time", "start", "bookingStartTime", "endTime", "end_time", "end", "bookingEndTime", "time", "timeRange", "bookingTime",
  "status", "bookingStatus", "leaseStatus", "cancellationStatus", "cancelRequestStatus", "cancellationRequested", "modificationRequested",
  "isSlotSecured", "verifiedByAdmin", "contractSigned", "createdAt", "bookingCode", "paymentStatus", "hasActivePaymentSubmission",
  "totalPrice", "totalAmount", "amount", "price", "amountPaid", "paidAmount", "paymentAmount", "paymentType",
  "selectedDownpaymentAmount", "downPaymentPercentage", "downpaymentPaid",
] as const

export const AVAILABILITY_PAYMENT_FIELDS = [
  "bookingId", "bookingCode", "status", "verificationStatus", "amount", "amountPaid", "amountReceived", "term", "isRemainingDownPayment", "submittedAt", "updatedAt",
] as const

export function getAvailabilityDataKey(...datasets: ReadonlyArray<ReadonlyArray<object>>): string {
  return JSON.stringify(datasets.map(rows => rows.map(row => {
    const record = row as Record<string, unknown>
    return [record.id, ...AVAILABILITY_READ_FIELDS.map(field => record[field])]
  }).sort((a, b) => String(a[0]).localeCompare(String(b[0])))))
}
