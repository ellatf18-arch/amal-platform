import React, { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import {
  BUSINESS_CATEGORY_REGISTRY,
  CAPABILITY_LABELS,
  PAYMENT_PROVIDERS,
  WEBSITE_TEMPLATE_REGISTRY,
} from '../data/businessRegistry';
import {
  BusinessTypeId,
  BusinessWorkspace,
  CapabilityId,
  LanguageCode,
  PaymentProviderId,
} from '../types/amal';
import { amalApi } from '../services/apiClient';

interface OnboardingWizardProps {
  initialPrimaryType?: BusinessTypeId;
  isAuthenticated: boolean;
  onRequireAuth: (message: string) => void;
  onComplete: (workspace: BusinessWorkspace) => void;
  onCancel: () => void;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({
  initialPrimaryType = 'coffee_house',
  isAuthenticated,
  onRequireAuth,
  onComplete,
  onCancel,
}) => {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState('');
  const [primaryType, setPrimaryType] = useState<BusinessTypeId>(initialPrimaryType);
  const [secondaryTypes, setSecondaryTypes] = useState<BusinessTypeId[]>([]);

  const [businessName, setBusinessName] = useState<string>('Selam Hospitality Group');
  const [city, setCity] = useState<string>('Addis Ababa');
  const [neighborhood, setNeighborhood] = useState<string>('Bole');
  const [phone, setPhone] = useState<string>('+251 11 662 4090');
  const [whatsappNumber, setWhatsappNumber] = useState<string>('+251911662409');

  const [supportedLanguages, setSupportedLanguages] = useState<LanguageCode[]>([
    'en',
    'am',
    'om',
  ]);
  const [acceptedPayments, setAcceptedPayments] = useState<PaymentProviderId[]>([
    'telebirr',
    'cbe_birr',
    'chapa',
    'cash',
  ]);
  const [enableFastingMode, setEnableFastingMode] = useState<boolean>(
    initialPrimaryType === 'traditional_ethiopian'
  );
  const [enableLowBandwidthDefault, setEnableLowBandwidthDefault] = useState<boolean>(false);

  const primaryDef = useMemo(
    () => BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === primaryType)!,
    [primaryType]
  );

  const combinedTypes = useMemo(
    () => Array.from(new Set<BusinessTypeId>([primaryType, ...secondaryTypes])),
    [primaryType, secondaryTypes]
  );

  const adaptiveCapabilities = useMemo(() => {
    const caps = new Set<CapabilityId>();
    combinedTypes.forEach((t) => {
      const def = BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === t);
      def?.recommendedCapabilities.forEach((c) => caps.add(c));
    });
    if (enableFastingMode) caps.add('fasting_menu_mode');
    return Array.from(caps);
  }, [combinedTypes, enableFastingMode]);

  const combinedRecommendations = useMemo(() => {
    const recs: string[] = [];
    combinedTypes.forEach((t) => {
      const def = BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === t);
      def?.onboardingRecommendations.forEach((r) => {
        if (!recs.includes(r)) recs.push(r);
      });
    });
    return recs;
  }, [combinedTypes]);

  const toggleSecondaryType = (id: BusinessTypeId) => {
    if (id === primaryType) return;
    setSecondaryTypes((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleLanguage = (lang: LanguageCode) => {
    setSupportedLanguages((prev) => {
      if (prev.includes(lang)) {
        return prev.length > 1 ? prev.filter((l) => l !== lang) : prev;
      }
      return [...prev, lang];
    });
  };

  const togglePayment = (pid: PaymentProviderId) => {
    setAcceptedPayments((prev) => {
      if (prev.includes(pid)) {
        return prev.length > 1 ? prev.filter((p) => p !== pid) : prev;
      }
      return [...prev, pid];
    });
  };

  const handlePrimarySelect = (id: BusinessTypeId) => {
    setPrimaryType(id);
    setSecondaryTypes((prev) => prev.filter((t) => t !== id));
    if (id === 'traditional_ethiopian') {
      setEnableFastingMode(true);
    }
    if (id === 'hotel' && !acceptedPayments.includes('room_charge')) {
      setAcceptedPayments((prev) => [...prev, 'room_charge']);
    }
  };

  const handleProvision = async () => {
    setProvisionError('');
    if (!isAuthenticated) {
      onRequireAuth(
        'Sign in or create a merchant account to provision and persist your new AMAL workspace in PostgreSQL.'
      );
      return;
    }

    setProvisioning(true);
    try {
      const { workspace } = await amalApi.onboardWorkspace({
        businessName,
        city,
        neighborhood,
        phone,
        whatsappNumber,
        primaryType,
        secondaryTypes,
        supportedLanguages,
        acceptedPayments,
        enableFastingMode,
        enableLowBandwidthDefault,
        planTier: 'growth',
      });
      onComplete(workspace);
    } catch (err) {
      setProvisionError(err instanceof Error ? err.message : 'Failed to provision workspace');
    } finally {
      setProvisioning(false);
    }
  };

  const recommendedTemplate = WEBSITE_TEMPLATE_REGISTRY[primaryDef.defaultTemplate];

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-10">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200 pb-6">
        <div className="space-y-1">
          <p className="text-xs font-medium text-neutral-500">
            Adaptive Business Registration · Step {step} of 3
          </p>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight text-neutral-950">
            Configure Your AMAL Workspace
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {([1, 2, 3] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStep(n)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                step === n
                  ? 'bg-neutral-950 text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              0{n}. {n === 1 ? 'Categories' : n === 2 ? 'Localization' : 'Blueprint'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Main Wizard Surface */}
        <div className="lg:col-span-8 bg-white border border-neutral-200 rounded-xl p-6 lg:p-8 space-y-8">
          {step === 1 && (
            <>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-neutral-950">
                  01. Select Your Primary Business Category
                </h2>
                <p className="text-sm text-neutral-600">
                  AMAL adapts menu templates, ordering workflows, QR stations, and dashboard
                  modules automatically based on your hospitality model.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {BUSINESS_CATEGORY_REGISTRY.map((cat) => {
                  const isPrimary = primaryType === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => handlePrimarySelect(cat.id)}
                      className={`text-left p-4 rounded-xl border transition-colors cursor-pointer space-y-1.5 ${
                        isPrimary
                          ? 'border-[#0F4C3A] bg-[#0F4C3A]/[0.04]'
                          : 'border-neutral-200 bg-white hover:border-neutral-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-neutral-950">
                          {cat.name.en}
                        </span>
                        {isPrimary && (
                          <span className="text-xs font-semibold text-[#0F4C3A]">Primary</span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-500">{cat.name.am}</p>
                      <p className="text-xs text-neutral-600 leading-relaxed">{cat.tagline}</p>
                    </button>
                  );
                })}
              </div>

              <div className="pt-6 border-t border-neutral-200 space-y-3">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-neutral-950">
                    Optional Additional Categories (Multi-Category Support)
                  </h3>
                  <p className="text-xs text-neutral-600">
                    Operate a hybrid business? Combine outlets and capabilities (e.g., Hotel +
                    Coffee House, Bakery + Café, or Restaurant + Juice Bar).
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {BUSINESS_CATEGORY_REGISTRY.filter((c) => c.id !== primaryType).map((cat) => {
                    const checked = secondaryTypes.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => toggleSecondaryType(cat.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          checked
                            ? 'bg-neutral-950 text-white border-neutral-950'
                            : 'bg-white text-neutral-700 border-neutral-200 hover:border-neutral-400'
                        }`}
                      >
                        {checked && <Check className="w-3.5 h-3.5" />}
                        <span>+ {cat.shortLabel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-neutral-950">
                  02. Business Identity & Ethiopian Market Localization
                </h2>
                <p className="text-sm text-neutral-600">
                  Configure your brand details, supported menu languages, local mobile payments,
                  and Ethiopian culinary/bandwidth settings.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold text-neutral-700">Business Name</span>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g., Abyssinia Roast & Bistro"
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#0F4C3A]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-neutral-700">City</span>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#0F4C3A]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-neutral-700">
                    Neighborhood / Branch
                  </span>
                  <input
                    type="text"
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#0F4C3A]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-neutral-700">Phone Number</span>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono-tabular bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#0F4C3A]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-semibold text-neutral-700">
                    WhatsApp Order Number
                  </span>
                  <input
                    type="text"
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm font-mono-tabular bg-white border border-neutral-300 rounded-lg focus:outline-none focus:border-[#0F4C3A]"
                  />
                </label>
              </div>

              <div className="pt-4 border-t border-neutral-200 space-y-3">
                <span className="block text-xs font-semibold text-neutral-700">
                  Menu & Storefront Languages (Currency: Ethiopian Birr · ETB)
                </span>
                <div className="flex flex-wrap gap-2.5">
                  {(
                    [
                      { code: 'en', label: 'English' },
                      { code: 'am', label: 'Amharic (አማርኛ)' },
                      { code: 'om', label: 'Afaan Oromo' },
                    ] as const
                  ).map((lang) => {
                    const active = supportedLanguages.includes(lang.code);
                    return (
                      <button
                        key={lang.code}
                        type="button"
                        onClick={() => toggleLanguage(lang.code)}
                        className={`px-3.5 py-2 text-xs font-semibold rounded-lg border cursor-pointer whitespace-nowrap shrink-0 ${
                          active
                            ? 'bg-neutral-950 text-white border-neutral-950'
                            : 'bg-white text-neutral-700 border-neutral-200'
                        }`}
                      >
                        {lang.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-neutral-200 space-y-3">
                <span className="block text-xs font-semibold text-neutral-700">
                  Accepted Payment Integrations
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(Object.keys(PAYMENT_PROVIDERS) as PaymentProviderId[]).map((pid) => {
                    const provider = PAYMENT_PROVIDERS[pid];
                    const active = acceptedPayments.includes(pid);
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => togglePayment(pid)}
                        className={`text-left p-3 rounded-lg border cursor-pointer transition-colors ${
                          active
                            ? 'border-[#0F4C3A] bg-[#0F4C3A]/[0.04]'
                            : 'border-neutral-200 bg-white hover:border-neutral-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-neutral-950">
                            {provider.name} · {provider.localLabel}
                          </span>
                          <span className="text-xs font-medium text-neutral-500">
                            {active ? 'Enabled' : 'Off'}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500 mt-0.5">{provider.description}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-4 border-t border-neutral-200 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-start gap-3 p-3.5 rounded-lg border border-neutral-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableFastingMode}
                    onChange={(e) => setEnableFastingMode(e.target.checked)}
                    className="mt-1 accent-[#0F4C3A]"
                  />
                  <div>
                    <span className="block text-xs font-bold text-neutral-950">
                      Enable Tsom (Fasting) Menu Toggle
                    </span>
                    <span className="block text-xs text-neutral-500 mt-0.5">
                      Let guests filter plant-based fasting items on Wednesdays, Fridays & fasting
                      seasons.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3.5 rounded-lg border border-neutral-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableLowBandwidthDefault}
                    onChange={(e) => setEnableLowBandwidthDefault(e.target.checked)}
                    className="mt-1 accent-[#0F4C3A]"
                  />
                  <div>
                    <span className="block text-xs font-bold text-neutral-950">
                      Low-Bandwidth Optimization Default
                    </span>
                    <span className="block text-xs text-neutral-500 mt-0.5">
                      Load ultra-lightweight text-first menus automatically on slower 3G mobile
                      connections.
                    </span>
                  </div>
                </label>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-neutral-950">
                  03. Review Your Adaptive Platform Blueprint
                </h2>
                <p className="text-sm text-neutral-600">
                  AMAL will provision a unified workspace combining your selected categories, starter
                  menus, QR stations, and adaptive website template.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-[#F8F9FA] border border-neutral-200">
                <div>
                  <p className="text-xs text-neutral-500">Business Name</p>
                  <p className="text-sm font-bold text-neutral-950 mt-0.5">{businessName}</p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Categories Combined</p>
                  <p className="text-sm font-bold text-neutral-950 mt-0.5">
                    {combinedTypes
                      .map((t) => BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === t)?.shortLabel)
                      .join(' + ')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-neutral-500">Website Template</p>
                  <p className="text-sm font-bold text-neutral-950 mt-0.5">
                    {recommendedTemplate.name}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-neutral-900">
                  Activated Adaptive Modules ({adaptiveCapabilities.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {adaptiveCapabilities.map((capId) => (
                    <div
                      key={capId}
                      className="p-3 rounded-lg border border-neutral-200 flex items-start gap-2.5"
                    >
                      <Check className="w-4 h-4 text-[#0F4C3A] shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-neutral-900">
                          {CAPABILITY_LABELS[capId].label}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {CAPABILITY_LABELS[capId].summary}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {provisionError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                  {provisionError}
                </div>
              )}

              {!isAuthenticated && (
                <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  Sign in (or register an operator account) when provisioning so your business, QR
                  stations, and catalog save permanently to PostgreSQL.
                </div>
              )}
            </>
          )}

          {/* Footer Controls */}
          <div className="pt-6 border-t border-neutral-200 flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={step === 1 ? onCancel : () => setStep((step - 1) as 1 | 2)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{step === 1 ? 'Cancel' : 'Back'}</span>
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={() => setStep((step + 1) as 2 | 3)}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-neutral-950 rounded-lg hover:bg-neutral-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                type="button"
                disabled={provisioning}
                onClick={handleProvision}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                <span>
                  {provisioning
                    ? 'Provisioning Workspace...'
                    : isAuthenticated
                      ? 'Provision AMAL Workspace'
                      : 'Sign In & Provision Workspace'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Right Live Recommendations Sidebar */}
        <aside className="lg:col-span-4 bg-white border border-neutral-200 rounded-xl p-6 space-y-5">
          <div className="space-y-1 pb-4 border-b border-neutral-100">
            <p className="text-xs font-medium text-neutral-500">Live Provisioning Preview</p>
            <h3 className="text-lg font-bold text-neutral-950">
              {combinedTypes.length === 1
                ? primaryDef.name.en
                : `${primaryDef.shortLabel} + ${secondaryTypes.length} Additional`}
            </h3>
          </div>

          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-neutral-900">
              Tailored Recommendations Included
            </p>
            <ul className="space-y-2">
              {combinedRecommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2 text-xs text-neutral-600">
                  <Check className="w-3.5 h-3.5 text-[#0F4C3A] shrink-0 mt-0.5" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="pt-4 border-t border-neutral-100 space-y-2">
            <p className="text-xs font-semibold text-neutral-900">Default Website Identity</p>
            <p className="text-xs text-neutral-600">{recommendedTemplate.name}</p>
            <p className="text-xs text-neutral-500 leading-relaxed">
              {recommendedTemplate.description}
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
};
