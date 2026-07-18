import { PublicLayout } from "@/components/public-layout"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/src/modules/shared/components/ui/accordion"
import { Button } from "@/src/modules/shared/components/ui/button"
import { CANCELLATION_POLICY, REFUND_POLICY, PAYMENT_POLICY } from "@/src/modules/shared/lib/policies"

export default function FAQsPage() {
  const faqs = [
    {
      question: "How far in advance should I book my event?",
      answer:
        "We recommend booking at least 3-6 months in advance, especially for popular dates like weekends and holidays. However, we can sometimes accommodate last-minute bookings depending on availability.",
    },
    {
      question: "What is included in the venue rental?",
      answer:
        "Our venue rental includes tables, chairs, basic lighting, sound system, air conditioning, parking, and access to our bridal suite. Catering, decorations, and additional services can be arranged separately.",
    },
    {
      question: "Do you provide catering services?",
      answer:
        "Yes, we have preferred catering partners who are familiar with our venue. You can also choose to bring your own caterer, subject to our guidelines and requirements.",
    },
    {
      question: "What is your cancellation policy?",
      answer: CANCELLATION_POLICY,
    },
    {
      question: "Is there parking available?",
      answer:
        "Yes, we provide complimentary parking for up to 200 vehicles. Valet parking can also be arranged for an additional fee.",
    },
    {
      question: "Can I visit the venue before booking?",
      answer:
        "We encourage all potential clients to schedule a tour. Contact us to arrange a convenient time to visit and see our facilities.",
    },
    {
      question: "What is the maximum capacity?",
      answer:
        "Our main hall can accommodate up to 500 guests for a cocktail reception or 350 guests for a seated dinner. We also have smaller spaces available for intimate gatherings.",
    },
    {
      question: "Do you allow outside vendors?",
      answer:
        "Yes, you can bring your own vendors. All outside vendors must be licensed and insured, and we require vendor information at least 30 days before your event.",
    },
    {
      question: "Is the venue accessible for guests with disabilities?",
      answer:
        "Yes, our venue is fully ADA compliant with wheelchair accessible entrances, restrooms, and elevator access to all floors.",
    },
    {
      question: "What payment methods do you accept?",
      answer:
        "We accept cash, check, and all major credit cards. A deposit is required to secure your date, with the balance due 30 days before your event.",
    },
    {
      question: "What is your payment policy?",
      answer: PAYMENT_POLICY,
    },
    {
      question: "What happens if I need to cancel my event?",
      answer:
        "Cancellations 14+ days before your event incur no additional fees (deposit remains non-refundable). Cancellations within 14 days result in a 50% charge of total rental fee. Same-day cancellations are charged the full amount.",
    },
    {
      question: "Can I reschedule my event?",
      answer:
        "One free rescheduling is allowed if requested at least 10 days in advance, subject to availability. Additional changes within 10 days may incur processing fees.",
    },
    {
      question: "What services do you provide?",
      answer:
        "We provide event space rental only. You are responsible for bringing in your own caterers, decorators, and other suppliers. We do not provide catering, decoration, or event management services.",
    },
    {
      question: "Are there any restrictions on venue usage?",
      answer:
        "Yes. Smoking is strictly prohibited inside the venue. Noise levels must comply with local ordinances. All equipment and decorations must be removed immediately after your event. Any damages will be charged to the client.",
    },
  ]

  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 overflow-x-hidden">
        <div className="mx-auto max-w-3xl">
          <div className="mb-12 text-center">
            <h1 className="mb-6 text-4xl font-black text-gray-900">Frequently Asked Questions</h1>
            <p className="text-lg text-gray-600">
              Find answers to common questions about booking and hosting events at One Estela Place.
            </p>
          </div>

          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="border border-gray-200 rounded-lg px-4 sm:px-6 hover:shadow-md transition-shadow"
              >
                <AccordionTrigger className="text-left font-semibold text-gray-900 hover:text-orange-500 transition-colors">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-gray-600 leading-relaxed break-words">{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="mt-12 rounded-lg bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 p-4 sm:p-6 lg:p-8 text-center">
            <h2 className="mb-4 text-2xl font-bold text-gray-900">Still have questions?</h2>
            <p className="mb-6 text-gray-600">Can't find the answer you're looking for? Our team is here to help.</p>
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
              <Button asChild className="w-full sm:w-auto bg-orange-500 text-white hover:bg-orange-600 shadow-lg border-0">
                <a href="/contact">Contact Us</a>
              </Button>
              <Button
                asChild
                variant="outline"
                className="w-full sm:w-auto border-orange-500 text-orange-500 hover:bg-orange-50 bg-transparent"
              >
                <a href="tel:555-123-4567">Call (555) 123-4567</a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PublicLayout>
  )
}
