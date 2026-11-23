import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  Globe,
  Layers,
  QrCode,
  SlidersHorizontal,
  Store,
} from 'lucide-react';
import {
  BUSINESS_CATEGORY_REGISTRY,
  CAPABILITY_LABELS,
  PAYMENT_PROVIDERS,
  UNIVERSAL_CAPABILITIES,
  WEBSITE_TEMPLATE_REGISTRY,
} from '../data/businessRegistry';
import { BUSINESS_PRESETS } from '../data/presets';
import { BusinessTypeId, BusinessWorkspace } from '../types/amal';

interface PlatformOverviewProps {
  activeWorkspace?: BusinessWorkspace | null;
  onSelectCategoryPreset: (typeId: BusinessTypeId, destination: 'dashboard' | 'storefront') => void;
  onStartOnboarding: (initialType?: BusinessTypeId) => void;
}

export const PlatformOverview: React.FC<PlatformOverviewProps> = ({
  activeWorkspace,
  onSelectCategoryPreset,
  onStartOnboarding,
}) => {
  const initialCategory: BusinessTypeId =
    activeWorkspace?.primaryBusinessType &&
    BUSINESS_PRESETS[activeWorkspace.primaryBusinessType]
      ? activeWorkspace.primaryBusinessType
      : 'traditional_ethiopian';

  const [focusedCategory, setFocusedCategory] = useState<BusinessTypeId>(initialCategory);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  const selectedDef =
    BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === focusedCategory) ||
    BUSINESS_CATEGORY_REGISTRY[0];
  const selectedPreset =
    BUSINESS_PRESETS[selectedDef.id] || BUSINESS_PRESETS.traditional_ethiopian;
  const selectedTemplate = WEBSITE_TEMPLATE_REGISTRY[selectedDef.defaultTemplate];

  return (
    <main className="max-w-[1440px] mx-auto px-6 py-10 space-y-16">
      {/* Hero Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        <div className="lg:col-span-6 flex flex-col justify-between bg-white border border-neutral-200 rounded-xl p-8 lg:p-10">
          <div className="space-y-6">
            <p className="text-xs font-medium tracking-wide text-neutral-500">
              Addis Ababa & International · English · አማርኛ · Afaan Oromo · ETB
            </p>
            <h1 className="text-4xl lg:text-[3.25rem] leading-[1.08] font-bold tracking-tight text-neutral-950 text-balance">
              One Intelligent Platform for Every Food and Hospitality Business.
            </h1>
            <p className="text-base text-neutral-600 leading-relaxed max-w-xl">
              AMAL unifies digital menus, QR ordering, multi-outlet operations, and adaptive
              websites on one composable foundation—purpose-configured for restaurants, coffee
              houses, hotels, juice bars, fast food, bakeries, and traditional Ethiopian dining.
            </p>
          </div>

          <div className="pt-8 mt-8 border-t border-neutral-100 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={() => onStartOnboarding(focusedCategory)}
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Start Adaptive Onboarding</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onSelectCategoryPreset(focusedCategory, 'dashboard')}
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-neutral-900 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Inspect {selectedDef.shortLabel} Workspace</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-6 relative rounded-xl overflow-hidden border border-neutral-200 bg-neutral-900 min-h-[360px]">
          {!heroImgFailed ? (
            <img
              src={selectedTemplate.heroImage}
              alt={`${selectedDef.name.en} showcase`}
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="w-full h-full object-cover lg:absolute lg:inset-0"
            />
          ) : (
            <div className="w-full h-full min-h-[360px] flex flex-col items-center justify-center p-8 bg-neutral-900 text-neutral-100">
              <Store className="w-10 h-10 mb-3 text-neutral-400" />
              <p className="text-lg font-semibold">{selectedPreset.businessName}</p>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />
          <div className="relative lg:absolute bottom-0 left-0 right-0 p-7 text-white flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-1.5">
              <p className="text-xs text-neutral-300">
                {selectedDef.name.en} · {selectedDef.name.am} · {selectedTemplate.name}
              </p>
              <h2 className="text-2xl font-bold tracking-tight">
                {selectedPreset.businessName}
              </h2>
              <p className="text-sm text-neutral-200 max-w-md">{selectedPreset.tagline}</p>
            </div>
            <button
              type="button"
              onClick={() => onSelectCategoryPreset(focusedCategory, 'storefront')}
              className="px-4 py-2.5 text-xs font-semibold bg-white text-neutral-950 rounded-lg hover:bg-neutral-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open Live Storefront
            </button>
          </div>
        </div>
      </section>

      {/* 7-Category Interactive Explorer */}
      <section className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1.5">
            <h2 className="text-2xl lg:text-3xl font-bold tracking-tight text-neutral-950">
              Seven Industry Blueprints, One Extensible Core
            </h2>
            <p className="text-sm text-neutral-600 max-w-2xl">
              Select any hospitality sector below to test its adaptive dashboard modules, menu
              modifiers, QR workflows, and tailored website template immediately.
            </p>
          </div>
          <p className="text-xs text-neutral-500 font-mono-tabular">
            Active Preview: {selectedPreset.products.length} items · {selectedPreset.outlets.length}{' '}
            {selectedPreset.outlets.length === 1 ? 'outlet' : 'outlets'} ·{' '}
            {selectedPreset.enabledCapabilities.length} modules
          </p>
        </div>

        {/* Category Filter Tabs */}
        <div
          className="flex items-center gap-1.5 p-1.5 bg-neutral-100 border border-neutral-200 rounded-xl overflow-x-auto"
          role="tablist"
          aria-label="Business categories"
        >
          {BUSINESS_CATEGORY_REGISTRY.map((cat) => {
            const active = cat.id === focusedCategory;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setFocusedCategory(cat.id);
                  setHeroImgFailed(false);
                }}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-white text-neutral-950 shadow-sm'
                    : 'text-neutral-600 hover:text-neutral-950'
                }`}
              >
                {cat.shortLabel}
              </button>
            );
          })}
        </div>

        {/* Selected Category Detail Architecture Matrix */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 bg-white border border-neutral-200 rounded-xl p-6 lg:p-8">
          <div className="lg:col-span-5 space-y-5 lg:pr-6 lg:border-r lg:border-neutral-200">
            <div className="space-y-2">
              <p className="text-xs font-medium text-neutral-500">
                {selectedDef.name.am} · {selectedDef.name.om}
              </p>
              <h3 className="text-2xl font-bold text-neutral-950">{selectedDef.name.en}</h3>
              <p className="text-sm text-neutral-600 leading-relaxed">{selectedDef.description}</p>
            </div>

            <div className="space-y-2.5 pt-2">
              <h4 className="text-xs font-semibold text-neutral-900">
                Onboarding Recommendations
              </h4>
              <ul className="space-y-2">
                {selectedDef.onboardingRecommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-neutral-700">
                    <Check className="w-4 h-4 text-[#0F4C3A] shrink-0 mt-0.5" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => onSelectCategoryPreset(focusedCategory, 'dashboard')}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-neutral-950 rounded-lg hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Open Merchant Dashboard
              </button>
              <button
                type="button"
                onClick={() => onSelectCategoryPreset(focusedCategory, 'storefront')}
                className="px-4 py-2.5 text-xs font-semibold text-[#0F4C3A] bg-[#0F4C3A]/10 rounded-lg hover:bg-[#0F4C3A]/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Test Customer Ordering Site
              </button>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-6">
            <div>
              <h4 className="text-xs font-semibold text-neutral-900 mb-3">
                Activated Category-Specific Modules
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {selectedDef.recommendedCapabilities.map((capId) => {
                  const cap = CAPABILITY_LABELS[capId];
                  return (
                    <div
                      key={capId}
                      className="p-3.5 rounded-lg bg-[#F8F9FA] border border-neutral-200/80 space-y-1"
                    >
                      <p className="text-sm font-semibold text-neutral-900">{cap.label}</p>
                      <p className="text-xs text-neutral-600 leading-relaxed">{cap.summary}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-neutral-100">
              <div>
                <p className="text-xs text-neutral-500">Default Workflows</p>
                <p className="text-sm font-semibold text-neutral-900 mt-1">
                  {selectedDef.defaultWorkflows
                    .map((w) => w.replace('_', ' '))
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(' · ')}
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">QR Station Target</p>
                <p className="text-sm font-semibold text-neutral-900 mt-1">
                  {selectedDef.defaultQrTargetLabel}
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Website Template</p>
                <p className="text-sm font-semibold text-neutral-900 mt-1">
                  {selectedTemplate.name}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Shared Universal Platform Foundation + Ethiopian Localization */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-neutral-200 rounded-xl p-7 space-y-5">
          <div className="flex items-center gap-2.5 text-neutral-900">
            <Layers className="w-5 h-5 text-[#0F4C3A]" />
            <h2 className="text-xl font-bold tracking-tight">
              Shared Universal Foundation Across All Businesses
            </h2>
          </div>
          <p className="text-sm text-neutral-600 leading-relaxed">
            Rather than maintaining seven disconnected apps, every business runs on AMAL’s
            composable core—supporting multiple outlets, product variations, required/optional
            modifier groups, and branch-level staff controls.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 pt-2 border-t border-neutral-100">
            {UNIVERSAL_CAPABILITIES.map((capId) => (
              <div key={capId} className="py-1.5 flex items-start gap-2.5">
                <SlidersHorizontal className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-neutral-900">
                    {CAPABILITY_LABELS[capId].label}
                  </p>
                  <p className="text-xs text-neutral-500">{CAPABILITY_LABELS[capId].summary}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-neutral-200 rounded-xl p-7 space-y-5">
          <div className="flex items-center gap-2.5 text-neutral-900">
            <Globe className="w-5 h-5 text-[#0F4C3A]" />
            <h2 className="text-xl font-bold tracking-tight">
              Ethiopian Market First, Globally Ready
            </h2>
          </div>
          <p className="text-sm text-neutral-600 leading-relaxed">
            Built natively for Addis Ababa and regional cities with low-bandwidth mobile rendering,
            Amharic & Afaan Oromo menus, Ethiopian Birr pricing, and local payment rails.
          </p>
          <div className="space-y-3 pt-2 border-t border-neutral-100">
            <div className="flex justify-between items-baseline py-1.5 border-b border-neutral-100">
              <span className="text-xs text-neutral-500">Languages</span>
              <span className="text-sm font-medium text-neutral-900">
                English · አማርኛ · Afaan Oromo
              </span>
            </div>
            <div className="flex justify-between items-baseline py-1.5 border-b border-neutral-100">
              <span className="text-xs text-neutral-500">Currency</span>
              <span className="text-sm font-medium text-neutral-900 font-mono-tabular">
                Ethiopian Birr (ETB)
              </span>
            </div>
            <div className="flex justify-between items-baseline py-1.5 border-b border-neutral-100">
              <span className="text-xs text-neutral-500">Payment Integrations</span>
              <span className="text-sm font-medium text-neutral-900">
                {Object.values(PAYMENT_PROVIDERS)
                  .slice(0, 4)
                  .map((p) => p.name)
                  .join(' · ')}
              </span>
            </div>
            <div className="flex justify-between items-baseline py-1.5">
              <span className="text-xs text-neutral-500">Direct Channels</span>
              <span className="text-sm font-medium text-neutral-900 flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5 text-[#0F4C3A]" />
                <span>QR Ordering & WhatsApp Checkout</span>
              </span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
};
