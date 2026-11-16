# **SYSTEM ARCHITECTURE & DATA SPECIFICATION**

**Project Name:** Moto WaaS Embed Widget (Virtual Service Writer)  
**Objective:** Deliver an embeddable React widget that lives on independent motorcycle shop websites. The widget acts as an intelligent digital intake counter, computing mathematically verified repair quotes, setting realistic service expectations (Two-Speed Scheduling), and capturing leads via Clerk SSO.

# **1\. THE "TOP-OF-FUNNEL" LEAD CONVERSION ARCHITECTURE**

The system operates as a unified lead capture and expectation-setting engine. It is strictly an intake tool designed to get riders from the internet to the shop's door, leaving payment and deep calendar integration to the shop's existing OS.

* **The Value Prop (Consumer):** Frictionless quote generation using Apple/Google SSO, transparent breakdown of labor and parts, and clear communication on timelines.  
* **The Value Prop (Shop):** Zero upfront scheduling headaches and no forced payment processing. The widget captures the lead, sets the timeline expectation, and emails the complete JSON/PDF payload to the shop for follow-up on their terms.  
* **Monetization Engine:** High-margin setup fee for the widget \+ Monthly Retainer for access to the JTC Logic Engine and Campaign specials.

# **2\. CORE FEATURES & LOGIC**

## **A. Clerk SSO Lead Capture**

1. To remove friction, the widget uses Clerk for authentication.  
2. Users click **"Continue with Apple/Google"**.  
3. The system automatically captures `customerName`, `customerEmail`, and requests the `customerPhone` and `preferredContactMethod` (Call/Email) in one screen.

## **B. Vehicle Identification (NHTSA API Integration)**

* The widget requires precise vehicle data to accurately route the JTC logic and parts pulling.  
* **Input Paths:** Users can manually select Year/Make/Model, or input a 17-digit VIN (Recommended).  
* **NHTSA vPIC Decoder:** If a VIN is provided, the Next.js backend queries the free National Highway Traffic Safety Administration (NHTSA) API (`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/{VIN}?format=json`).  
* **Extraction:** The system extracts the `ModelYear`, `Make`, `Model`, and `DisplacementCC` to perfectly map the motorcycle to the Flat Rate Master catalogs before generating the quote, eliminating customer guessing errors.

## **C. Age-Scaled Labor Math (Variable Retail Rates)**

* To account for increased labor complexity and frozen/weathered hardware on older motorcycles, labor estimates automatically scale based on the `ModelYear` decoded from the NHTSA API:  
* **0 to 10 Years Old:** Applies a **1.5x** Warranty time multiplier.  
* **10 to 20 Years Old:** Applies a **2.0x** Warranty time multiplier.  
* **20 to 25 Years Old:** Applies a **2.25x** Warranty time multiplier.

## **D. The Two-Speed Scheduling Engine**

* The Logic Engine categorizes repairs into two distinct tracks. Simple scheduling is offered *only* for standard services and active specials, dictated by lightweight shop preferences.

### **Track 1: "Standard Service" Fast Track**

* **Triggers:** Routine jobs with standard consumables (e.g., Oil changes, Brake Pads, Fork Seals).  
* **Expectation Pitch:** *"This is a standard service. Based on the \$120/hr labor rate, this will cost approximately \$180 plus fluids. {ShopName} usually stocks these items."*  
* **Scheduling:** The widget offers lightweight appointment requests based on the shop's config (e.g., `SAME_DAY_UNTIL_1PM`, `MIN_24_HOURS`, or `DISABLED`).  
* **Action:** Captures the lead, the preferred date/time, and emails the customer's info, the 17-digit VIN, the decoded NHTSA vehicle data, and the quote payload to the shop to confirm the drop-off.

### **Track 2: "Parts Required" Heavy Repair (The Expectation Setter)**

* **Triggers:** High-tier jobs (Stators, Cam Chests, Handlebars) AND Tires (classified as special order).  
* **Expectation Pitch:** *"This repair requires ordering specific OEM gaskets, custom components, or tires. Custom parts typically take 7 to 10 days to ship. Submit your request, and {ShopName} will contact you to secure the parts and schedule your priority lift time."*  
* **Action:** Captures the lead without a booking calendar, sets status to `WAITING_ON_PARTS`, and emails the exact parts pull-sheet, the 17-digit VIN, and the decoded NHTSA vehicle data to the shop to order and follow up.

## **E. Monthly Opt-In Specials (Marketing-as-a-Service)**

* **Mechanism:** Shops opt into monthly campaigns from their admin portal (e.g., "Winter Stator Upgrade").  
* **Scheduling:** Treated like Track 1 (Standard Service) because the shop has pre-stocked the items for the special.  
* **Inventory Limit:** Shops set a hard `campaignCapacity` (e.g., 3 available).  
* **Widget UI:** Displays a live countdown on the shop's site (*"Only 2 upgrades remaining\!"*).  
* **Fallback:** Once capacity is hit, the CTA flips to *"Join Waitlist for Next Batch."*

---

# **3\. DATABASE SCHEMA UPDATES (PRISMA)**

```
// -----------------------------------------------------
// 1. SHOP CLIENTS (The Paying Subscribers)
// -----------------------------------------------------
model ShopClient {
  id                 String             @id @default(uuid())
  shopName           String             // e.g., "Nashville V-Twin Works"
  hourlyRate         Float              // e.g., 120.00
  ownerEmail         String
  ownerPhone         String
  
  // Widget Config
  allowedOrigin      String             @unique // The URL where the widget is allowed to load
  themeColorHex      String             @default("#000000")
  schedulingRule     SchedulePref       @default(MIN_24_HOURS)
  
  // Relations
  capturedLeads      ShopLead[]
  activeCampaigns    Campaign[]
}
enum SchedulePref {
  SAME_DAY_UNTIL_1PM
  MIN_24_HOURS
  DISABLED
}

// -----------------------------------------------------
// 2. CAMPAIGNS (Monthly Specials)
// -----------------------------------------------------
model Campaign {
  id                 String             @id @default(uuid())
  shopId             String
  shop               ShopClient         @relation(fields: [shopId], references: [id])
  title              String             // e.g., "Winter Stator Upgrade"
  totalCapacity      Int                // e.g., 3
  currentClaimed     Int                @default(0)
  isActive           Boolean            @default(true)
}

// -----------------------------------------------------
// 3. SHOP LEADS & REPAIR ORDERS
// -----------------------------------------------------
model ShopLead {
  id                 String             @id @default(uuid())
  shopId             String
  shop               ShopClient         @relation(fields: [shopId], references: [id])
  
  // Clerk Auth Data
  clerkUserId        String
  customerName       String
  customerPhone      String
  customerEmail      String
  preferredContact   ContactMethod      // Enum: CALL, EMAIL
  
  // Vehicle Data
  vin                String?            // Optional 17-digit VIN
  vehicleYear        Int?
  vehicleMake        String?
  vehicleModel       String?
  vehicleInfo        String             // e.g., "2014 FLHX Street Glide" (Concatenated)
  
  // Computed Engine Data
  totalLaborHours    Float
  shopTotalLaborCost Float              
  serviceTrack       ServiceTrack       // Enum: STANDARD_SERVICE, PARTS_REQUIRED
  unredactedPayload  Json               
  
  // Status Tracking
  requestedDate      DateTime?          // Populated for Track 1 scheduling
  status             LeadStatus         @default(PENDING_SHOP_CONTACT)
  createdAt          DateTime           @default(now())
}

enum ContactMethod {
  CALL
  EMAIL
}

enum ServiceTrack {
  STANDARD_SERVICE
  PARTS_REQUIRED
}

enum LeadStatus {
  PENDING_SHOP_CONTACT
  WAITING_ON_PARTS
  SCHEDULED
  COMPLETED
}
```

