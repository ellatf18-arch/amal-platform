import {
  BUSINESS_CATEGORY_REGISTRY,
  UNIVERSAL_CAPABILITIES,
  WEBSITE_TEMPLATE_REGISTRY,
} from '../data/businessRegistry';
import { BUSINESS_PRESETS } from '../data/presets';
import {
  BusinessTypeId,
  BusinessWorkspace,
  CapabilityId,
  LanguageCode,
  OrderingWorkflow,
  PaymentProviderId,
} from '../types/amal';

export interface AdaptiveOnboardingInput {
  businessName: string;
  city: string;
  neighborhood: string;
  phone: string;
  whatsappNumber: string;
  primaryType: BusinessTypeId;
  secondaryTypes: BusinessTypeId[];
  supportedLanguages: LanguageCode[];
  acceptedPayments: PaymentProviderId[];
  enableFastingMode: boolean;
  enableLowBandwidthDefault: boolean;
}

export function buildWorkspaceFromOnboarding(
  input: AdaptiveOnboardingInput
): BusinessWorkspace {
  const allTypes = Array.from(
    new Set<BusinessTypeId>([input.primaryType, ...input.secondaryTypes])
  );

  const primaryPreset = BUSINESS_PRESETS[input.primaryType];
  const primaryDef = BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === input.primaryType)!;
  const templateDef = WEBSITE_TEMPLATE_REGISTRY[primaryDef.defaultTemplate];

  // Merge capabilities across all selected business types cleanly
  const capabilitySet = new Set<CapabilityId>(UNIVERSAL_CAPABILITIES);
  const workflowSet = new Set<OrderingWorkflow>();

  allTypes.forEach((typeId) => {
    const def = BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === typeId);
    if (def) {
      def.recommendedCapabilities.forEach((cap) => capabilitySet.add(cap));
      def.defaultWorkflows.forEach((wf) => workflowSet.add(wf));
    }
  });

  if (input.enableFastingMode) {
    capabilitySet.add('fasting_menu_mode');
  }

  // Merge outlets, categories, products, and QR stations from primary + secondary types
  const outlets = [...primaryPreset.outlets];
  const categories = [...primaryPreset.categories];
  const products = [...primaryPreset.products];
  const qrStations = [...primaryPreset.qrStations];

  input.secondaryTypes.forEach((secType) => {
    if (secType === input.primaryType) return;
    const secPreset = BUSINESS_PRESETS[secType];
    secPreset.outlets.forEach((o) => {
      if (!outlets.some((existing) => existing.id === o.id)) {
        outlets.push({ ...o, branchId: 'br-custom-main' });
      }
    });
    secPreset.categories.forEach((c) => {
      if (!categories.some((existing) => existing.id === c.id)) {
        categories.push({ ...c, sortOrder: categories.length + 1 });
      }
    });
    secPreset.products.forEach((p) => {
      if (!products.some((existing) => existing.id === p.id)) {
        products.push(p);
      }
    });
    secPreset.qrStations.forEach((q) => {
      if (!qrStations.some((existing) => existing.id === q.id)) {
        qrStations.push(q);
      }
    });
  });

  const slug =
    input.businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'amal-business';

  return {
    ...primaryPreset,
    id: `ws-${Date.now()}`,
    slug,
    businessName: input.businessName.trim() || primaryPreset.businessName,
    tagline: `${primaryDef.shortLabel}${
      input.secondaryTypes.length > 0
        ? ` + ${input.secondaryTypes
            .map((t) => BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === t)?.shortLabel)
            .filter(Boolean)
            .join(', ')}`
        : ''
    } · ${input.neighborhood || input.city}`,
    primaryBusinessType: input.primaryType,
    businessTypes: allTypes,
    enabledCapabilities: Array.from(capabilitySet),
    allowedWorkflows: Array.from(workflowSet),
    branches: [
      {
        id: 'br-custom-main',
        name: `${input.neighborhood || input.city} Branch`,
        city: input.city || 'Addis Ababa',
        neighborhood: input.neighborhood || 'Central',
        phone: input.phone || '+251 11 000 0000',
        whatsappNumber: input.whatsappNumber || '+251911000000',
        hours: primaryPreset.branches[0]?.hours || '08:00 – 22:00 Daily',
      },
    ],
    outlets: outlets.map((o) => ({ ...o, branchId: 'br-custom-main' })),
    categories,
    products,
    qrStations,
    orders: [],
    specialRequests: [],
    websiteConfig: {
      templateId: templateDef.id,
      accentHex: templateDef.accentHex,
      typographyStyle: templateDef.typographyStyle,
      heroHeadline: {
        en: `Welcome to ${input.businessName || primaryPreset.businessName}`,
        am: `እንኳን ወደ ${input.businessName || primaryPreset.businessName} በደህና መጡ`,
        om: `Baga gara ${input.businessName || primaryPreset.businessName} nagaan dhuftan`,
      },
      heroSubheadline: primaryPreset.websiteConfig.heroSubheadline,
      heroImage: templateDef.heroImage,
      visibleSections: templateDef.defaultSections,
      lowBandwidthDefault: input.enableLowBandwidthDefault,
    },
    localization: {
      defaultLanguage: input.supportedLanguages[0] || 'en',
      supportedLanguages: input.supportedLanguages.length ? input.supportedLanguages : ['en', 'am'],
      currencyCode: 'ETB',
      currencySymbol: 'ETB',
      acceptedPayments: input.acceptedPayments.length
        ? input.acceptedPayments
        : ['telebirr', 'cbe_birr', 'cash'],
      whatsappOrderingEnabled: true,
      fastingModeActive: input.enableFastingMode,
    },
    pmsIntegration: allTypes.includes('hotel')
      ? {
          enabled: true,
          providerName: 'AMAL PMS Bridge (Webhook v1)',
          roomValidationEndpoint: 'https://pms-bridge.internal/v1/folios/verify-room',
          folioPostingEnabled: true,
          lastSyncedAt: 'Just configured',
        }
      : {
          enabled: false,
          providerName: 'None',
          roomValidationEndpoint: '',
          folioPostingEnabled: false,
          lastSyncedAt: '',
        },
  };
}
