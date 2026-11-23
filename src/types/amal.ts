export type LanguageCode = 'en' | 'am' | 'om';

export type BusinessTypeId =
  | 'restaurant'
  | 'coffee_house'
  | 'hotel'
  | 'juice_bar'
  | 'fast_food'
  | 'bakery'
  | 'traditional_ethiopian';

export type CapabilityId =
  // Universal capabilities
  | 'digital_menu'
  | 'qr_codes'
  | 'online_ordering'
  | 'payments'
  | 'customer_crm'
  | 'analytics'
  | 'website_builder'
  | 'promotions'
  | 'staff_management'
  | 'multi_branch'
  // Adaptive category capabilities
  | 'table_management'
  | 'table_reservations'
  | 'beverage_modifiers'
  | 'coffee_loyalty'
  | 'multi_outlet'
  | 'room_service'
  | 'pms_bridge'
  | 'ingredient_builder'
  | 'batch_availability'
  | 'combo_builder'
  | 'kitchen_display'
  | 'pre_orders'
  | 'custom_cake_requests'
  | 'fasting_menu_mode'
  | 'coffee_ceremony'
  | 'bilingual_menu';

export type OrderingWorkflow =
  | 'dine_in'
  | 'takeaway'
  | 'delivery'
  | 'room_service'
  | 'pre_order';

export type WebsiteTemplateId =
  | 'fine_dining'
  | 'traditional_ethiopian'
  | 'coffee_house'
  | 'hotel_hospitality'
  | 'juice_bar'
  | 'fast_food'
  | 'bakery_patisserie';

export type PaymentProviderId =
  | 'telebirr'
  | 'cbe_birr'
  | 'chapa'
  | 'cash'
  | 'room_charge';

export interface LocalizedText {
  en: string;
  am?: string;
  om?: string;
}

export interface BusinessCategoryDefinition {
  id: BusinessTypeId;
  name: LocalizedText;
  shortLabel: string;
  tagline: string;
  description: string;
  defaultTemplate: WebsiteTemplateId;
  recommendedCapabilities: CapabilityId[];
  defaultWorkflows: OrderingWorkflow[];
  onboardingRecommendations: string[];
  defaultQrTargetLabel: string;
}

export interface WebsiteTemplateDefinition {
  id: WebsiteTemplateId;
  name: string;
  suitedFor: BusinessTypeId[];
  description: string;
  heroImage: string;
  surfaceMode: 'light' | 'warm' | 'dark';
  accentHex: string;
  typographyStyle: 'editorial' | 'geometric' | 'athletic';
  defaultSections: WebsiteSectionKey[];
}

export type WebsiteSectionKey =
  | 'hero'
  | 'fasting_banner'
  | 'outlet_switcher'
  | 'featured_menu'
  | 'full_catalog'
  | 'coffee_ceremony_showcase'
  | 'custom_cake_form'
  | 'table_reservation'
  | 'loyalty_card'
  | 'story_heritage'
  | 'branch_hours';

export interface Branch {
  id: string;
  name: string;
  city: string;
  neighborhood: string;
  phone: string;
  whatsappNumber: string;
  hours: string;
}

export interface Outlet {
  id: string;
  branchId: string;
  name: LocalizedText;
  outletKind: 'dining_room' | 'cafe_counter' | 'room_service' | 'bar_lounge' | 'bakery_pickup' | 'juice_bar' | 'kitchen_express' | 'cultural_hall';
  description: string;
  supportsTables: boolean;
  supportsRoomService: boolean;
  active: boolean;
}

export interface MenuCategory {
  id: string;
  outletId: string;
  name: LocalizedText;
  description?: LocalizedText;
  regionalOrigin?: string;
  isFastingFriendly?: boolean;
  sortOrder: number;
}

export interface ProductVariation {
  id: string;
  name: LocalizedText;
  priceDeltaEtb: number;
  sku?: string;
}

export interface ModifierOption {
  id: string;
  name: LocalizedText;
  priceDeltaEtb: number;
  available: boolean;
}

export interface ModifierGroup {
  id: string;
  name: LocalizedText;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  options: ModifierOption[];
}

export interface AvailabilityRule {
  status: 'in_stock' | 'low_stock' | 'sold_out' | 'pre_order_only';
  remainingCount?: number;
  fastingDayEligible?: boolean;
  fastingOnly?: boolean;
  timeWindow?: string;
  leadTimeHours?: number;
}

export interface Product {
  id: string;
  categoryId: string;
  outletId: string;
  name: LocalizedText;
  description: LocalizedText;
  basePriceEtb: number;
  dietaryTags: string[];
  prepTimeMinutes: number;
  variations: ProductVariation[];
  modifierGroups: ModifierGroup[];
  availability: AvailabilityRule;
  featured?: boolean;
  isCombo?: boolean;
}

export interface QrStation {
  id: string;
  label: string;
  stationType: 'table' | 'room' | 'counter' | 'pickup_zone' | 'mesob_table';
  outletId: string;
  capacityOrZone: string;
  status: 'available' | 'occupied' | 'reserved';
  scanToken: string;
}

export interface OrderLineItem {
  id: string;
  productId: string;
  productName: string;
  variationId?: string;
  variationName?: string;
  selectedModifierOptionIds?: string[];
  selectedModifiers: { groupName: string; optionName: string; priceDeltaEtb: number }[];
  quantity: number;
  unitPriceEtb: number;
  notes?: string;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  createdAt: string;
  workflow: OrderingWorkflow;
  outletId: string;
  outletName: string;
  stationLabel?: string;
  customerName: string;
  customerPhone: string;
  paymentProvider: PaymentProviderId;
  paymentStatus: 'paid' | 'pending' | 'charge_to_room';
  paymentMessage?: string;
  status: 'new' | 'preparing' | 'ready' | 'completed';
  items: OrderLineItem[];
  totalEtb: number;
  pickupScheduledFor?: string;
}

export interface ReservationOrSpecialRequest {
  id: string;
  kind: 'table_reservation' | 'custom_cake' | 'coffee_ceremony' | 'room_amenity';
  customerName: string;
  customerPhone: string;
  dateTime: string;
  partyOrSize: string;
  details: string;
  status: 'confirmed' | 'pending' | 'in_production' | 'cancelled';
  estimatedEtb?: number;
}

export interface LoyaltyMember {
  id: string;
  name: string;
  phone: string;
  stamps: number;
  targetStamps: number;
  favoriteDrink: string;
  totalSpentEtb: number;
}

export interface StaffMember {
  id: string;
  name: string;
  email?: string;
  role: string;
  scopeType?: 'tenant' | 'branch' | 'outlet';
  assignedBranchIds?: string[];
  assignedOutletIds?: string[];
  outletName: string;
  active: boolean;
}

export interface WebsiteConfig {
  templateId: WebsiteTemplateId;
  accentHex: string;
  typographyStyle: 'editorial' | 'geometric' | 'athletic';
  heroHeadline: LocalizedText;
  heroSubheadline: LocalizedText;
  heroImage: string;
  visibleSections: WebsiteSectionKey[];
  lowBandwidthDefault: boolean;
}

export interface LocalizationConfig {
  defaultLanguage: LanguageCode;
  supportedLanguages: LanguageCode[];
  currencyCode: 'ETB';
  currencySymbol: 'ETB';
  acceptedPayments: PaymentProviderId[];
  whatsappOrderingEnabled: boolean;
  fastingModeActive: boolean;
}

export interface PmsIntegrationConfig {
  enabled: boolean;
  providerName: string;
  roomValidationEndpoint: string;
  folioPostingEnabled: boolean;
  lastSyncedAt: string;
}

export interface BusinessWorkspace {
  id: string;
  slug: string;
  businessName: string;
  tagline: string;
  primaryBusinessType: BusinessTypeId;
  businessTypes: BusinessTypeId[];
  enabledCapabilities: CapabilityId[];
  allowedWorkflows: OrderingWorkflow[];
  branches: Branch[];
  outlets: Outlet[];
  categories: MenuCategory[];
  products: Product[];
  qrStations: QrStation[];
  orders: OrderRecord[];
  specialRequests: ReservationOrSpecialRequest[];
  loyaltyMembers: LoyaltyMember[];
  staff: StaffMember[];
  websiteConfig: WebsiteConfig;
  localization: LocalizationConfig;
  pmsIntegration: PmsIntegrationConfig;
}
