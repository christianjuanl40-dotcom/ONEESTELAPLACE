export interface ChatbotResponse {
  message: string
  followUp?: string[]
  escalate?: boolean
  category: string
}

export interface ChatbotKnowledge {
  [key: string]: ChatbotResponse
}

// Comprehensive chatbot knowledge base
export const chatbotKnowledge: ChatbotKnowledge = {
  // Greetings
  hello: {
    message:
      "Hello! Welcome to One Estela Place! 👋 I'm your virtual assistant. I can help you with venue availability, office space details, pricing, and reservation steps. How can I assist you today?",
    followUp: [
      "Check venue availability",
      "View office spaces",
      "Get pricing information",
      "Learn about reservation process",
    ],
    category: "greeting",
  },
  hi: {
    message:
      "Hi there! Welcome to One Estela Place! I'm here to help you with any questions about our venues and office spaces. What would you like to know?",
    followUp: ["Event venue information", "Office rental details", "Booking process", "Contact information"],
    category: "greeting",
  },
  "good morning": {
    message:
      "Good morning! Welcome to One Estela Place! How can I help you start your day with the perfect venue or office space?",
    followUp: ["Browse event venues", "Explore office spaces", "Check availability", "Get pricing"],
    category: "greeting",
  },

  // Venue Availability
  availability: {
    message:
      "I can help you check availability for our venues! We have:\n\n🏛️ **Event Venues:**\n• The Milestone Event Place (up to 500 guests)\n• Moment Event Place (up to 150 guests)\n• Conference Room (up to 50 attendees)\n• Business Operation Meeting Room (up to 20 executives)\n\n🏢 **Office Spaces:**\n• 16 modern office rooms (Ground Floor: 1-8, Second Floor: 9-16)\n\nWhat type of space and date are you looking for?",
    followUp: [
      "Event venue availability",
      "Office space availability",
      "Specific date inquiry",
      "Capacity requirements",
    ],
    category: "availability",
  },
  "venue availability": {
    message:
      "Our event venues are available for booking! Here's what we offer:\n\n🎉 **The Milestone Event Place** - Perfect for large celebrations (up to 500 guests)\n🌟 **Moment Event Place** - Ideal for intimate gatherings (up to 150 guests)\n📊 **Conference Room** - Great for business meetings (up to 50 attendees)\n💼 **Business Operation Meeting Room** - Executive meetings (up to 20 people)\n\nWhich venue interests you, or would you like to check a specific date?",
    followUp: [
      "The Milestone Event Place details",
      "Moment Event Place details",
      "Conference Room details",
      "Check specific date",
    ],
    category: "availability",
  },
  "office availability": {
    message:
      "We have 16 modern office spaces available for rent:\n\n🏢 **Ground Floor (Rooms 1-8):**\n• Modern offices with natural lighting\n• Collaborative workspaces\n• Tech-enabled smart offices\n• Creative studios\n\n🏢 **Second Floor (Rooms 9-16):**\n• Executive suites with city views\n• Innovation labs with cutting-edge tech\n• Premium offices with luxury amenities\n\nEach room accommodates 2-10 workstations. Which floor or specific room interests you?",
    followUp: ["Ground floor offices", "Second floor offices", "Room capacity details", "Office amenities"],
    category: "availability",
  },

  // Office Space Details
  "office spaces": {
    message:
      "Our office spaces are designed for modern businesses! Here's what we offer:\n\n🏢 **16 Professional Offices** (Rooms 1-16)\n📍 **Two Floors Available**\n💺 **Capacity:** 2-10 workstations per room\n🌟 **Features:** Natural lighting, modern amenities, flexible layouts\n\n**Ground Floor Highlights:**\n• Corner offices with panoramic views\n• Open-plan collaborative spaces\n• Tech-enabled smart offices\n\n**Second Floor Highlights:**\n• Executive suites with enhanced privacy\n• Innovation labs with cutting-edge technology\n• Penthouse office with luxury amenities\n\nWould you like details about a specific room or floor?",
    followUp: ["Room 1-8 details", "Room 9-16 details", "Office amenities", "Rental pricing"],
    category: "office_details",
  },
  "ground floor": {
    message:
      "**Ground Floor Offices (Rooms 1-8):**\n\n🏢 **Room 1:** Modern office with natural lighting (4-6 workstations)\n🏢 **Room 2:** Spacious office with meeting area (6-8 workstations)\n🏢 **Room 3:** Corner office with panoramic views (3-4 workstations)\n🏢 **Room 4:** Open-plan collaborative space (8-10 workstations)\n🏢 **Room 5:** Private suite with dedicated entrance (2-3 workstations)\n🏢 **Room 6:** Tech-enabled smart office (5-6 workstations)\n🏢 **Room 7:** Creative studio with flexible layout (4-8 workstations)\n🏢 **Room 8:** Premium office with city views (3-5 workstations)\n\nWhich room would you like to know more about?",
    followUp: ["Room 1 details", "Room 4 details", "Room 6 details", "Schedule a viewing"],
    category: "office_details",
  },
  "second floor": {
    message:
      "**Second Floor Offices (Rooms 9-16):**\n\n🏢 **Room 9:** Elevated workspace with enhanced privacy (4-6 workstations)\n🏢 **Room 10:** Conference-capable office (6-8 workstations)\n🏢 **Room 11:** Corner suite with panoramic views (3-4 workstations)\n🏢 **Room 12:** Collaborative team workspace (8-10 workstations)\n🏢 **Room 13:** Executive suite with private meeting room (2-3 workstations)\n🏢 **Room 14:** Innovation lab with cutting-edge tech (5-6 workstations)\n🏢 **Room 15:** Creative hub with artistic elements (4-8 workstations)\n🏢 **Room 16:** Penthouse office with luxury amenities (3-5 workstations)\n\nWhich room interests you most?",
    followUp: ["Room 13 executive suite", "Room 16 penthouse office", "Room 14 innovation lab", "Schedule a viewing"],
    category: "office_details",
  },

  // Pricing Information
  pricing: {
    message:
      "Here's our pricing structure:\n\n💰 **Event Venues:**\n• The Milestone Event Place: ₱50,000 - ₱80,000 per event\n• Moment Event Place: ₱25,000 - ₱40,000 per event\n• Conference Room: ₱8,000 - ₱15,000 per day\n• Business Meeting Room: ₱5,000 - ₱10,000 per day\n\n💼 **Office Spaces:**\n• Ground Floor Offices: ₱15,000 - ₱25,000 per month\n• Second Floor Offices: ₱18,000 - ₱35,000 per month\n• Executive Suites: ₱30,000 - ₱50,000 per month\n\n*Prices vary based on duration, package inclusions, and specific requirements. Would you like a detailed quote?",
    followUp: ["Event venue pricing", "Office rental rates", "Package inclusions", "Request detailed quote"],
    category: "pricing",
  },
  cost: {
    message:
      "Our competitive rates are designed to fit various budgets:\n\n🎉 **Event Venues:** Starting from ₱5,000/day for meeting rooms up to ₱80,000 for premium events\n🏢 **Office Spaces:** Starting from ₱15,000/month for standard offices up to ₱50,000/month for executive suites\n\n**What's Included:**\n✅ Utilities and maintenance\n✅ Security and cleaning services\n✅ Basic furniture and equipment\n✅ High-speed internet access\n\nWould you like a customized quote based on your specific needs?",
    followUp: ["Get custom quote", "Compare packages", "Payment terms", "Booking requirements"],
    category: "pricing",
  },

  // Reservation Process
  reservation: {
    message:
      "Booking with us is simple! Here's our 4-step process:\n\n📋 **Step 1:** Choose your space and preferred dates\n💳 **Step 2:** Submit booking request with requirements\n📄 **Step 3:** Review contract and make initial payment\n✅ **Step 4:** Confirmation and space preparation\n\n**Required Information:**\n• Event/rental dates and duration\n• Expected number of guests/occupants\n• Special requirements or equipment needs\n• Contact and billing information\n\n**Payment Options:**\n• Bank transfer, credit card, or cash\n• Flexible payment terms available\n\nWould you like to start a reservation or need more details about any step?",
    followUp: ["Start booking process", "Payment options", "Cancellation policy", "Required documents"],
    category: "reservation",
  },
  booking: {
    message:
      "Ready to book? Great! Here's what you need to know:\n\n📅 **Booking Requirements:**\n• Minimum 7 days advance notice for events\n• Minimum 30 days advance notice for office rentals\n• Valid ID and business registration (for offices)\n• 50% deposit to secure booking\n\n📝 **Booking Process:**\n1. Fill out our reservation form\n2. Receive confirmation and contract\n3. Submit required documents\n4. Make initial payment\n5. Final confirmation and preparation\n\n**Need Help?** I can connect you with our booking specialist for personalized assistance!\n\nWould you like to proceed with a booking or speak with our team?",
    followUp: [
      "Fill reservation form",
      "Speak with booking specialist",
      "View available dates",
      "Get booking checklist",
    ],
    escalate: true,
    category: "reservation",
  },

  // Contact and Support
  contact: {
    message:
      "Here's how to reach us:\n\n📍 **Address:** One Estela Place, Business District\n📞 **Phone:** +63 (2) 8123-4567\n📧 **Email:** info@oneestela.com\n🕒 **Hours:** Monday-Sunday, 8:00 AM - 10:00 PM\n\n**Quick Actions:**\n• Schedule a site visit\n• Request a callback\n• Get a custom quote\n• Speak with our team\n\nHow would you prefer to connect with us?",
    followUp: ["Schedule site visit", "Request callback", "Get custom quote", "Chat with team"],
    escalate: true,
    category: "contact",
  },
  location: {
    message:
      "📍 **One Estela Place Location:**\n\n**Address:** One Estela Place, Business District\n**Landmarks:** Near major shopping centers and business hubs\n**Accessibility:** Easy access via public transport and major highways\n**Parking:** Ample parking spaces available\n\n**Transportation:**\n🚗 Car: Direct highway access\n🚌 Bus: Multiple bus routes nearby\n🚇 Train: 5-minute walk from nearest station\n✈️ Airport: 30-minute drive\n\nWould you like directions or information about nearby amenities?",
    followUp: ["Get directions", "Nearby amenities", "Parking information", "Transportation options"],
    category: "contact",
  },

  // Catering and Food Services
  catering: {
    message:
      "🍽️ **Catering Services Available:**\n\n**In-House Catering:**\n• Professional catering kitchen facilities\n• Customizable menu options\n• Buffet, plated, or cocktail service\n• Beverage packages (alcoholic & non-alcoholic)\n\n**Dietary Requirements:**\n✓ Vegetarian/Vegan options\n✓ Halal and Kosher available\n✓ Gluten-free accommodations\n✓ Allergy-friendly preparations\n\n**Pricing:**\n• Per-person packages: ₱800 - ₱2,500+\n• Minimum 20 guests for catering service\n• Setup and cleanup included\n\n**Popular Packages:**\n• Continental Breakfast\n• Business Lunch\n• Cocktail Reception\n• Formal Dinner\n• Evening Refreshments\n\nWould you like to customize a catering package for your event?",
    followUp: [
      "View menu options",
      "Dietary requirements",
      "Pricing per person",
      "Request catering quote",
      "See sample menus",
    ],
    escalate: true,
    category: "catering",
  },
  food: {
    message:
      "We offer comprehensive catering solutions for all events!\n\n**What We Provide:**\n• Full meal preparation and service\n• Professional catering staff\n• Table setup and decoration coordination\n• Beverage service management\n\n**Service Styles:**\n🍽️ **Buffet Service:** Family-style, self-service options\n🍷 **Plated Dining:** Formal multi-course meals\n🥂 **Cocktail Reception:** Standing reception with passed appetizers\n🍜 **Themed Menus:** Cuisine options (Filipino, International, Asian fusion)\n\n**Budget Options:**\n💰 Economy: ₱800-₱1,200 per person\n💰 Standard: ₱1,200-₱1,800 per person\n💰 Premium: ₱1,800-₱2,500+ per person\n\nWould you like to discuss your event's catering needs?",
    followUp: ["View menus", "Get catering quote", "Check dietary options", "Schedule tasting"],
    escalate: true,
    category: "catering",
  },

  // Decorations and Setup
  decorations: {
    message:
      "🎨 **Event Decoration Services:**\n\n**Our Services Include:**\n• Professional interior decoration\n• Floral arrangements and centerpieces\n• Lighting design and setup\n• Backdrop and stage decoration\n• Table styling and linens\n\n**Decoration Styles:**\n✨ Elegant/Formal\n🎉 Contemporary/Modern\n💕 Romantic/Intimate\n🌺 Garden/Natural Theme\n💼 Corporate/Professional\n🎭 Themed Events\n\n**What's Included:**\n• Design consultation\n• Setup and installation\n• Coordination with venue\n• Take-down service\n\n**Pricing:**\n• Basic package: ₱15,000 - ₱25,000\n• Standard package: ₱25,000 - ₱50,000\n• Premium package: ₱50,000+\n\nWhat type of decoration style are you envisioning?",
    followUp: [
      "View decoration styles",
      "Flower arrangements",
      "Lighting options",
      "Get decoration quote",
      "Schedule consultation",
    ],
    escalate: true,
    category: "decorations",
  },
  "decorations & setup": {
    message:
      "We provide complete decoration and event setup services!\n\n**Available Options:**\n🌸 Floral Decorations - Fresh flowers and arrangements\n💡 Lighting - Professional lighting design and effects\n🪑 Furniture Setup - Table and chair arrangement\n📐 Stage & Backdrop - Professional stage setup\n🎨 Custom Themes - Personalized decoration concepts\n\n**Our Team:**\n✓ Experienced event decorators\n✓ Professional installation crew\n✓ Full coordination with venue staff\n✓ Emergency support during event\n\n**Package includes:**\n• Free design consultation\n• Setup 2-3 hours before event\n• Full takedown after event\n• Storage of items if needed\n\nWould you like to discuss your decoration preferences?",
    followUp: ["Show decoration gallery", "Theme ideas", "Lighting design", "Request decoration quote"],
    escalate: true,
    category: "decorations",
  },

  // Event Schedule and Timing
  schedule: {
    message:
      "📅 **Event Scheduling Information:**\n\n**Booking Window:**\n• Minimum 7 days advance notice for events\n• Recommended: 2-4 weeks for planning\n• Peak season (Dec-Jun): Book 2-3 months ahead\n\n**Operating Hours:**\n🕐 **Weekday Events:** 9:00 AM - 10:00 PM\n🕐 **Weekend Events:** 8:00 AM - 11:00 PM (Fri-Sat)\n🕐 **Sunday Events:** 9:00 AM - 9:00 PM\n\n**Event Duration:**\n• Minimum: 2 hours\n• Standard: 4 hours\n• Extended: 6-8 hours (additional fees apply)\n• Overnight events: Available on request\n\n**Setup & Breakdown:**\n• Early setup: 2-3 hours before\n• Breakdown time: 1-2 hours after\n• Included in rental package\n\nWhen are you planning your event?",
    followUp: [
      "Check availability",
      "Peak season dates",
      "Extended hours pricing",
      "Flexible timing options",
      "Quick booking inquiry",
    ],
    category: "schedule",
  },
  timing: {
    message:
      "⏰ **Event Timing & Scheduling:**\n\n**Available Time Slots:**\n\n**Morning Events (9 AM - 12 PM):**\n✓ Breakfast meetings\n✓ Bridal showers\n✓ Business conferences\n\n**Afternoon Events (12 PM - 6 PM):**\n✓ Lunch meetings\n✓ Wedding receptions\n✓ Corporate events\n✓ Seminars\n\n**Evening Events (6 PM - 11 PM):**\n✓ Gala dinners\n✓ Wedding ceremonies & receptions\n✓ Evening parties\n\n**Holiday & Weekend Premium:**\n• Friday-Saturday: +15% surcharge\n• Public holidays: +20% surcharge\n• Special occasions: Negotiable rates\n\n**Quick Availability Check:**\n• Peak months: December-June\n• Available months: July-November\n\nWhat date and time work best for you?",
    followUp: ["Check specific date", "View pricing", "Peak vs off-season", "Request custom timing"],
    category: "schedule",
  },

  // Capacity and Guest Count
  capacity: {
    message:
      "👥 **Venue Capacity Information:**\n\n**Event Venues:**\n🏛️ **The Milestone Event Place:** 50-500 guests (flexible seating)\n🌟 **Moment Event Place:** 50-150 guests (intimate setting)\n📊 **Conference Room:** 20-50 attendees\n💼 **Business Meeting Room:** 10-20 executives\n\n**Office Spaces:**\n🏢 **Standard Offices:** 2-10 workstations\n🏢 **Executive Suites:** 2-5 workstations\n🏢 **Collaborative Spaces:** 8-10 workstations\n\n**Flexible Configurations:**\n• Theater-style seating (standing room only)\n• Classroom-style (tables with chairs)\n• Banquet-style (dining tables)\n• Cocktail-style (standing reception)\n• U-shape (boardroom meetings)\n• Cabaret-style (small table groupings)\n\nHow many guests are you expecting?",
    followUp: ["View venue layouts", "Capacity pricing", "Seating arrangements", "Special setup requests"],
    category: "capacity",
  },

  // Amenities and Features
  amenities: {
    message:
      "Our premium amenities include:\n\n🏢 **Building Features:**\n• 24/7 security and CCTV monitoring\n• High-speed fiber internet (up to 1Gbps)\n• Backup power generators\n• Central air conditioning\n• Modern elevator systems\n\n🎯 **Event Venue Amenities:**\n• Professional sound and lighting systems\n• Projectors and presentation equipment\n• Catering kitchen facilities\n• Bridal/preparation rooms\n• Ample parking spaces\n\n💼 **Office Space Amenities:**\n• Furnished workstations\n• Meeting room access\n• Printing and scanning facilities\n• Kitchen and break areas\n• Reception services\n\nWhat specific amenities are most important to you?",
    followUp: ["Technology features", "Security measures", "Catering options", "Additional services"],
    category: "amenities",
  },

  // Virtual Tour
  "virtual tour": {
    message:
      "Experience our spaces virtually! 🎥\n\n**Available Virtual Tours:**\n🏛️ **Event Venues:** 360° views of all 4 event spaces\n🏢 **Office Spaces:** Complete tours of all 16 office rooms\n📱 **Interactive Features:** Zoom, pan, and explore every angle\n\n**Tour Highlights:**\n• High-resolution 360° photography\n• Multiple viewing angles per space\n• Detailed room information\n• Capacity and layout details\n\nYou can access the virtual tour right here on our website! Would you like me to guide you through specific spaces?",
    followUp: ["Tour event venues", "Tour office spaces", "Schedule live tour", "Get tour assistance"],
    category: "tour",
  },

  // Default responses for unrecognized queries
  default: {
    message:
      "I'd be happy to help you with that! However, I might need to connect you with one of our specialists who can provide more detailed information about your specific inquiry.\n\nIn the meantime, I can help you with:\n• Venue availability and pricing\n• Office space details and features\n• Reservation process and requirements\n• Contact information and directions\n\nWould you like me to connect you with our team for personalized assistance?",
    followUp: ["Connect with specialist", "Browse venue options", "Check availability", "Get pricing information"],
    escalate: true,
    category: "general",
  },
}

// Function to find the best matching response
export function findBestMatch(userInput: string): ChatbotResponse {
  const input = userInput.toLowerCase().trim()

  // Direct keyword matches
  for (const [key, response] of Object.entries(chatbotKnowledge)) {
    if (input.includes(key)) {
      return response
    }
  }

  // Fuzzy matching for common variations
  const fuzzyMatches: { [key: string]: string[] } = {
    hello: ["hey", "hi there", "greetings", "good day"],
    availability: ["available", "free", "open", "vacant", "schedule"],
    pricing: ["price", "cost", "rate", "fee", "charge", "expensive", "cheap"],
    "office spaces": ["office", "workspace", "room", "rental", "lease"],
    reservation: ["book", "reserve", "booking", "appointment"],
    contact: ["reach", "call", "phone", "email", "address"],
    amenities: ["features", "facilities", "services", "included", "what's included"],
    "virtual tour": ["tour", "view", "see", "visit", "look around", "360"],
    catering: ["food", "catering", "menu", "meals", "dining", "restaurant", "lunch", "dinner", "breakfast", "refreshments"],
    decorations: ["decoration", "flowers", "setup", "arrangement", "theme", "design", "floral", "backdrop", "lighting"],
    schedule: ["schedule", "timing", "time", "date", "when", "hours", "hours of operation", "availability"],
    capacity: ["capacity", "guests", "people", "attendees", "how many", "size", "seating"],
  }

  for (const [key, variations] of Object.entries(fuzzyMatches)) {
    if (variations.some((variation) => input.includes(variation))) {
      return chatbotKnowledge[key] || chatbotKnowledge.default
    }
  }

  // If no match found, return default response
  return chatbotKnowledge.default
}

// Function to generate contextual follow-up suggestions
export function generateFollowUps(category: string): string[] {
  const categoryFollowUps: { [key: string]: string[] } = {
    greeting: ["Check venue availability", "Explore office spaces", "Get pricing information", "Schedule a tour"],
    availability: ["View specific venues", "Check office rooms", "Get pricing details", "Book a viewing"],
    pricing: ["Compare packages", "Get custom quote", "View payment options", "Start booking process"],
    office_details: ["Schedule viewing", "Check availability", "Get pricing", "Compare rooms"],
    reservation: ["Start booking", "Speak with specialist", "Get requirements list", "View cancellation policy"],
    contact: ["Schedule callback", "Get directions", "Request brochure", "Chat with team"],
    amenities: ["View virtual tour", "Get detailed specs", "Compare features", "Schedule visit"],
    tour: ["Start virtual tour", "Schedule live tour", "Get room details", "Book viewing"],
    general: ["Browse venues", "Check availability", "Get pricing", "Contact team"],
  }

  return categoryFollowUps[category] || categoryFollowUps.general
}
