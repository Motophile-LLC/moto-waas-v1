# **EXECUTION ROADMAP & PHASE PLAN**

**Project Name:** Moto WaaS Embed Widget (Virtual Service Writer)  
**LLM Instructions:** This document serves as the step-by-step master plan for building the embeddable React widget and its backend. Execute these phases sequentially. Note: All payment processing (Stripe) has been stripped out to focus strictly on Top-of-Funnel Lead Conversion.

---

# **PHASE 1: PRISMA DB & CLERK AUTHENTICATION**

1. **Initialize Project:**  
   * Set up the Next.js App Router project.  
   * Install dependencies: `npm i @prisma/client @clerk/nextjs ai openai zod`  
2. **Database Setup:**  
   * Initialize Prisma and apply the updated schema containing `ShopClient` (with `schedulingRule`), `Campaign`, and `ShopLead`.  
3. **Clerk Configuration:**  
   * Configure `@clerk/nextjs` middleware to protect admin routes while allowing the public Widget API endpoints to be accessed via CORS from allowed shop domains.

---

1. # **PHASE 2: VEHICLE IDENTIFICATION & THE LOGIC ENGINE**

4. **NHTSA VIN Decoder API (`/api/vin/route.ts`):**  
   * Create a serverless endpoint that accepts a 17-digit VIN.  
   * Query the free vPIC API: `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/[VIN]?format=json`.  
   * Parse the JSON response and return the standardized `ModelYear`, `Make`, `Model`, and `DisplacementCC`.  
5. **The Two-Speed Engine (`lib/quoteEngine.ts`):**  
   * Create the server-side utility function: `generateWidgetQuote(shopId, targetComponentSlot, vehicleData)`  
   * Query the JTC and Cometic/James data to generate the raw math based on the decoded vehicle data.  
   * **Evaluate Track:** If the required parts include heavy engine components, custom Drag Specialties kits, or **Tires** (treated as special order), flag the payload as `serviceTrack: "PARTS_REQUIRED"`. If it only contains standard fluids or common wear items, flag as `serviceTrack: "STANDARD_SERVICE"`.  
   * **Age-Scaled Math:** Calculate the bike's age using the decoded NHTSA `ModelYear` and current year, then apply the shop's variable multiplier (1.5x, 2.0x, or 2.25x) to the JTC Warranty time to generate the accurate billable hours.

---

# **PHASE 3: EMBEDDABLE REACT WIDGET (`app/widget/page.tsx`)**

1. **The Iframe/Widget Approach:**  
   * Create a lightweight React component intended to be embedded on independent shop websites (e.g., WordPress or Wix) via an `<iframe>` or JavaScript snippet pointing to your Next.js hosted route.  
   * Ensure the widget reads the parent page's URL to authenticate the `ShopClient.allowedOrigin`.  
2. **Clerk SSO & Lead Capture Flow:**  
   * Implement the Clerk `<SignIn />` component inside the widget. Force users to authenticate with Apple or Google.  
3. **Vehicle Intake UI:**  
   * Provide a toggle for *"Enter VIN (Recommended)"* vs *"Select Year/Make/Model"*.  
   * If a VIN is entered, hit the `/api/vin/route.ts` endpoint to perfectly auto-populate the exact motorcycle details before generating the quote.  
4. **The Expectation Pitch & Simple Scheduling (LLM Generation):**  
   * **Rule A (Standard Service / Specials):** If `STANDARD_SERVICE`, surface a lightweight date picker constrained by the shop's `schedulingRule` (e.g., hide today if past 1 PM).  
   * **Rule B (Parts Required / Tires):** If `PARTS_REQUIRED`, hide the calendar. Output the disclaimer: *"This repair requires custom parts or tires. Shipping takes 7-10 days. Submit your request and the shop will contact you to schedule once parts arrive."*

---

# **PHASE 4: LEAD HANDOFF & NOTIFICATIONS**

1. **The "Hand-Off" (Resend/Twilio):**  
   * Once the lead is saved in Prisma, fire an email to the `ShopClient.ownerEmail`.  
   * **Email Content:** Provide the Customer's Name, Preferred Contact Method (Call/Email), the 17-digit VIN, the decoded NHTSA vehicle data (Year/Make/Model), the exact JTC labor quote, the requested drop-off date (if applicable), and the full OEM Parts Pull-Sheet so the shop can accurately order the parts and follow up.

---

# **PHASE 5: THE MARKETING-AS-A-SERVICE PORTAL**

1. **Admin Dashboard (`app/admin/[shopId]/page.tsx`):**  
   * Build a portal where the shop owner can log in.  
2. **Shop Preferences & Campaign Manager:**  
   * Allow the shop to set their `schedulingRule` (Same Day, 24 Hours Out, Disabled).  
   * Allow the shop to activate a "Monthly Special" (e.g., Audio Upgrade) and set the `totalCapacity`. The widget automatically routes active specials through the Standard Service scheduling track since parts are pre-stocked.

---

# **DIRECTORY STRUCTURE MAPPING**

```
    /leads/route.ts           # Phase 4: Handoff & Notification Logic
  /admin
    page.tsx                  # Phase 5: Shop Owner Portal & Campaigns
/lib
  quoteEngine.ts              # Phase 2: The Two-Speed Engine
/prisma
  schema.prisma               # Phase 1: DB Specs
```

