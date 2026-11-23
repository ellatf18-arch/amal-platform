import React, { useMemo, useState } from 'react';
import {
  Check,
  Coffee,
  MessageCircle,
  Minus,
  Plus,
  QrCode,
  ShoppingBag,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import {
  I18N_UI,
  PAYMENT_PROVIDERS,
  WEBSITE_TEMPLATE_REGISTRY,
  formatEtb,
} from '../data/businessRegistry';
import { amalApi } from '../services/apiClient';
import {
  BusinessWorkspace,
  LanguageCode,
  OrderLineItem,
  OrderRecord,
  OrderingWorkflow,
  PaymentProviderId,
  Product,
  ReservationOrSpecialRequest,
} from '../types/amal';

interface LiveStorefrontProps {
  workspace: BusinessWorkspace;
  initialStationToken?: string;
  onPlaceOrder: (order: OrderRecord) => void;
  onSubmitSpecialRequest: (req: ReservationOrSpecialRequest) => void;
  onBackToDashboard: () => void;
}

export const LiveStorefront: React.FC<LiveStorefrontProps> = ({
  workspace,
  initialStationToken,
  onPlaceOrder,
  onSubmitSpecialRequest,
  onBackToDashboard,
}) => {
  const template = WEBSITE_TEMPLATE_REGISTRY[workspace.websiteConfig.templateId];
  const isDark = template.surfaceMode === 'dark';
  const isWarm = template.surfaceMode === 'warm';
  const isDbBacked = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(workspace.id);

  const matchedStation = useMemo(
    () => workspace.qrStations.find((s) => s.scanToken === initialStationToken),
    [workspace.qrStations, initialStationToken]
  );

  const [lang, setLang] = useState<LanguageCode>(
    workspace.localization.defaultLanguage || 'en'
  );
  const [lowBandwidth, setLowBandwidth] = useState<boolean>(
    workspace.websiteConfig.lowBandwidthDefault
  );
  const [activeBranchId, setActiveBranchId] = useState<string>(
    workspace.branches[0]?.id || ''
  );
  const [activeOutletId, setActiveOutletId] = useState<string>(
    matchedStation?.outletId || workspace.outlets[0]?.id || ''
  );
  const [fastingOnly, setFastingOnly] = useState<boolean>(
    workspace.localization.fastingModeActive &&
      workspace.enabledCapabilities.includes('fasting_menu_mode')
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  // Product configurator modal
  const [configuringProduct, setConfiguringProduct] = useState<Product | null>(null);
  const [selectedVariationId, setSelectedVariationId] = useState<string>('');
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({});
  const [itemQuantity, setItemQuantity] = useState<number>(1);
  const [configError, setConfigError] = useState<string>('');

  // Cart & Checkout
  const [cart, setCart] = useState<OrderLineItem[]>([]);
  const [cartOpen, setCartOpen] = useState<boolean>(false);
  const [submittingCheckout, setSubmittingCheckout] = useState<boolean>(false);
  const [checkoutError, setCheckoutError] = useState<string>('');
  const [workflow, setWorkflow] = useState<OrderingWorkflow>(
    matchedStation?.stationType === 'room'
      ? 'room_service'
      : matchedStation?.stationType === 'table' ||
          matchedStation?.stationType === 'mesob_table'
        ? 'dine_in'
        : workspace.allowedWorkflows[0] || 'takeaway'
  );
  const [customerName, setCustomerName] = useState<string>('');
  const [customerPhone, setCustomerPhone] = useState<string>('');
  const [roomOrTableInput, setRoomOrTableInput] = useState<string>(
    matchedStation?.label || ''
  );
  const [pickupSlot, setPickupSlot] = useState<string>('Today · Within 25 mins');
  const [paymentProvider, setPaymentProvider] = useState<PaymentProviderId>(
    matchedStation?.stationType === 'room' &&
      workspace.localization.acceptedPayments.includes('room_charge')
      ? 'room_charge'
      : workspace.localization.acceptedPayments[0] || 'telebirr'
  );
  const [confirmedOrder, setConfirmedOrder] = useState<OrderRecord | null>(null);

  // Special requests per kind (supports multiple forms on hybrid businesses)
  const [reqForms, setReqForms] = useState<
    Record<
      string,
      {
        name: string;
        phone: string;
        date: string;
        partyOrSize: string;
        details: string;
        savedMessage: string;
        errorMessage: string;
        submitting: boolean;
      }
    >
  >({});

  const getReqField = (kind: string) =>
    reqForms[kind] || {
      name: '',
      phone: '',
      date: 'Tomorrow · 18:30',
      partyOrSize: '',
      details: '',
      savedMessage: '',
      errorMessage: '',
      submitting: false,
    };

  const updateReqField = (
    kind: string,
    patch: Partial<ReturnType<typeof getReqField>>
  ) => {
    setReqForms((prev) => ({
      ...prev,
      [kind]: { ...getReqField(kind), ...patch },
    }));
  };

  // Loyalty check (Coffee House — masked server lookup when DB-backed)
  const [loyaltyPhoneSearch, setLoyaltyPhoneSearch] = useState('+251922119044');
  const [serverLoyaltyResult, setServerLoyaltyResult] = useState<{
    maskedName: string;
    stampsBalance: number;
    targetStamps: number;
  } | null>(null);
  const [loyaltyLookupDone, setLoyaltyLookupDone] = useState(false);

  const ui = I18N_UI[lang];
  const accent = workspace.websiteConfig.accentHex || template.accentHex;
  const visibleSections = workspace.websiteConfig.visibleSections;
  const activeBranch =
    workspace.branches.find((b) => b.id === activeBranchId) || workspace.branches[0];

  const t = (text?: { en: string; am?: string; om?: string }) => {
    if (!text) return '';
    return text[lang] || text.en;
  };

  const outletCategories = useMemo(() => {
    return workspace.categories.filter(
      (c) => !activeOutletId || c.outletId === activeOutletId
    );
  }, [workspace.categories, activeOutletId]);

  const visibleProducts = useMemo(() => {
    return workspace.products.filter((p) => {
      if (activeOutletId && p.outletId !== activeOutletId) return false;
      if (selectedCategoryId !== 'all' && p.categoryId !== selectedCategoryId) {
        return false;
      }
      if (fastingOnly && !p.availability.fastingDayEligible) return false;
      return true;
    });
  }, [workspace.products, activeOutletId, selectedCategoryId, fastingOnly]);

  const featuredProducts = useMemo(() => {
    return visibleProducts.filter((p) => p.featured).slice(0, 3);
  }, [visibleProducts]);

  const cartTotalEtb = useMemo(
    () => cart.reduce((sum, item) => sum + item.unitPriceEtb * item.quantity, 0),
    [cart]
  );

  const openProductModal = (product: Product) => {
    setConfiguringProduct(product);
    setSelectedVariationId(product.variations[0]?.id || '');
    const initialMods: Record<string, string[]> = {};
    product.modifierGroups.forEach((mg) => {
      if (mg.required && mg.options[0]?.available) {
        initialMods[mg.id] = [mg.options[0].id];
      } else {
        initialMods[mg.id] = [];
      }
    });
    setSelectedModifiers(initialMods);
    setItemQuantity(1);
    setConfigError('');
  };

  const toggleModifierOption = (
    groupId: string,
    optionId: string,
    maxSelect: number
  ) => {
    setSelectedModifiers((prev) => {
      const current = prev[groupId] || [];
      if (maxSelect === 1) {
        return { ...prev, [groupId]: [optionId] };
      }
      if (current.includes(optionId)) {
        return { ...prev, [groupId]: current.filter((id) => id !== optionId) };
      }
      if (current.length >= maxSelect) {
        return prev;
      }
      return { ...prev, [groupId]: [...current, optionId] };
    });
  };

  const currentModalUnitPrice = useMemo(() => {
    if (!configuringProduct) return 0;
    let total = configuringProduct.basePriceEtb;
    const variation = configuringProduct.variations.find(
      (v) => v.id === selectedVariationId
    );
    if (variation) total += variation.priceDeltaEtb;

    configuringProduct.modifierGroups.forEach((mg) => {
      const chosenIds = selectedModifiers[mg.id] || [];
      chosenIds.forEach((optId) => {
        const opt = mg.options.find((o) => o.id === optId);
        if (opt) total += opt.priceDeltaEtb;
      });
    });
    return total;
  }, [configuringProduct, selectedVariationId, selectedModifiers]);

  const handleConfirmAddToCart = () => {
    if (!configuringProduct) return;

    for (const mg of configuringProduct.modifierGroups) {
      const chosen = selectedModifiers[mg.id] || [];
      if (mg.required && chosen.length < mg.minSelect) {
        setConfigError(
          `Please select at least ${mg.minSelect} option for ${t(mg.name)}.`
        );
        return;
      }
    }

    const variation = configuringProduct.variations.find(
      (v) => v.id === selectedVariationId
    );

    const chosenModifierSummary: OrderLineItem['selectedModifiers'] = [];
    const chosenModifierOptionIds: string[] = [];
    configuringProduct.modifierGroups.forEach((mg) => {
      (selectedModifiers[mg.id] || []).forEach((optId) => {
        const opt = mg.options.find((o) => o.id === optId);
        if (opt) {
          chosenModifierOptionIds.push(opt.id);
          chosenModifierSummary.push({
            groupName: t(mg.name),
            optionName: t(opt.name),
            priceDeltaEtb: opt.priceDeltaEtb,
          });
        }
      });
    });

    const lineItem: OrderLineItem = {
      id: `li-${Date.now()}`,
      productId: configuringProduct.id,
      productName: t(configuringProduct.name),
      variationId: variation?.id,
      variationName: variation ? t(variation.name) : undefined,
      selectedModifierOptionIds: chosenModifierOptionIds,
      selectedModifiers: chosenModifierSummary,
      quantity: itemQuantity,
      unitPriceEtb: currentModalUnitPrice,
    };

    setCart((prev) => [...prev, lineItem]);
    setConfiguringProduct(null);
    setCartOpen(true);
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0 || submittingCheckout) return;
    setCheckoutError('');

    const outlet =
      workspace.outlets.find((o) => o.id === activeOutletId) || workspace.outlets[0];

    if (isDbBacked && outlet) {
      setSubmittingCheckout(true);
      try {
        const idempKey = `web_${workspace.slug}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const result = await amalApi.publicCheckout(workspace.slug, {
          workflow,
          outletId: outlet.id,
          stationToken: initialStationToken,
          stationLabel: roomOrTableInput.trim() || undefined,
          customerName: customerName.trim() || 'Guest Customer',
          customerPhone: customerPhone.trim() || '+251910000000',
          paymentProvider,
          pickupScheduledFor: workflow === 'pre_order' ? pickupSlot : undefined,
          idempotencyKey: idempKey,
          items: cart.map((line) => ({
            productId: line.productId,
            variationId: line.variationId,
            selectedModifierOptionIds: line.selectedModifierOptionIds || [],
            quantity: line.quantity,
            notes: line.notes,
          })),
        });

        const serverOrder: OrderRecord = {
          id: result.order.id,
          orderNumber: result.order.orderNumber,
          createdAt: result.order.createdAt,
          workflow: result.order.workflow,
          outletId: result.order.outletId,
          outletName: result.order.outletName || outlet.name.en,
          stationLabel: result.order.stationLabel,
          customerName: result.order.customerName,
          customerPhone: result.order.customerPhone,
          paymentProvider: result.order.paymentProvider,
          paymentStatus: result.order.paymentStatus,
          paymentMessage: result.paymentMessage,
          status: result.order.status,
          items: cart,
          totalEtb: result.order.totalEtb,
          pickupScheduledFor: workflow === 'pre_order' ? pickupSlot : undefined,
        };

        onPlaceOrder(serverOrder);
        setConfirmedOrder(serverOrder);
        setCart([]);
      } catch (err) {
        setCheckoutError(err instanceof Error ? err.message : 'Checkout failed');
      } finally {
        setSubmittingCheckout(false);
      }
      return;
    }

    const newOrder: OrderRecord = {
      id: `ord-${Date.now()}`,
      orderNumber: `AM-${Math.floor(1000 + Math.random() * 8999)}`,
      createdAt: 'Just now',
      workflow,
      outletId: outlet?.id || 'out-1',
      outletName: outlet?.name.en || workspace.businessName,
      stationLabel: roomOrTableInput.trim() || undefined,
      customerName: customerName.trim() || 'Guest Customer',
      customerPhone: customerPhone.trim() || '+251 91 000 0000',
      paymentProvider,
      paymentStatus:
        paymentProvider === 'room_charge' ? 'charge_to_room' : 'pending',
      status: 'new',
      items: cart,
      totalEtb: cartTotalEtb,
      pickupScheduledFor: workflow === 'pre_order' ? pickupSlot : undefined,
    };

    onPlaceOrder(newOrder);
    setConfirmedOrder(newOrder);
    setCart([]);
  };

  const buildWhatsappUrl = () => {
    const rawNum = (activeBranch?.whatsappNumber || '+251911000000').replace(
      /[^0-9]/g,
      ''
    );
    const itemsText = cart
      .map(
        (i) =>
          `• ${i.quantity}x ${i.productName}${
            i.variationName ? ` (${i.variationName})` : ''
          } — ${formatEtb(i.unitPriceEtb * i.quantity)}`
      )
      .join('\n');
    const message = encodeURIComponent(
      `Hello ${workspace.businessName},\nOrder via AMAL (${workflow.replace('_', ' ')}):\n${itemsText}\nTotal: ${formatEtb(cartTotalEtb)}\n${roomOrTableInput ? `Location/Room: ${roomOrTableInput}` : ''}`
    );
    return `https://wa.me/${rawNum}?text=${message}`;
  };

  const handleSpecialRequestSubmit = async (
    e: React.FormEvent,
    kind: ReservationOrSpecialRequest['kind']
  ) => {
    e.preventDefault();
    const f = getReqField(kind);
    if (!f.name.trim() || !f.phone.trim() || f.submitting) return;

    if (isDbBacked) {
      updateReqField(kind, { submitting: true, errorMessage: '', savedMessage: '' });
      try {
        await amalApi.submitPublicSpecialRequest(workspace.slug, {
          kind,
          outletId: activeOutletId || undefined,
          customerName: f.name.trim(),
          customerPhone: f.phone.trim(),
          dateTime: f.date,
          partyOrSize: f.partyOrSize.trim() || 'Standard',
          details: f.details.trim() || 'Submitted via storefront',
        });
        onSubmitSpecialRequest({
          id: `sr-${Date.now()}`,
          kind,
          customerName: f.name.trim(),
          customerPhone: f.phone.trim(),
          dateTime: f.date,
          partyOrSize: f.partyOrSize.trim() || 'Standard',
          details: f.details.trim() || 'Submitted via storefront',
          status: 'pending',
        });
        updateReqField(kind, {
          name: '',
          phone: '',
          details: '',
          submitting: false,
          savedMessage: 'Request received and saved to merchant operations.',
        });
      } catch (err) {
        updateReqField(kind, {
          submitting: false,
          errorMessage: err instanceof Error ? err.message : 'Failed to submit request',
        });
      }
      return;
    }

    onSubmitSpecialRequest({
      id: `sr-${Date.now()}`,
      kind,
      customerName: f.name.trim(),
      customerPhone: f.phone.trim(),
      dateTime: f.date,
      partyOrSize: f.partyOrSize.trim() || 'Standard',
      details: f.details.trim() || 'Submitted via storefront',
      status: 'pending',
    });
    updateReqField(kind, {
      name: '',
      phone: '',
      details: '',
      savedMessage: 'Request received and synced to merchant operations.',
    });
  };

  const handleCheckLoyalty = async () => {
    if (!isDbBacked) return;
    try {
      const res = await amalApi.checkPublicLoyalty(workspace.slug, loyaltyPhoneSearch);
      setServerLoyaltyResult(res.loyalty);
      setLoyaltyLookupDone(true);
    } catch {
      setServerLoyaltyResult(null);
      setLoyaltyLookupDone(true);
    }
  };

  const matchedLoyalty = !isDbBacked
    ? workspace.loyaltyMembers.find((m) =>
        m.phone.replace(/\s+/g, '').includes(loyaltyPhoneSearch.replace(/\s+/g, ''))
      )
    : null;

  // Surface tokens aligned with selected template
  const canvasClass = isDark
    ? 'bg-[#111315] text-neutral-100'
    : isWarm
      ? 'bg-[#FAF7F2] text-neutral-950'
      : 'bg-white text-neutral-950';
  const cardSurfaceClass = isDark
    ? 'bg-[#191C20] border-neutral-800 text-neutral-100'
    : 'bg-white border-neutral-200 text-neutral-950';
  const mutedTextClass = isDark ? 'text-neutral-400' : 'text-neutral-600';
  const headingFontClass =
    workspace.websiteConfig.typographyStyle === 'editorial'
      ? 'font-editorial'
      : 'font-display';

  return (
    <div className={`min-h-[calc(100vh-4rem)] ${canvasClass} transition-colors`}>
      {/* Storefront Control Ribbon (Languages, Lite Mode, QR Context, Cart) */}
      <div
        className={`border-b ${
          isDark ? 'border-neutral-800 bg-[#16191D]' : 'border-neutral-200 bg-white'
        }`}
      >
        <div className="max-w-[1200px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className={`text-base font-bold ${headingFontClass}`}>
              {workspace.businessName}
            </span>
            {matchedStation && (
              <span
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-md text-white"
                style={{ backgroundColor: accent }}
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>{matchedStation.label}</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Language Switcher */}
            <div
              className={`flex items-center p-0.5 rounded-lg border ${
                isDark
                  ? 'bg-neutral-900 border-neutral-700'
                  : 'bg-neutral-100 border-neutral-200'
              }`}
            >
              {workspace.localization.supportedLanguages.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md cursor-pointer ${
                    lang === code
                      ? isDark
                        ? 'bg-neutral-700 text-white'
                        : 'bg-white text-neutral-950 shadow-sm'
                      : mutedTextClass
                  }`}
                >
                  {code === 'en' ? 'EN' : code === 'am' ? 'አማርኛ' : 'Oromoo'}
                </button>
              ))}
            </div>

            {/* Low-Bandwidth Lite Mode */}
            <button
              type="button"
              onClick={() => setLowBandwidth(!lowBandwidth)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer whitespace-nowrap ${
                lowBandwidth
                  ? 'bg-amber-50 text-amber-900 border-amber-300'
                  : isDark
                    ? 'border-neutral-700 text-neutral-300'
                    : 'border-neutral-200 text-neutral-700'
              }`}
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span>
                {ui.lowBandwidth}: {lowBandwidth ? 'On' : 'Off'}
              </span>
            </button>

            {/* Cart Trigger */}
            <button
              type="button"
              onClick={() => {
                setConfirmedOrder(null);
                setCartOpen(true);
              }}
              style={{ backgroundColor: accent }}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white rounded-lg cursor-pointer whitespace-nowrap"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>
                {ui.cart} ({cart.reduce((s, i) => s + i.quantity, 0)})
              </span>
              {cartTotalEtb > 0 && (
                <span className="font-mono-tabular">· {formatEtb(cartTotalEtb)}</span>
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-12">
        {/* SECTION: HERO */}
        {visibleSections.includes('hero') && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            <div
              className={`${
                lowBandwidth ? 'lg:col-span-12' : 'lg:col-span-6'
              } flex flex-col justify-between p-8 rounded-xl border ${cardSurfaceClass}`}
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-xs font-medium ${mutedTextClass}`}>
                    {activeBranch?.neighborhood}, {activeBranch?.city} · {activeBranch?.hours}
                  </p>
                  {workspace.branches.length > 1 && (
                    <select
                      value={activeBranch?.id || ''}
                      onChange={(e) => setActiveBranchId(e.target.value)}
                      className={`px-2.5 py-1 text-xs rounded-lg border ${
                        isDark
                          ? 'bg-neutral-900 border-neutral-700 text-neutral-200'
                          : 'bg-white border-neutral-300 text-neutral-800'
                      }`}
                    >
                      {workspace.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <h1
                  className={`text-3xl lg:text-[2.75rem] leading-[1.1] font-bold tracking-tight text-balance ${headingFontClass}`}
                >
                  {t(workspace.websiteConfig.heroHeadline)}
                </h1>
                <p className={`text-base leading-relaxed max-w-xl ${mutedTextClass}`}>
                  {t(workspace.websiteConfig.heroSubheadline)}
                </p>
              </div>

              <div className="pt-6 mt-6 border-t border-neutral-200/20 flex flex-wrap items-center gap-3">
                <a
                  href="#storefront-menu"
                  style={{ backgroundColor: accent }}
                  className="px-5 py-2.5 text-sm font-semibold text-white rounded-lg whitespace-nowrap"
                >
                  {ui.orderNow}
                </a>
                <button
                  type="button"
                  onClick={onBackToDashboard}
                  className={`px-4 py-2.5 text-xs font-semibold rounded-lg border cursor-pointer whitespace-nowrap ${
                    isDark
                      ? 'border-neutral-700 text-neutral-300 hover:bg-neutral-800'
                      : 'border-neutral-300 text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  {ui.editWorkspace}
                </button>
              </div>
            </div>

            {!lowBandwidth && (
              <div className="lg:col-span-6 relative rounded-xl overflow-hidden border border-neutral-200/20 min-h-[300px]">
                {!heroImgFailed ? (
                  <img
                    src={workspace.websiteConfig.heroImage}
                    alt={workspace.businessName}
                    referrerPolicy="no-referrer"
                    onError={() => setHeroImgFailed(true)}
                    className="w-full h-full object-cover lg:absolute lg:inset-0"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-neutral-800 text-neutral-200 p-8">
                    <p className="font-semibold">{workspace.businessName}</p>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* SECTION: OUTLET SWITCHER (Hotels & Multi-Outlet Businesses) */}
        {(visibleSections.includes('outlet_switcher') || workspace.outlets.length > 1) && (
          <section className="space-y-3">
            <h2 className={`text-sm font-bold ${mutedTextClass}`}>{ui.selectOutlet}</h2>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {workspace.outlets.map((outlet) => {
                const active = outlet.id === activeOutletId;
                return (
                  <button
                    key={outlet.id}
                    type="button"
                    onClick={() => {
                      setActiveOutletId(outlet.id);
                      setSelectedCategoryId('all');
                    }}
                    style={active ? { backgroundColor: accent } : undefined}
                    className={`px-4 py-2.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'text-white border-transparent'
                        : isDark
                          ? 'bg-neutral-900 border-neutral-700 text-neutral-300'
                          : 'bg-white border-neutral-200 text-neutral-800 hover:border-neutral-400'
                    }`}
                  >
                    {t(outlet.name)}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* SECTION: FASTING (TSOM) BANNER */}
        {(visibleSections.includes('fasting_banner') ||
          workspace.enabledCapabilities.includes('fasting_menu_mode')) && (
          <section
            className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${cardSurfaceClass}`}
          >
            <div>
              <p className="text-sm font-bold">
                {fastingOnly ? ui.fastingActiveNote : ui.fastingBannerTitle}
              </p>
              <p className={`text-xs ${mutedTextClass}`}>{ui.fastingBannerDesc}</p>
            </div>
            <button
              type="button"
              onClick={() => setFastingOnly(!fastingOnly)}
              style={fastingOnly ? { backgroundColor: accent } : undefined}
              className={`px-4 py-2 text-xs font-semibold rounded-lg border cursor-pointer whitespace-nowrap shrink-0 ${
                fastingOnly
                  ? 'text-white border-transparent'
                  : isDark
                    ? 'border-neutral-700 text-neutral-200'
                    : 'border-neutral-300 text-neutral-900'
              }`}
            >
              {ui.fastingFilter}: {fastingOnly ? 'ON' : 'OFF'}
            </button>
          </section>
        )}

        {/* SECTION: FEATURED SELECTION */}
        {visibleSections.includes('featured_menu') && featuredProducts.length > 0 && (
          <section className="space-y-5">
            <h2 className={`text-2xl font-bold tracking-tight ${headingFontClass}`}>
              {ui.featured}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {featuredProducts.map((item) => {
                const soldOut = item.availability.status === 'sold_out';
                return (
                  <div
                    key={item.id}
                    className={`p-5 rounded-xl border flex flex-col justify-between gap-4 ${cardSurfaceClass}`}
                  >
                    <div className="space-y-2">
                      <p className={`text-xs ${mutedTextClass}`}>
                        {item.dietaryTags.join(' · ')}
                      </p>
                      <h3 className="text-lg font-bold leading-snug">{t(item.name)}</h3>
                      <p className={`text-xs leading-relaxed ${mutedTextClass}`}>
                        {t(item.description)}
                      </p>
                    </div>
                    <div className="pt-3 border-t border-neutral-200/20 flex items-center justify-between gap-2">
                      <span className="text-base font-bold font-mono-tabular">
                        {formatEtb(item.basePriceEtb)}
                      </span>
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => openProductModal(item)}
                        style={!soldOut ? { backgroundColor: accent } : undefined}
                        className={`px-3.5 py-2 text-xs font-semibold rounded-lg whitespace-nowrap ${
                          soldOut
                            ? 'bg-neutral-300 text-neutral-600 cursor-not-allowed'
                            : 'text-white cursor-pointer'
                        }`}
                      >
                        {soldOut ? ui.soldOut : ui.chooseOption}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* SECTION: FULL INTERACTIVE MENU */}
        {visibleSections.includes('full_catalog') && (
          <section id="storefront-menu" className="space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h2 className={`text-2xl font-bold tracking-tight ${headingFontClass}`}>
                {ui.menu}
              </h2>
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategoryId('all')}
                  style={
                    selectedCategoryId === 'all' ? { backgroundColor: accent } : undefined
                  }
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedCategoryId === 'all'
                      ? 'text-white'
                      : isDark
                        ? 'bg-neutral-800 text-neutral-300'
                        : 'bg-neutral-200/70 text-neutral-700'
                  }`}
                >
                  {ui.allItems}
                </button>
                {outletCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(cat.id)}
                    style={
                      selectedCategoryId === cat.id
                        ? { backgroundColor: accent }
                        : undefined
                    }
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedCategoryId === cat.id
                        ? 'text-white'
                        : isDark
                          ? 'bg-neutral-800 text-neutral-300'
                          : 'bg-neutral-200/70 text-neutral-700'
                    }`}
                  >
                    {t(cat.name)}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleProducts.map((product) => {
                const soldOut = product.availability.status === 'sold_out';
                const lowStock = product.availability.status === 'low_stock';
                const preOrder = product.availability.status === 'pre_order_only';
                return (
                  <div
                    key={product.id}
                    className={`p-5 rounded-xl border flex flex-col justify-between gap-4 ${cardSurfaceClass}`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-base font-bold">{t(product.name)}</h3>
                        <span className="text-sm font-bold font-mono-tabular whitespace-nowrap">
                          {formatEtb(product.basePriceEtb)}
                        </span>
                      </div>
                      <p className={`text-xs leading-relaxed ${mutedTextClass}`}>
                        {t(product.description)}
                      </p>
                      <p className={`text-[11px] pt-1 ${mutedTextClass}`}>
                        {[
                          product.variations.length > 0
                            ? `${product.variations.length} sizes`
                            : null,
                          product.modifierGroups.length > 0
                            ? `${product.modifierGroups.length} modifier groups`
                            : null,
                          lowStock && product.availability.remainingCount
                            ? `${product.availability.remainingCount} ${ui.lowStock}`
                            : null,
                          preOrder ? ui.preOrderOnly : null,
                          product.availability.timeWindow || null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-neutral-200/20">
                      <span className={`text-xs ${mutedTextClass}`}>
                        ~{product.prepTimeMinutes} {ui.prepTime}
                      </span>
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => openProductModal(product)}
                        style={!soldOut ? { backgroundColor: accent } : undefined}
                        className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap ${
                          soldOut
                            ? 'bg-neutral-300 text-neutral-600 cursor-not-allowed'
                            : 'text-white cursor-pointer'
                        }`}
                      >
                        {soldOut ? ui.soldOut : ui.addToOrder}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* SECTION: STORY & REGIONAL HERITAGE */}
        {visibleSections.includes('story_heritage') && (
          <section className={`p-6 lg:p-8 rounded-xl border space-y-3 ${cardSurfaceClass}`}>
            <h2 className={`text-xl font-bold ${headingFontClass}`}>
              {ui.storyHeritageTitle}
            </h2>
            <p className={`text-sm leading-relaxed max-w-3xl ${mutedTextClass}`}>
              {ui.storyHeritageBody}
            </p>
          </section>
        )}

        {/* SECTION: COFFEE LOYALTY CARD (Coffee Houses) */}
        {visibleSections.includes('loyalty_card') &&
          workspace.enabledCapabilities.includes('coffee_loyalty') && (
            <section className={`p-6 rounded-xl border space-y-4 ${cardSurfaceClass}`}>
              <div className="flex items-center gap-2">
                <Coffee className="w-5 h-5" style={{ color: accent }} />
                <h2 className={`text-xl font-bold ${headingFontClass}`}>{ui.loyaltyTitle}</h2>
              </div>
              <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <input
                    type="text"
                    value={loyaltyPhoneSearch}
                    onChange={(e) => setLoyaltyPhoneSearch(e.target.value)}
                    placeholder={ui.yourPhone}
                    className={`px-3.5 py-2 text-sm font-mono-tabular rounded-lg border w-full sm:w-64 ${
                      isDark
                        ? 'bg-neutral-900 border-neutral-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-950'
                    }`}
                  />
                  {isDbBacked && (
                    <button
                      type="button"
                      onClick={() => void handleCheckLoyalty()}
                      style={{ backgroundColor: accent }}
                      className="px-3.5 py-2 text-xs font-semibold text-white rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      Check
                    </button>
                  )}
                </div>
                {isDbBacked ? (
                  serverLoyaltyResult ? (
                    <div className="text-sm">
                      <span className="font-bold">{serverLoyaltyResult.maskedName}:</span>{' '}
                      <span className="font-mono-tabular font-semibold">
                        {serverLoyaltyResult.stampsBalance} / {serverLoyaltyResult.targetStamps}{' '}
                        stamps
                      </span>{' '}
                      <span className={mutedTextClass}>
                        (
                        {Math.max(
                          0,
                          serverLoyaltyResult.targetStamps - serverLoyaltyResult.stampsBalance
                        )}{' '}
                        away from free cup)
                      </span>
                    </div>
                  ) : (
                    <p className={`text-xs ${mutedTextClass}`}>
                      {loyaltyLookupDone
                        ? 'No loyalty card found for that phone yet. Place an order to start earning stamps!'
                        : 'Enter your phone and click Check to view your Coffee Pass balance.'}
                    </p>
                  )
                ) : matchedLoyalty ? (
                  <div className="text-sm">
                    <span className="font-bold">{matchedLoyalty.name}:</span>{' '}
                    <span className="font-mono-tabular font-semibold">
                      {matchedLoyalty.stamps} / {matchedLoyalty.targetStamps} stamps
                    </span>{' '}
                    <span className={mutedTextClass}>
                      ({matchedLoyalty.targetStamps - matchedLoyalty.stamps} away from free cup)
                    </span>
                  </div>
                ) : (
                  <p className={`text-xs ${mutedTextClass}`}>
                    Enter your phone at checkout to collect a stamp automatically.
                  </p>
                )}
              </div>
            </section>
          )}

        {/* SECTION: ALL ACTIVE SPECIAL REQUEST FORMS (Custom Cake / Coffee Ceremony / Table Reservation) */}
        {(
          [
            {
              sec: 'custom_cake_form' as const,
              kind: 'custom_cake' as const,
              title: ui.customCake,
              partyPlaceholder: 'Weight / Tiers (e.g., 2.5 kg)',
              detailsPlaceholder: 'Flavor, frosting & cake inscription message...',
            },
            {
              sec: 'coffee_ceremony_showcase' as const,
              kind: 'coffee_ceremony' as const,
              title: ui.coffeeCeremony,
              partyPlaceholder: 'Guests (e.g., 6 Guests)',
              detailsPlaceholder: 'Roast preference, incense & seating notes...',
            },
            {
              sec: 'table_reservation' as const,
              kind: 'table_reservation' as const,
              title: ui.reserveTable,
              partyPlaceholder: 'Guests (e.g., 4 Guests)',
              detailsPlaceholder: 'Seating preference or dietary notes...',
            },
          ] as const
        )
          .filter((item) => visibleSections.includes(item.sec))
          .map((item) => {
            const f = getReqField(item.kind);
            return (
              <section
                key={item.sec}
                className={`p-6 lg:p-8 rounded-xl border space-y-4 ${cardSurfaceClass}`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5" style={{ color: accent }} />
                  <h2 className={`text-xl font-bold ${headingFontClass}`}>{item.title}</h2>
                </div>

                {f.errorMessage && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold">
                    {f.errorMessage}
                  </div>
                )}

                {f.savedMessage && (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    <span>{f.savedMessage}</span>
                  </div>
                )}

                <form
                  onSubmit={(e) => void handleSpecialRequestSubmit(e, item.kind)}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
                >
                  <input
                    type="text"
                    required
                    value={f.name}
                    onChange={(e) => updateReqField(item.kind, { name: e.target.value })}
                    placeholder={ui.yourName}
                    className={`px-3.5 py-2.5 text-sm rounded-lg border ${
                      isDark
                        ? 'bg-neutral-900 border-neutral-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-950'
                    }`}
                  />
                  <input
                    type="text"
                    required
                    value={f.phone}
                    onChange={(e) => updateReqField(item.kind, { phone: e.target.value })}
                    placeholder={ui.yourPhone}
                    className={`px-3.5 py-2.5 text-sm font-mono-tabular rounded-lg border ${
                      isDark
                        ? 'bg-neutral-900 border-neutral-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-950'
                    }`}
                  />
                  <input
                    type="text"
                    value={f.date}
                    onChange={(e) => updateReqField(item.kind, { date: e.target.value })}
                    placeholder="Preferred Date & Time"
                    className={`px-3.5 py-2.5 text-sm rounded-lg border ${
                      isDark
                        ? 'bg-neutral-900 border-neutral-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-950'
                    }`}
                  />
                  <input
                    type="text"
                    value={f.partyOrSize}
                    onChange={(e) =>
                      updateReqField(item.kind, { partyOrSize: e.target.value })
                    }
                    placeholder={item.partyPlaceholder}
                    className={`px-3.5 py-2.5 text-sm rounded-lg border ${
                      isDark
                        ? 'bg-neutral-900 border-neutral-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-950'
                    }`}
                  />
                  <input
                    type="text"
                    value={f.details}
                    onChange={(e) => updateReqField(item.kind, { details: e.target.value })}
                    placeholder={item.detailsPlaceholder}
                    className={`sm:col-span-2 lg:col-span-3 px-3.5 py-2.5 text-sm rounded-lg border ${
                      isDark
                        ? 'bg-neutral-900 border-neutral-700 text-white'
                        : 'bg-white border-neutral-300 text-neutral-950'
                    }`}
                  />
                  <button
                    type="submit"
                    disabled={f.submitting}
                    style={{ backgroundColor: accent }}
                    className="px-4 py-2.5 text-xs font-semibold text-white rounded-lg cursor-pointer whitespace-nowrap disabled:opacity-60"
                  >
                    {f.submitting ? 'Sending...' : ui.submitRequest}
                  </button>
                </form>
              </section>
            );
          })}

        {/* SECTION: BRANCHES & HOURS */}
        {visibleSections.includes('branch_hours') && (
          <footer
            className={`pt-8 border-t ${
              isDark ? 'border-neutral-800' : 'border-neutral-200'
            } flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs ${mutedTextClass}`}
          >
            <div>
              <p className="font-semibold text-current">{workspace.businessName}</p>
              <p>
                {workspace.branches.map((b) => `${b.name} (${b.hours})`).join(' · ')}
              </p>
            </div>
            <p>Powered by AMAL Platform · Currency: ETB</p>
          </footer>
        )}
      </div>

      {/* PRODUCT MODIFIER & VARIATION MODAL */}
      {configuringProduct && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="bg-white text-neutral-950 rounded-xl border border-neutral-200 max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold">{t(configuringProduct.name)}</h3>
                <p className="text-xs text-neutral-600 mt-1">
                  {t(configuringProduct.description)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfiguringProduct(null)}
                className="p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Variations */}
            {configuringProduct.variations.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-neutral-800">
                  Size / Variation ({ui.required})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {configuringProduct.variations.map((v) => {
                    const selected = selectedVariationId === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVariationId(v.id)}
                        className={`p-3 rounded-lg border text-left flex items-center justify-between cursor-pointer ${
                          selected
                            ? 'border-neutral-950 bg-neutral-950 text-white'
                            : 'border-neutral-200 hover:border-neutral-400'
                        }`}
                      >
                        <span className="text-xs font-semibold">{t(v.name)}</span>
                        <span className="text-xs font-mono-tabular">
                          {v.priceDeltaEtb > 0 ? `+${formatEtb(v.priceDeltaEtb)}` : 'Base'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Modifier Groups */}
            {configuringProduct.modifierGroups.map((mg) => {
              const chosen = selectedModifiers[mg.id] || [];
              return (
                <div key={mg.id} className="space-y-2 pt-2 border-t border-neutral-100">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-neutral-800">{t(mg.name)}</p>
                    <span className="text-[11px] text-neutral-500">
                      {mg.required ? ui.required : ui.optional} · Max {mg.maxSelect}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {mg.options.map((opt) => {
                      const isChosen = chosen.includes(opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={!opt.available}
                          onClick={() =>
                            toggleModifierOption(mg.id, opt.id, mg.maxSelect)
                          }
                          className={`w-full p-2.5 rounded-lg border text-left flex items-center justify-between text-xs ${
                            !opt.available
                              ? 'opacity-45 cursor-not-allowed border-neutral-200 bg-neutral-50'
                              : isChosen
                                ? 'border-[#0F4C3A] bg-[#0F4C3A]/[0.06] font-semibold cursor-pointer'
                                : 'border-neutral-200 hover:border-neutral-300 cursor-pointer'
                          }`}
                        >
                          <span>
                            {t(opt.name)} {!opt.available ? `(${ui.soldOut})` : ''}
                          </span>
                          <span className="font-mono-tabular">
                            {opt.priceDeltaEtb > 0
                              ? `+${formatEtb(opt.priceDeltaEtb)}`
                              : 'Included'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {configError && (
              <p className="text-xs font-semibold text-red-600">{configError}</p>
            )}

            <div className="pt-4 border-t border-neutral-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 border border-neutral-300 rounded-lg px-2 py-1">
                <button
                  type="button"
                  onClick={() => setItemQuantity(Math.max(1, itemQuantity - 1))}
                  className="p-1 cursor-pointer"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span className="text-sm font-mono-tabular font-semibold px-2">
                  {itemQuantity}
                </span>
                <button
                  type="button"
                  onClick={() => setItemQuantity(itemQuantity + 1)}
                  className="p-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={handleConfirmAddToCart}
                style={{ backgroundColor: accent }}
                className="flex-1 py-2.5 px-4 text-xs font-semibold text-white rounded-lg cursor-pointer font-mono-tabular"
              >
                {ui.addToOrder} · {formatEtb(currentModalUnitPrice * itemQuantity)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CART & CHECKOUT DRAWER */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end">
          <div className="bg-white text-neutral-950 w-full max-w-md h-full overflow-y-auto p-6 flex flex-col justify-between gap-6">
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
                <h3 className="text-lg font-bold">{ui.cart}</h3>
                <button
                  type="button"
                  onClick={() => setCartOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-neutral-100 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {confirmedOrder ? (
                <div className="p-5 rounded-xl bg-emerald-50 border border-emerald-200 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                    <Check className="w-4 h-4" />
                    <span>Order {confirmedOrder.orderNumber} Confirmed</span>
                  </div>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    Sent to {confirmedOrder.outletName} ({confirmedOrder.workflow.replace('_', ' ')}
                    {confirmedOrder.stationLabel ? ` · ${confirmedOrder.stationLabel}` : ''}).
                    Switch back to AMAL Workspace → Orders & Operations to manage this live
                    ticket.
                  </p>
                  <p className="text-sm font-mono-tabular font-bold text-emerald-950">
                    Total: {formatEtb(confirmedOrder.totalEtb)} (
                    {PAYMENT_PROVIDERS[confirmedOrder.paymentProvider].name} ·{' '}
                    {confirmedOrder.paymentStatus.replace('_', ' ')})
                  </p>
                  {confirmedOrder.paymentMessage && (
                    <p className="text-xs text-emerald-800">{confirmedOrder.paymentMessage}</p>
                  )}
                  <button
                    type="button"
                    onClick={onBackToDashboard}
                    className="w-full py-2 text-xs font-semibold text-white bg-neutral-950 rounded-lg cursor-pointer"
                  >
                    View Ticket in Merchant Dashboard
                  </button>
                </div>
              ) : cart.length === 0 ? (
                <p className="text-sm text-neutral-500 py-8 text-center">{ui.emptyCart}</p>
              ) : (
                <>
                  <ul className="divide-y divide-neutral-100">
                    {cart.map((item) => (
                      <li key={item.id} className="py-3 flex justify-between gap-3 text-xs">
                        <div>
                          <p className="font-bold text-neutral-950">
                            {item.quantity}x {item.productName}
                          </p>
                          {item.variationName && (
                            <p className="text-neutral-500">{item.variationName}</p>
                          )}
                          {item.selectedModifiers.length > 0 && (
                            <p className="text-neutral-500">
                              + {item.selectedModifiers.map((m) => m.optionName).join(', ')}
                            </p>
                          )}
                        </div>
                        <div className="text-right font-mono-tabular">
                          <p className="font-semibold">
                            {formatEtb(item.unitPriceEtb * item.quantity)}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setCart((prev) => prev.filter((c) => c.id !== item.id))
                            }
                            className="text-red-600 hover:underline mt-1 cursor-pointer"
                          >
                            {ui.remove}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {checkoutError && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
                      {checkoutError}
                    </div>
                  )}

                  <form
                    id="amal-checkout-form"
                    onSubmit={handleCheckoutSubmit}
                    className="space-y-4 pt-4 border-t border-neutral-200"
                  >
                    <div className="space-y-1.5">
                      <span className="text-xs font-bold text-neutral-800 block">
                        {ui.orderWorkflow}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {workspace.allowedWorkflows.map((wf) => (
                          <button
                            key={wf}
                            type="button"
                            onClick={() => setWorkflow(wf)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                              workflow === wf
                                ? 'bg-neutral-950 text-white border-neutral-950'
                                : 'border-neutral-200 text-neutral-700'
                            }`}
                          >
                            {wf === 'dine_in'
                              ? ui.dineIn
                              : wf === 'takeaway'
                                ? ui.takeaway
                                : wf === 'delivery'
                                  ? ui.delivery
                                  : wf === 'room_service'
                                    ? ui.roomService
                                    : ui.preOrder}
                          </button>
                        ))}
                      </div>
                    </div>

                    {(workflow === 'room_service' || workflow === 'dine_in') && (
                      <input
                        type="text"
                        value={roomOrTableInput}
                        onChange={(e) => setRoomOrTableInput(e.target.value)}
                        placeholder={
                          workflow === 'room_service'
                            ? 'Hotel Room Number (e.g., Room 204)'
                            : 'Table / Mesob Number'
                        }
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                      />
                    )}

                    {workflow === 'pre_order' && (
                      <input
                        type="text"
                        value={pickupSlot}
                        onChange={(e) => setPickupSlot(e.target.value)}
                        placeholder="Pickup Date & Time Window"
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                      />
                    )}

                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder={ui.yourName}
                      className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                    />
                    <input
                      type="text"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder={ui.yourPhone}
                      className="w-full px-3 py-2 text-sm font-mono-tabular border border-neutral-300 rounded-lg"
                    />

                    <div className="space-y-1.5">
                      <span className="text-xs font-bold text-neutral-800 block">
                        {ui.paymentMethod}
                      </span>
                      <div className="grid grid-cols-2 gap-2">
                        {workspace.localization.acceptedPayments.map((pid) => (
                          <button
                            key={pid}
                            type="button"
                            onClick={() => setPaymentProvider(pid)}
                            className={`p-2 text-xs font-semibold rounded-lg border text-left cursor-pointer ${
                              paymentProvider === pid
                                ? 'border-[#0F4C3A] bg-[#0F4C3A]/[0.06] text-[#0F4C3A]'
                                : 'border-neutral-200 text-neutral-700'
                            }`}
                          >
                            {PAYMENT_PROVIDERS[pid].name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </form>
                </>
              )}
            </div>

            {cart.length > 0 && !confirmedOrder && (
              <div className="pt-4 border-t border-neutral-200 space-y-3">
                <div className="flex items-center justify-between text-sm font-bold">
                  <span>{ui.total}</span>
                  <span className="font-mono-tabular text-base">
                    {formatEtb(cartTotalEtb)}
                  </span>
                </div>
                <button
                  type="submit"
                  form="amal-checkout-form"
                  disabled={submittingCheckout}
                  style={{ backgroundColor: accent }}
                  className="w-full py-3 text-xs font-semibold text-white rounded-lg cursor-pointer disabled:opacity-60"
                >
                  {submittingCheckout
                    ? 'Submitting Order...'
                    : `${ui.placeOrder} · ${formatEtb(cartTotalEtb)}`}
                </button>
                {workspace.localization.whatsappOrderingEnabled && (
                  <a
                    href={buildWhatsappUrl()}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full py-2.5 text-xs font-semibold text-neutral-800 bg-neutral-100 rounded-lg flex items-center justify-center gap-2 hover:bg-neutral-200"
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-700" />
                    <span>{ui.whatsappOrder}</span>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
