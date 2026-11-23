import {
  BusinessCategoryDefinition,
  CapabilityId,
  LanguageCode,
  PaymentProviderId,
  WebsiteTemplateDefinition,
  WebsiteTemplateId,
} from '../types/amal';

export const UNIVERSAL_CAPABILITIES: CapabilityId[] = [
  'digital_menu',
  'qr_codes',
  'online_ordering',
  'payments',
  'customer_crm',
  'analytics',
  'website_builder',
  'promotions',
  'staff_management',
  'multi_branch',
];

export const CAPABILITY_LABELS: Record<
  CapabilityId,
  { label: string; scope: 'Universal' | 'Adaptive'; summary: string }
> = {
  digital_menu: {
    label: 'Digital Menus & Variations',
    scope: 'Universal',
    summary: 'Structured categories, variations, required/optional modifiers, and pricing.',
  },
  qr_codes: {
    label: 'QR Code Studio',
    scope: 'Universal',
    summary: 'Instant table, room, counter, and pickup QR cards with live scan routing.',
  },
  online_ordering: {
    label: 'Multi-Workflow Ordering',
    scope: 'Universal',
    summary: 'Dine-in, takeaway, delivery, room service, and pre-order checkout.',
  },
  payments: {
    label: 'Ethiopian & Global Payments',
    scope: 'Universal',
    summary: 'Telebirr, CBE Birr, Chapa, Cash, and Room Charge billing support.',
  },
  customer_crm: {
    label: 'Customer Directory',
    scope: 'Universal',
    summary: 'Phone-first guest records, order history, and WhatsApp follow-ups.',
  },
  analytics: {
    label: 'Operations Analytics',
    scope: 'Universal',
    summary: 'Revenue in ETB, channel splits, top items, and prep-time pacing.',
  },
  website_builder: {
    label: 'Adaptive Website Builder',
    scope: 'Universal',
    summary: 'Industry-tailored storefront templates with live section customization.',
  },
  promotions: {
    label: 'Promotions & Combos',
    scope: 'Universal',
    summary: 'Seasonal bundles, fasting specials, and happy-hour pricing rules.',
  },
  staff_management: {
    label: 'Staff & Outlet Roles',
    scope: 'Universal',
    summary: 'Managers, baristas, kitchen staff, and floor servers assigned per outlet.',
  },
  multi_branch: {
    label: 'Multi-Branch Architecture',
    scope: 'Universal',
    summary: 'Manage multiple Addis Ababa or regional locations under one brand.',
  },
  table_management: {
    label: 'Table & Floor Management',
    scope: 'Adaptive',
    summary: 'Track table occupancy, party capacity, and direct table QR ordering.',
  },
  table_reservations: {
    label: 'Table Reservations',
    scope: 'Adaptive',
    summary: 'Accept and confirm evening dining and group table bookings.',
  },
  beverage_modifiers: {
    label: 'Cup Sizes, Milks & Syrups',
    scope: 'Adaptive',
    summary: 'Required cup size selectors plus oat/almond milk and syrup add-ons.',
  },
  coffee_loyalty: {
    label: 'Coffee Stamp Loyalty',
    scope: 'Adaptive',
    summary: 'Phone-linked digital punch cards rewarding repeat morning guests.',
  },
  multi_outlet: {
    label: 'Multi-Outlet Dining',
    scope: 'Adaptive',
    summary: 'Separate restaurant, lobby café, bar, and breakfast menus under one property.',
  },
  room_service: {
    label: 'In-Room QR Ordering',
    scope: 'Adaptive',
    summary: 'Room-number verification, tray delivery tracking, and charge-to-room.',
  },
  pms_bridge: {
    label: 'Hotel PMS Integration Hooks',
    scope: 'Adaptive',
    summary: 'API webhook contract ready for Opera, Cloudbeds, or local hotel PMS folio sync.',
  },
  ingredient_builder: {
    label: 'Custom Fruit & Add-On Builder',
    scope: 'Adaptive',
    summary: 'Layered spris combinations, fresh juice bases, and booster add-ins.',
  },
  batch_availability: {
    label: 'Real-Time Batch Stock',
    scope: 'Adaptive',
    summary: 'Instant stock counters and one-tap sold-out switches for fresh daily items.',
  },
  combo_builder: {
    label: 'Combo Meal Configurator',
    scope: 'Adaptive',
    summary: 'Required side + drink pairing workflows for high-speed burger and pizza orders.',
  },
  kitchen_display: {
    label: 'Kitchen Order Queue (KDS)',
    scope: 'Adaptive',
    summary: 'High-contrast ticket board tracking prep timers and ready-for-pickup states.',
  },
  pre_orders: {
    label: 'Scheduled Pickup & Pre-Orders',
    scope: 'Adaptive',
    summary: 'Lead-time rules and timed pickup slots for loaves, boxes, and catering.',
  },
  custom_cake_requests: {
    label: 'Custom Cake Inquiry Desk',
    scope: 'Adaptive',
    summary: 'Structured flavor, tier weight, inscription, and celebration date intake.',
  },
  fasting_menu_mode: {
    label: 'Fasting (Tsom) Menu Mode',
    scope: 'Adaptive',
    summary: 'One-click filter highlighting vegan/fasting dishes for Ethiopian Orthodox fasting days.',
  },
  coffee_ceremony: {
    label: 'Ethiopian Coffee Ceremony',
    scope: 'Adaptive',
    summary: 'Bookable Abol-Tona-Bereka Jebena Buna service with Kolo and frankincense.',
  },
  bilingual_menu: {
    label: 'Multilingual Menu Engine',
    scope: 'Adaptive',
    summary: 'Instant English, Amharic (አማርኛ), and Afaan Oromo menu & UI switching.',
  },
};

export const BUSINESS_CATEGORY_REGISTRY: BusinessCategoryDefinition[] = [
  {
    id: 'restaurant',
    name: { en: 'Restaurants', am: 'ሬስቶራንቶች', om: 'Mana Nyaataa' },
    shortLabel: 'Restaurants',
    tagline: 'Table QR menus, dine-in, takeaway, delivery & reservations',
    description:
      'Built for full-service bistros, grills, and dining rooms needing floor table management, reservations, and multi-channel ordering.',
    defaultTemplate: 'fine_dining',
    recommendedCapabilities: [
      'table_management',
      'table_reservations',
      'kitchen_display',
      'bilingual_menu',
    ],
    defaultWorkflows: ['dine_in', 'takeaway', 'delivery'],
    onboardingRecommendations: [
      'Table QR cards mapped to Tables T1–T12',
      'Dine-in, Takeaway & Delivery order routing',
      'Evening table reservation request desk',
    ],
    defaultQrTargetLabel: 'Dining Table',
  },
  {
    id: 'coffee_house',
    name: { en: 'Coffee Houses & Cafés', am: 'የቡና ቤቶችና ካፌዎች', om: 'Mana Bunaa fi Kaaffee' },
    shortLabel: 'Coffee Houses',
    tagline: 'Cup sizes, milk alternatives, syrups, pastries & loyalty stamps',
    description:
      'Designed for specialty roasteries, espresso bars, and neighborhood cafés prioritizing rapid drink customization and repeat-guest loyalty.',
    defaultTemplate: 'coffee_house',
    recommendedCapabilities: [
      'beverage_modifiers',
      'coffee_loyalty',
      'batch_availability',
      'bilingual_menu',
    ],
    defaultWorkflows: ['takeaway', 'dine_in'],
    onboardingRecommendations: [
      'Cup size variations (Sini / Regular / Large)',
      'Milk alternative & syrup modifier groups',
      '8-stamp coffee loyalty card linked to phone number',
    ],
    defaultQrTargetLabel: 'Counter / Café Table',
  },
  {
    id: 'hotel',
    name: { en: 'Hotels & Hospitality', am: 'ሆቴሎችና መስተንግዶ', om: 'Hoteelotaa fi Keessummeessuu' },
    shortLabel: 'Hotels',
    tagline: 'Multi-outlet dining, breakfast, bar & room-number QR ordering',
    description:
      'Coordinates separate dining outlets, 24-hour room service, breakfast menus, and PMS integration hooks without forcing a heavy property PMS.',
    defaultTemplate: 'hotel_hospitality',
    recommendedCapabilities: [
      'multi_outlet',
      'room_service',
      'pms_bridge',
      'table_reservations',
      'bilingual_menu',
    ],
    defaultWorkflows: ['room_service', 'dine_in', 'takeaway'],
    onboardingRecommendations: [
      'Separate Dining, Lounge Bar, Breakfast & Room Service outlets',
      'In-room QR cards with Room Number validation & Charge-to-Room',
      'PMS Webhook & Folio Bridge ready for future property sync',
    ],
    defaultQrTargetLabel: 'Guest Room / Outlet',
  },
  {
    id: 'juice_bar',
    name: { en: 'Juice Shops & Smoothie Bars', am: 'የጁስና ስሙዚ ቤቶች', om: 'Mana Cuunfaa fi Ismuuzii' },
    shortLabel: 'Juice & Smoothie',
    tagline: 'Fresh spris layers, custom fruit combos, sizes & add-ons',
    description:
      'Tailored for fresh juice counters and Ethiopian spris bars managing daily fruit batch stock, custom blends, and wellness add-ons.',
    defaultTemplate: 'juice_bar',
    recommendedCapabilities: [
      'ingredient_builder',
      'beverage_modifiers',
      'batch_availability',
    ],
    defaultWorkflows: ['takeaway', 'dine_in', 'delivery'],
    onboardingRecommendations: [
      'Layered Spris & custom fruit combination modifiers',
      '350ml / 500ml / 750ml size pricing variations',
      'One-tap batch availability switches for seasonal fruits',
    ],
    defaultQrTargetLabel: 'Juice Counter',
  },
  {
    id: 'fast_food',
    name: { en: 'Fast-Food Businesses', am: 'ፈጣን ምግብ ቤቶች', om: 'Nyaata Ariifachiisaa' },
    shortLabel: 'Fast Food',
    tagline: 'Burgers, pizza, fried chicken, combo meals & kitchen display',
    description:
      'Engineered for high-throughput quick-service kitchens with combo meal builders, required side/drink selections, and live KDS prep tracking.',
    defaultTemplate: 'fast_food',
    recommendedCapabilities: [
      'combo_builder',
      'kitchen_display',
      'batch_availability',
    ],
    defaultWorkflows: ['takeaway', 'delivery', 'dine_in'],
    onboardingRecommendations: [
      'Combo meal configurator with required drink & side choices',
      'Live Kitchen Order Display (KDS) with prep timers',
      'Express pickup & local delivery checkout',
    ],
    defaultQrTargetLabel: 'Express Pickup Counter',
  },
  {
    id: 'bakery',
    name: { en: 'Bakeries & Pastry Shops', am: 'ዳቦ ቤቶችና ኬክ ቤቶች', om: 'Mana Daabboo fi Keekii' },
    shortLabel: 'Bakeries',
    tagline: 'Daily batch stock, pre-orders, custom cakes & pickup slots',
    description:
      'Built for artisan bakeries and patisseries managing morning oven stock counts, scheduled pickup windows, and bespoke celebration cake requests.',
    defaultTemplate: 'bakery_patisserie',
    recommendedCapabilities: [
      'batch_availability',
      'pre_orders',
      'custom_cake_requests',
    ],
    defaultWorkflows: ['pre_order', 'takeaway', 'delivery'],
    onboardingRecommendations: [
      'Real-time daily batch inventory & sold-out protection',
      'Scheduled pickup date & time window selector',
      'Custom Celebration Cake request form with tier & inscription fields',
    ],
    defaultQrTargetLabel: 'Bakery Pickup Window',
  },
  {
    id: 'traditional_ethiopian',
    name: { en: 'Traditional Ethiopian Dining', am: 'ባህላዊ የኢትዮጵያ ምግብ ቤቶች', om: 'Nyaata Aadaa Itoophiyaa' },
    shortLabel: 'Ethiopian Dining',
    tagline: 'Injera platters, Tsom fasting mode, regional dishes & Buna ceremony',
    description:
      'Celebrates Ethiopian culinary heritage with regional categories, Orthodox fasting (Tsom) menu toggles, Amharic/Afaan Oromo menus, and Jebena Buna ceremonies.',
    defaultTemplate: 'traditional_ethiopian',
    recommendedCapabilities: [
      'fasting_menu_mode',
      'coffee_ceremony',
      'bilingual_menu',
      'table_management',
      'table_reservations',
    ],
    defaultWorkflows: ['dine_in', 'takeaway', 'delivery'],
    onboardingRecommendations: [
      'Bilingual English, አማርኛ & Afaan Oromo menu structure',
      'One-click Tsom (Fasting) menu filter for Wednesday/Friday & fasting seasons',
      'Jebena Buna Coffee Ceremony booking & Mesob group platters',
    ],
    defaultQrTargetLabel: 'Mesob Table',
  },
];

export const WEBSITE_TEMPLATE_REGISTRY: Record<WebsiteTemplateId, WebsiteTemplateDefinition> = {
  traditional_ethiopian: {
    id: 'traditional_ethiopian',
    name: 'Heritage Mesob & Buna',
    suitedFor: ['traditional_ethiopian', 'restaurant'],
    description:
      'Warm woven-earth editorial layout honoring Ethiopian culinary heritage, fasting menu callouts, and coffee ceremony storytelling.',
    heroImage: '/src/assets/images/hero_ethiopian_dining_1795378595732.jpg',
    surfaceMode: 'warm',
    accentHex: '#8C3B24',
    typographyStyle: 'editorial',
    defaultSections: [
      'hero',
      'fasting_banner',
      'featured_menu',
      'full_catalog',
      'coffee_ceremony_showcase',
      'story_heritage',
      'branch_hours',
    ],
  },
  coffee_house: {
    id: 'coffee_house',
    name: 'Origin Roastery Bar',
    suitedFor: ['coffee_house', 'bakery'],
    description:
      'Sunlit travertine aesthetic crafted for specialty Ethiopian coffee houses with rapid drink customization and loyalty stamp visibility.',
    heroImage: '/src/assets/images/hero_coffee_house_1795378597842.jpg',
    surfaceMode: 'warm',
    accentHex: '#5C3A21',
    typographyStyle: 'geometric',
    defaultSections: [
      'hero',
      'featured_menu',
      'full_catalog',
      'loyalty_card',
      'branch_hours',
    ],
  },
  fine_dining: {
    id: 'fine_dining',
    name: 'Architectural Bistro',
    suitedFor: ['restaurant', 'hotel'],
    description:
      'Refined evening dining canvas with balanced editorial proportions, sommelier/pairing notes, and instant table booking.',
    heroImage: '/src/assets/images/hero_fine_restaurant_1795378597745.jpg',
    surfaceMode: 'dark',
    accentHex: '#B4833E',
    typographyStyle: 'editorial',
    defaultSections: [
      'hero',
      'featured_menu',
      'full_catalog',
      'table_reservation',
      'branch_hours',
    ],
  },
  hotel_hospitality: {
    id: 'hotel_hospitality',
    name: 'Grand Courtyard & Outlets',
    suitedFor: ['hotel', 'restaurant'],
    description:
      'Multi-outlet hospitality showcase allowing guests to switch effortlessly between Room Service, Terrace Dining, Breakfast, and Lounge Bar.',
    heroImage: '/src/assets/images/hero_hotel_hospitality_1795378596244.jpg',
    surfaceMode: 'light',
    accentHex: '#0F4C3A',
    typographyStyle: 'editorial',
    defaultSections: [
      'hero',
      'outlet_switcher',
      'featured_menu',
      'full_catalog',
      'table_reservation',
      'branch_hours',
    ],
  },
  juice_bar: {
    id: 'juice_bar',
    name: 'Sunburst Spris & Fresh',
    suitedFor: ['juice_bar'],
    description:
      'Bright, crisp daylight layout spotlighting layered Ethiopian spris combinations, fresh fruit availability, and custom add-ons.',
    heroImage: '/src/assets/images/hero_juice_smoothie_1795378596702.jpg',
    surfaceMode: 'light',
    accentHex: '#15803D',
    typographyStyle: 'geometric',
    defaultSections: ['hero', 'featured_menu', 'full_catalog', 'branch_hours'],
  },
  fast_food: {
    id: 'fast_food',
    name: 'Urban Express Kitchen',
    suitedFor: ['fast_food'],
    description:
      'High-contrast rapid-order storefront built around combo meal builders, kitchen prep estimates, and express pickup.',
    heroImage: '/src/assets/images/hero_fast_food_1795378596935.jpg',
    surfaceMode: 'dark',
    accentHex: '#DC2626',
    typographyStyle: 'athletic',
    defaultSections: ['hero', 'featured_menu', 'full_catalog', 'branch_hours'],
  },
  bakery_patisserie: {
    id: 'bakery_patisserie',
    name: 'Morning Oven & Patisserie',
    suitedFor: ['bakery', 'coffee_house'],
    description:
      'Soft limestone bakery showcase featuring live oven batch counts, scheduled pre-order pickup windows, and bespoke cake requests.',
    heroImage: '/src/assets/images/hero_bakery_pastry_1795378596648.jpg',
    surfaceMode: 'warm',
    accentHex: '#9A5B25',
    typographyStyle: 'editorial',
    defaultSections: [
      'hero',
      'featured_menu',
      'full_catalog',
      'custom_cake_form',
      'branch_hours',
    ],
  },
};

export const PAYMENT_PROVIDERS: Record<
  PaymentProviderId,
  { name: string; localLabel: string; description: string }
> = {
  telebirr: {
    name: 'Telebirr',
    localLabel: 'ቴሌብር',
    description: 'Instant Ethio Telecom mobile wallet checkout',
  },
  cbe_birr: {
    name: 'CBE Birr',
    localLabel: 'CBE ብር',
    description: 'Commercial Bank of Ethiopia mobile pay',
  },
  chapa: {
    name: 'Chapa',
    localLabel: 'Chapa Pay',
    description: 'Cards, Telebirr & Ethiopian bank gateway',
  },
  cash: {
    name: 'Cash / Pay on Pickup',
    localLabel: 'በጥሬ ገንዘብ',
    description: 'Pay at the table, counter, or upon delivery',
  },
  room_charge: {
    name: 'Charge to Hotel Room',
    localLabel: 'ወደ ክፍል ሂሳብ',
    description: 'Post directly to guest folio (Hotels only)',
  },
};

export const I18N_UI: Record<
  LanguageCode,
  {
    menu: string;
    featured: string;
    orderNow: string;
    addToOrder: string;
    cart: string;
    checkout: string;
    total: string;
    fastingFilter: string;
    fastingActiveNote: string;
    fastingBannerTitle: string;
    fastingBannerDesc: string;
    allItems: string;
    soldOut: string;
    preOrderOnly: string;
    lowStock: string;
    required: string;
    optional: string;
    chooseOption: string;
    whatsappOrder: string;
    placeOrder: string;
    dineIn: string;
    takeaway: string;
    delivery: string;
    roomService: string;
    preOrder: string;
    lowBandwidth: string;
    reserveTable: string;
    customCake: string;
    coffeeCeremony: string;
    loyaltyTitle: string;
    selectOutlet: string;
    editWorkspace: string;
    submitRequest: string;
    remove: string;
    yourName: string;
    yourPhone: string;
    paymentMethod: string;
    orderWorkflow: string;
    storyHeritageTitle: string;
    storyHeritageBody: string;
    prepTime: string;
    emptyCart: string;
  }
> = {
  en: {
    menu: 'Menu',
    featured: 'Signature Selection',
    orderNow: 'Order Now',
    addToOrder: 'Add to Order',
    cart: 'Your Order',
    checkout: 'Complete Order',
    total: 'Total',
    fastingFilter: 'Fasting (Tsom) Only',
    fastingActiveNote: 'Showing plant-based Ethiopian Orthodox fasting selections',
    fastingBannerTitle: 'Ethiopian Orthodox Fasting (Tsom) Menu Support',
    fastingBannerDesc: 'Filter plant-based dishes prepared with zero dairy, meat, or butter.',
    allItems: 'All Categories',
    soldOut: 'Sold Out',
    preOrderOnly: 'Pre-Order',
    lowStock: 'left today',
    required: 'Required',
    optional: 'Optional',
    chooseOption: 'Customize & Add',
    whatsappOrder: 'Send via WhatsApp',
    placeOrder: 'Confirm Order',
    dineIn: 'Dine-In',
    takeaway: 'Takeaway',
    delivery: 'Delivery',
    roomService: 'Room Service',
    preOrder: 'Scheduled Pre-Order',
    lowBandwidth: 'Lite Mode',
    reserveTable: 'Reserve a Table',
    customCake: 'Request Custom Cake',
    coffeeCeremony: 'Book Coffee Ceremony',
    loyaltyTitle: 'Coffee Loyalty Pass',
    selectOutlet: 'Select Dining Outlet / Department',
    editWorkspace: 'Edit in AMAL Workspace',
    submitRequest: 'Submit Request',
    remove: 'Remove',
    yourName: 'Your Name',
    yourPhone: 'Phone (+251 9...)',
    paymentMethod: 'Payment Method (ETB)',
    orderWorkflow: 'Order Workflow',
    storyHeritageTitle: 'Culinary Craft & Regional Heritage',
    storyHeritageBody:
      'Every dish and roast honors Ethiopian regional sourcing — stone-milled teff, heirloom Jimma and Yirgacheffe coffee, and house-blended berbere.',
    prepTime: 'min prep',
    emptyCart: 'Your order is empty. Select any item from the menu to customize and add.',
  },
  am: {
    menu: 'ሜኑ',
    featured: 'ተመራጭ ምግቦችና መጠጦች',
    orderNow: 'አሁን ይዘዙ',
    addToOrder: 'ወደ ትዕዛዝ ጨምር',
    cart: 'የእርስዎ ትዕዛዝ',
    checkout: 'ትዕዛዝ ያጠናቅቁ',
    total: 'ጠቅላላ',
    fastingFilter: 'የጾም ምግቦች ብቻ',
    fastingActiveNote: 'የጾም ምግቦችና መጠጦች ብቻ እየታዩ ነው',
    fastingBannerTitle: 'የኢትዮጵያ ኦርቶዶክስ የጾም ሜኑ',
    fastingBannerDesc: 'ያለ ቅቤ፣ ወተትና ስጋ የተዘጋጁ የጾም ምግቦችን ብቻ ይመልከቱ።',
    allItems: 'ሁሉም ምድቦች',
    soldOut: 'አልቋል',
    preOrderOnly: 'ቅድመ-ትዕዛዝ',
    lowStock: 'ቀርቷል',
    required: 'ግዴታ',
    optional: 'አማራጭ',
    chooseOption: 'አስተካክለው ይዘዙ',
    whatsappOrder: 'በዋትስአፕ ይላኩ',
    placeOrder: 'ትዕዛዝ አረጋግጥ',
    dineIn: 'በቦታው መመገብ',
    takeaway: 'ይዞ መሄድ',
    delivery: 'ማድረስ',
    roomService: 'የክፍል አገልግሎት',
    preOrder: 'ቅድመ-ትዕዛዝ',
    lowBandwidth: 'ቀላል ሁነታ',
    reserveTable: 'ጠረጴዛ ያስይዙ',
    customCake: 'ልዩ ኬክ ይዘዙ',
    coffeeCeremony: 'የቡና ሥነ-ሥርዓት',
    loyaltyTitle: 'የቡና ታማኝነት ካርድ',
    selectOutlet: 'መመገቢያ ክፍል ይምረጡ',
    editWorkspace: 'በAMAL ዳሽቦርድ ያስተካክሉ',
    submitRequest: 'ጥያቄ ይላኩ',
    remove: 'አስወግድ',
    yourName: 'ስምዎ',
    yourPhone: 'ስልክ (+251 9...)',
    paymentMethod: 'የክፍያ ዘዴ (ETB)',
    orderWorkflow: 'የትዕዛዝ አይነት',
    storyHeritageTitle: 'ባህላዊ ጥበብና የአካባቢ ምርቶች',
    storyHeritageBody:
      'እያንዳንዱ ምግብና ቡና ከጅማና ይርጋጨፌ በቀጥታ ከተገኘ ጥራት ያለው ምርትና በቤት ውስጥ ከተዘጋጀ ቅመም ይሰራል።',
    prepTime: 'ደቂቃ ዝግጅት',
    emptyCart: 'ትዕዛዝዎ ባዶ ነው። ከሜኑ ውስጥ ምግብ ወይም መጠጥ ይምረጡ።',
  },
  om: {
    menu: 'Meenuu',
    featured: 'Filannoo Addaa',
    orderNow: 'Amma Ajajaa',
    addToOrder: 'Ajajatti Dabali',
    cart: 'Ajaja Keessan',
    checkout: 'Ajaja Xumuri',
    total: 'Waliigala',
    fastingFilter: 'Nyaata Soomaa Qofa',
    fastingActiveNote: 'Nyaataa fi dhugaatii soomaa qofa agarsiisaa jira',
    fastingBannerTitle: 'Meenuu Nyaata Soomaa',
    fastingBannerDesc: 'Nyaata dhadhaa, aannanii fi foon irraa bilisa taʼan qofa calali.',
    allItems: 'Gosa Hunda',
    soldOut: 'Dhumee Jira',
    preOrderOnly: 'Dursee Ajajuu',
    lowStock: 'hafe',
    required: 'Dirqama',
    optional: 'Filannoo',
    chooseOption: 'Filadhuu Dabali',
    whatsappOrder: 'WhatsApp tiin Ergi',
    placeOrder: 'Ajaja Mirkaneessi',
    dineIn: 'Asitti Nyaachuu',
    takeaway: 'Fudhatanii Deemuu',
    delivery: 'Geejjibaa',
    roomService: 'Tajaajila Kutaa',
    preOrder: 'Dursee Ajajuu',
    lowBandwidth: 'Haala Salphaa',
    reserveTable: 'Minjaala Qabadhu',
    customCake: 'Keekii Addaa Gaafadhu',
    coffeeCeremony: 'Sirna Bunaa Qabadhu',
    loyaltyTitle: 'Kaardii Amanamummaa Bunaa',
    selectOutlet: 'Kutaa Nyaataa Filadhu',
    editWorkspace: 'AMAL keessatti Gulaali',
    submitRequest: 'Gaaffii Ergi',
    remove: 'Haqi',
    yourName: 'Maqaa Keessan',
    yourPhone: 'Bilbila (+251 9...)',
    paymentMethod: 'Mala Kaffaltii (ETB)',
    orderWorkflow: 'Haala Ajajaa',
    storyHeritageTitle: 'Aadaa Nyaataa fi Oomisha Naannoo',
    storyHeritageBody:
      'Nyaanni fi bunni keenya hundi xaafii qulqulluu fi buna Jimmaa fi Yirgaacaffee qophaaʼe irraa hojjetama.',
    prepTime: 'daqiiqaa qophii',
    emptyCart: 'Ajajni keessan duwwaa dha. Meenuu irraa filadhaa dabalaa.',
  },
};

export function formatEtb(amount: number): string {
  return `${amount.toLocaleString('en-US')} ETB`;
}
