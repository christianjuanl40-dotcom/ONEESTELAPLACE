export const EVENT_VENUE_TERMS: string[] = [
  "Reservation slots are only secured upon successful payment verification and admin approval.",
  "Temporary reservations that remain unpaid within 24 hours may automatically expire.",
  "Event reservations are limited to the selected schedule only.",
  "Customers are responsible for arriving and vacating the venue within their reserved time period.",
  "Cancellation requests made 14 days before the event date may be eligible for a refund.",
  "Cancellations made within 7 days before the scheduled event date are non-refundable.",
  "Remaining balances must be fully settled at least 7 days before the event date.",
  "Refunds approved by the administrator may be claimed onsite after 7 days.",
  "Customers are responsible for any damages, loss, or misconduct that may occur during the event.",
  "The venue management reserves the right to decline or cancel reservations that violate venue policies and regulations.",
  "Outside illegal activities, hazardous materials, and prohibited substances are strictly not allowed inside the venue premises.",
  "By proceeding with the reservation, the customer agrees to follow all venue rules, regulations, and payment policies established by One Estela Place.",
]

export const OFFICE_SPACE_TERMS: string[] = [
  "Reservation payments are strictly for securing office space slots only.",
  "Remaining balances, post-dated checks, and contract agreements shall be settled onsite.",
  "Office rentals require mandatory onsite contract signing before occupancy.",
  "One month advance payment and two months deposit are required upon contract signing.",
  "Payment for office rentals shall be settled through post-dated checks based on the agreed contract duration.",
  "Reservation approval is subject to successful payment verification and admin confirmation.",
  "Office tenants are responsible for maintaining cleanliness, order, and proper use of the rented office space.",
  "Any damages caused within the rented office space shall be shouldered by the tenant.",
  "Subleasing or unauthorized sharing of office spaces is strictly prohibited unless approved by management.",
  "Management reserves the right to terminate office rental agreements for policy violations, non-payment, or misconduct.",
  "Tenants must comply with all building rules, operational policies, and business regulations implemented by One Estela Place.",
  "By proceeding with the reservation, the customer agrees to follow all office rental policies, payment terms, and contract requirements established by One Estela Place.",
]

export const CANCELLATION_POLICY =
  "Cancellations made 90+ days before the event receive a full refund of any payments made (excluding non-refundable deposit). " +
  "Cancellations made 30–89 days before the event receive a 50% refund of the total rental fee. " +
  "Cancellations made less than 30 days before the event are non-refundable (full amount will be charged). " +
  "For office rentals, cancellation terms are subject to the signed contract agreement and applicable fees."

export const REFUND_POLICY =
  "Refunds approved by the administrator may be claimed onsite after 7 days. " +
  "For cancellations 90+ days before the event: full refund of any payments made (excluding the non-refundable deposit). " +
  "For cancellations 30–89 days before the event: 50% refund of the total rental fee. " +
  "For cancellations less than 30 days before the event: no refund available (full amount will be charged). " +
  "Rescheduling is allowed once, free of charge, when requested at least 10 days in advance, subject to availability."

export const PAYMENT_POLICY =
  "A non-refundable initial payment of 30% of the total rental fee is required within 48 hours of submitting a reservation request to confirm your booking. " +
  "Failure to make this initial payment will result in automatic cancellation of the booking. " +
  "The remaining balance must be fully settled at least 7 days before the event date. " +
  "We accept bank transfer, credit card, and payment at the office. " +
  "For office rentals, payment shall be settled through post-dated checks based on the agreed contract duration, with one month advance payment and two months deposit required upon contract signing."

export const CONTRACT_INFORMATION_EVENT_VENUE =
  "CONTRACT DETAILS\n" +
  "Customers are required to visit One Estela Place after payment verification to sign the event venue contract.\n" +
  "The contract must be signed before the scheduled event date.\n" +
  "The signed contract confirms the customer's agreement with the venue schedule, payment policy, cancellation policy, refund policy, and venue rules.\n\n" +
  "REQUIREMENTS\n" +
  "• Valid government-issued ID\n" +
  "• Booking reference number\n" +
  "• Payment reference or proof of payment\n" +
  "• Contact information (email and phone number)\n\n" +
  "REMINDERS\n" +
  "• Contract must be signed at least 7 days before the event date to ensure proper preparation.\n" +
  "• The contract signing process takes approximately 15–30 minutes.\n" +
  "• Both parties (customer and venue representative) must be present for signing.\n" +
  "• Failure to complete contract signing may affect the reservation approval or event preparation process.\n\n" +
  "DOWNLOAD INSTRUCTIONS\n" +
  "A preview of the contract is available in your booking details. The official contract must be signed onsite at the One Estela Place office."

export const CONTRACT_INFORMATION_OFFICE_RENTAL =
  "CONTRACT DETAILS\n" +
  "Office space rentals require a separate rental contract.\n" +
  "Customers must visit One Estela Place after reservation verification to complete contract signing.\n" +
  "Office rental terms may be 6 months, 1 year, or 2 years depending on the selected rental duration.\n\n" +
  "REQUIREMENTS\n" +
  "• Valid government-issued ID\n" +
  "• Proof of business registration (if applicable)\n" +
  "• Booking reference number\n" +
  "• Payment reference or proof of reservation payment\n" +
  "• Contact information (email and phone number)\n\n" +
  "RENTAL TERMS\n" +
  "• Minimum rental period: 6 months\n" +
  "• One month advance and two months deposit required upon contract signing\n" +
  "• Monthly rental payments are settled through post-dated checks\n" +
  "• Cheques submitted must cover the full rental term\n" +
  "• Required onsite payment: 1 month advance + 2 months deposit = 3 months initial payment\n\n" +
  "REMINDERS\n" +
  "• Contract must be signed and initial payment completed before occupancy.\n" +
  "• The contract signing process takes approximately 30–45 minutes.\n" +
  "• All post-dated checks must be submitted face-to-face at the office.\n" +
  "• Future monthly payments are handled through post-dated checks based on the agreed contract duration.\n\n" +
  "DOWNLOAD INSTRUCTIONS\n" +
  "A preview of the contract is available in your booking details. The official contract must be signed onsite at the One Estela Place office."

export const BOOKING_TERMS_SECTIONS = [
  {
    title: "1. Booking Confirmation & Initial Payment",
    items: [
      "A non-refundable initial payment of 30% of the total rental fee is required within 48 hours of submitting a reservation request to confirm your booking.",
      "Failure to make this initial payment will result in automatic cancellation of the booking.",
      "Remaining balance must be settled at least 7 days before the event date.",
    ],
  },
  {
    title: "2. Cancellation Policy",
    items: [
      "Cancellations made 14 days or more before the event will not be charged any additional fees, but the initial payment remains non-refundable.",
      "Cancellations made less than 14 days before the event will result in a 50% charge of the total rental fee.",
      "No-shows or same-day cancellations will be charged the full amount.",
    ],
  },
  {
    title: "3. Venue Usage Rules",
    items: [
      "The venue is strictly for event space rental only. We do not provide catering, decoration, or event management services.",
      "Clients are responsible for bringing in and managing their own suppliers (e.g., caterers, stylists).",
      "Event organizers must ensure all equipment, decor, and personal items are removed immediately after the event.",
      "Any damages to the venue or its facilities will be charged to the client.",
      "Smoking inside the venue is strictly prohibited.",
      "Noise levels must be kept within reasonable limits and comply with local ordinances.",
    ],
  },
  {
    title: "4. Time and Overtime Policy",
    items: [
      "Bookings are based on the agreed rental time. Early setup or overtime use must be pre-approved and may incur additional charges.",
      "Going beyond the reserved time without notice will result in overtime fees charged per hour.",
    ],
  },
  {
    title: "5. Changes and Rescheduling",
    items: [
      "One-time rescheduling is allowed if requested at least 10 days in advance, subject to availability.",
      "Additional rescheduling or changes within 10 days may incur processing fees.",
    ],
  },
  {
    title: "6. Force Majeure",
    items: [
      "One Estela Place will not be liable for cancellations or changes caused by events beyond our control, including natural disasters, government restrictions, or other force majeure events. In such cases, we will offer a rescheduling option without penalty.",
    ],
  },
  {
    title: "7. Liability and Conduct",
    items: [
      "Clients and their guests are expected to behave in a respectful and responsible manner.",
      "One Estela Place is not liable for any injury, theft, or loss of personal property during the event.",
    ],
  },
]

export const VENUE_RESERVATION_TERMS = [
  "A partial downpayment must be made within 24 hours (1 day) of the initial booking request. Failure to provide proof of payment within this timeframe will result in the automatic cancellation of the requested date.",
  "The remaining balance must be settled completely within one (1) week of the initial downpayment.",
  "Once the initial payment is confirmed, the customer is required to visit the venue for the physical signing of the contract.",
  "The booking status will reflect 'Approved but awaiting physical signing' until the contract is signed.",
  "By checking the agreement box and submitting the form, you acknowledge that you have read and understood these terms.",
]

export const POLICY_LABELS: Record<string, string> = {
  venueTerms: "Event Venue Terms and Conditions",
  officeTerms: "Office Space Rental Terms and Conditions",
  cancellation: "Cancellation Policy",
  refund: "Refund Policy",
  payment: "Payment Policy",
  contractSigning: "Contract Information",
  contractSigningEV: "Event Venue Contract",
  contractSigningOR: "Office Rental Contract",
}

export const ALL_POLICY_KEYS = ["venueTerms", "officeTerms", "cancellation", "refund", "payment", "contractSigning", "contractSigningEV", "contractSigningOR"] as const
export type PolicyKey = (typeof ALL_POLICY_KEYS)[number]

export const DEFAULT_POLICY_CONTENT: Record<string, string> = {
  venueTerms: EVENT_VENUE_TERMS.map((t, i) => `${i + 1}. ${t}`).join("\n"),
  officeTerms: OFFICE_SPACE_TERMS.map((t, i) => `${i + 1}. ${t}`).join("\n"),
  cancellation: CANCELLATION_POLICY,
  refund: REFUND_POLICY,
  payment: PAYMENT_POLICY,
  contractSigning: CONTRACT_INFORMATION_EVENT_VENUE + "\n\n---\n\n" + CONTRACT_INFORMATION_OFFICE_RENTAL,
  contractSigningEV: CONTRACT_INFORMATION_EVENT_VENUE,
  contractSigningOR: CONTRACT_INFORMATION_OFFICE_RENTAL,
}

let cachedPolicies: { type: string; content: string }[] | null = null

export function setCachedPolicies(policies: { type: string; content: string }[]) {
  cachedPolicies = policies
}

function parseCMSContent(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
}

export function getPolicyItems(type: PolicyKey): string[] {
  if (cachedPolicies) {
    const match = cachedPolicies.find((p: any) => p.type === type && p.content?.trim() && p.isPublished !== false)
    if (match) return parseCMSContent(match.content)
  }
  return parseCMSContent(DEFAULT_POLICY_CONTENT[type])
}

export function getPolicyText(type: PolicyKey): string {
  if (cachedPolicies) {
    const match = cachedPolicies.find((p: any) => p.type === type && p.content?.trim() && p.isPublished !== false)
    if (match) return match.content
  }
  return DEFAULT_POLICY_CONTENT[type]
}
