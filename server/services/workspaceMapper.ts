import { asc, desc, eq, isNull } from 'drizzle-orm';
import {
  branches,
  customers,
  inventoryItems,
  loyaltyAccounts,
  menuCategories,
  modifierGroups,
  modifierOptions,
  orderItemModifiers,
  orderItems,
  orders,
  outlets,
  productModifierGroups,
  products,
  productVariations,
  qrStations,
  specialRequests,
  tenantMembershipBranches,
  tenantMembershipOutlets,
  tenantMemberships,
  tenants,
  users,
  websiteConfigs,
} from '../../src/db/schema';
import type {
  AvailabilityRule,
  BusinessTypeId,
  BusinessWorkspace,
  CapabilityId,
  LanguageCode,
  ModifierGroup,
  OrderLineItem,
  OrderRecord,
  OrderingWorkflow,
  PaymentProviderId,
  Product,
  QrStation,
  StaffMember,
  WebsiteSectionKey,
  WebsiteTemplateId,
} from '../../src/types/amal';
import type { TenantScopedTx } from '../db/tenantTx';
import { decryptQrToken, minorToEtb } from '../utils/cryptoAndMoney';

/**
 * Evaluates whether a midnight-crossing time window (e.g. 18:00 -> 02:00)
 * is open at a given HH:MM:SS string inside the branch's local timezone.
 */
export function isWithinTimeWindow(
  currentLocalTime: string,
  openTime: string,
  closeTime: string,
  crossesMidnight: boolean
): boolean {
  if (!crossesMidnight) {
    return currentLocalTime >= openTime && currentLocalTime <= closeTime;
  }
  // Crosses midnight: open if >= openTime OR <= closeTime
  return currentLocalTime >= openTime || currentLocalTime <= closeTime;
}

export function getLocalTimeAndDayInTimezone(timezone: string, date = new Date()): {
  dayOfWeek: number;
  timeStr: string;
  dateStr: string;
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const hour = get('hour') === '24' ? '00' : get('hour');
  return {
    dayOfWeek: weekdayMap[get('weekday')] ?? 0,
    timeStr: `${hour}:${get('minute')}:${get('second')}`,
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export interface HydratedWorkspaceResponse extends BusinessWorkspace {
  planTier: string;
  subscriptionStatus: string;
  vatRegistered: boolean;
  defaultTaxRateBps: number;
  maxBranches: number;
  maxOutlets: number;
}

export async function hydrateWorkspaceForTenant(
  tx: TenantScopedTx,
  tenantId: string,
  options?: { includeSensitiveCustomerData?: boolean }
): Promise<HydratedWorkspaceResponse | null> {
  const includePii = options?.includeSensitiveCustomerData ?? false;

  const [tenant] = await tx
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant || tenant.deletedAt) return null;

  const [
    branchRows,
    outletRows,
    catRows,
    productRows,
    variationRows,
    mgRows,
    moRows,
    pmgRows,
    invRows,
    qrRows,
    websiteRowList,
  ] = await Promise.all([
    tx.select().from(branches).where(isNull(branches.deletedAt)).orderBy(asc(branches.createdAt)),
    tx.select().from(outlets).where(isNull(outlets.deletedAt)).orderBy(asc(outlets.createdAt)),
    tx
      .select()
      .from(menuCategories)
      .where(isNull(menuCategories.deletedAt))
      .orderBy(asc(menuCategories.sortOrder)),
    tx.select().from(products).where(isNull(products.deletedAt)).orderBy(asc(products.createdAt)),
    tx
      .select()
      .from(productVariations)
      .where(isNull(productVariations.deletedAt))
      .orderBy(asc(productVariations.sortOrder)),
    tx.select().from(modifierGroups).where(isNull(modifierGroups.deletedAt)),
    tx
      .select()
      .from(modifierOptions)
      .where(isNull(modifierOptions.deletedAt))
      .orderBy(asc(modifierOptions.sortOrder)),
    tx.select().from(productModifierGroups).orderBy(asc(productModifierGroups.sortOrder)),
    tx.select().from(inventoryItems),
    tx.select().from(qrStations).where(isNull(qrStations.deletedAt)),
    tx.select().from(websiteConfigs).limit(1),
  ]);

  const web = websiteRowList[0];

  // Build modifier groups map
  const optionsByGroup = new Map<string, ModifierGroup['options']>();
  for (const mo of moRows) {
    const list = optionsByGroup.get(mo.modifierGroupId) || [];
    list.push({
      id: mo.id,
      name: mo.nameJson,
      priceDeltaEtb: minorToEtb(mo.priceDeltaMinor),
      available: mo.isAvailable,
    });
    optionsByGroup.set(mo.modifierGroupId, list);
  }

  const groupMap = new Map<string, ModifierGroup>();
  for (const mg of mgRows) {
    groupMap.set(mg.id, {
      id: mg.id,
      name: mg.nameJson,
      required: mg.isRequired,
      minSelect: mg.minSelect,
      maxSelect: mg.maxSelect,
      options: optionsByGroup.get(mg.id) || [],
    });
  }

  const invByProduct = new Map<string, typeof invRows[number]>();
  for (const inv of invRows) {
    if (!inv.variationId) {
      invByProduct.set(inv.productId, inv);
    }
  }

  const mappedProducts: Product[] = productRows.map((p) => {
    const pVars = variationRows
      .filter((v) => v.productId === p.id)
      .map((v) => ({
        id: v.id,
        name: v.nameJson,
        priceDeltaEtb: minorToEtb(v.priceDeltaMinor),
        sku: v.sku || undefined,
      }));

    const pGroups = pmgRows
      .filter((pmg) => pmg.productId === p.id)
      .map((pmg) => groupMap.get(pmg.modifierGroupId))
      .filter((g): g is ModifierGroup => Boolean(g));

    const inv = invByProduct.get(p.id);
    const derivedStatus: AvailabilityRule['status'] =
      inv && inv.trackStock
        ? inv.availableQty <= 0
          ? 'sold_out'
          : inv.availableQty <= inv.lowStockThreshold
            ? 'low_stock'
            : (p.availabilityStatus as AvailabilityRule['status'])
        : (p.availabilityStatus as AvailabilityRule['status']);

    return {
      id: p.id,
      categoryId: p.categoryId,
      outletId: p.outletId,
      name: p.nameJson,
      description: p.descriptionJson,
      basePriceEtb: minorToEtb(p.basePriceMinor),
      dietaryTags: p.dietaryTags,
      prepTimeMinutes: p.prepTimeMinutes,
      variations: pVars,
      modifierGroups: pGroups,
      availability: {
        status: derivedStatus,
        remainingCount: inv && inv.trackStock ? inv.availableQty : undefined,
        fastingDayEligible: p.fastingDayEligible,
        fastingOnly: p.fastingOnly,
        timeWindow: p.timeWindow || undefined,
        leadTimeHours: p.leadTimeHours ?? undefined,
      },
      featured: p.isFeatured,
      isCombo: p.isCombo,
    };
  });

  const mappedQrStations: QrStation[] = qrRows.map((q) => {
    let scanToken = q.id;
    try {
      scanToken = decryptQrToken({
        ciphertext: q.tokenCiphertext,
        iv: q.tokenIv,
        authTag: q.tokenAuthTag,
      });
    } catch {
      // Fallback if key rotated
    }
    return {
      id: q.id,
      label: q.label,
      stationType: q.stationType as QrStation['stationType'],
      outletId: q.outletId,
      capacityOrZone: q.capacityOrZone,
      status: q.status as QrStation['status'],
      scanToken,
    };
  });

  let mappedOrders: OrderRecord[] = [];
  let mappedRequests: BusinessWorkspace['specialRequests'] = [];
  let mappedLoyalty: BusinessWorkspace['loyaltyMembers'] = [];
  let mappedStaff: StaffMember[] = [];

  if (includePii) {
    const [
      orderRows,
      oiRows,
      oimRows,
      srRows,
      laRows,
      custRows,
      membershipRows,
      membershipBranchRows,
      membershipOutletRows,
    ] = await Promise.all([
      tx.select().from(orders).orderBy(desc(orders.createdAt)).limit(100),
      tx.select().from(orderItems),
      tx.select().from(orderItemModifiers),
      tx.select().from(specialRequests).orderBy(desc(specialRequests.createdAt)).limit(50),
      tx.select().from(loyaltyAccounts),
      tx.select().from(customers).where(isNull(customers.deletedAt)),
      tx
        .select({
          membershipId: tenantMemberships.id,
          roleId: tenantMemberships.roleId,
          scopeType: tenantMemberships.scopeType,
          status: tenantMemberships.status,
          fullName: users.fullName,
          email: users.email,
        })
        .from(tenantMemberships)
        .innerJoin(users, eq(users.id, tenantMemberships.userId)),
      tx.select().from(tenantMembershipBranches),
      tx.select().from(tenantMembershipOutlets),
    ]);

    const outletNameMap = new Map(outletRows.map((o) => [o.id, o.nameJson.en]));
    const customerMap = new Map(custRows.map((c) => [c.id, c]));
    const productMap = new Map(productRows.map((p) => [p.id, p.nameJson.en]));

    mappedOrders = orderRows.map((ord) => {
      const items: OrderLineItem[] = oiRows
        .filter((oi) => oi.orderId === ord.id)
        .map((oi) => ({
          id: oi.id,
          productId: oi.productId,
          productName: oi.productNameSnapshot,
          variationName: oi.variationNameSnapshot || undefined,
          selectedModifiers: oimRows
            .filter((m) => m.orderItemId === oi.id)
            .map((m) => ({
              groupName: m.groupNameSnapshot,
              optionName: m.optionNameSnapshot,
              priceDeltaEtb: minorToEtb(m.priceDeltaMinor),
            })),
          quantity: oi.quantity,
          unitPriceEtb: minorToEtb(oi.unitTotalMinor),
          notes: oi.notes || undefined,
        }));

      return {
        id: ord.id,
        orderNumber: ord.orderNumber,
        createdAt: ord.createdAt.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        workflow: ord.workflow as OrderingWorkflow,
        outletId: ord.outletId,
        outletName: outletNameMap.get(ord.outletId) || tenant.businessName,
        stationLabel: ord.stationLabelSnapshot || undefined,
        customerName: ord.customerNameSnapshot,
        customerPhone: ord.customerPhoneSnapshot,
        paymentProvider: ord.paymentProvider as PaymentProviderId,
        paymentStatus: ord.paymentStatus as OrderRecord['paymentStatus'],
        status: ord.status as OrderRecord['status'],
        items,
        totalEtb: minorToEtb(ord.totalMinor),
        pickupScheduledFor: ord.pickupScheduledFor || undefined,
      };
    });

    mappedRequests = srRows.map((sr) => ({
      id: sr.id,
      kind: sr.kind as BusinessWorkspace['specialRequests'][number]['kind'],
      customerName: sr.customerName,
      customerPhone: sr.customerPhone,
      dateTime: sr.requestedDateTime,
      partyOrSize: sr.partyOrSize,
      details: sr.details,
      status: sr.status as BusinessWorkspace['specialRequests'][number]['status'],
      estimatedEtb: sr.estimatedMinor !== null ? minorToEtb(sr.estimatedMinor) : undefined,
    }));

    mappedLoyalty = laRows.map((la) => {
      const cust = customerMap.get(la.customerId);
      return {
        id: la.id,
        name: cust?.fullName || 'Guest',
        phone: cust?.phoneE164 || '',
        stamps: la.stampsBalance,
        targetStamps: la.targetStamps,
        favoriteDrink: (la.favoriteProductId && productMap.get(la.favoriteProductId)) || 'Espresso',
        totalSpentEtb: minorToEtb(la.lifetimeSpentMinor),
      };
    });

    const branchNameMap = new Map(branchRows.map((b) => [b.id, b.name]));
    mappedStaff = membershipRows.map((m) => {
      const bIds = membershipBranchRows
        .filter((mb) => mb.membershipId === m.membershipId)
        .map((mb) => mb.branchId);
      const oIds = membershipOutletRows
        .filter((mo) => mo.membershipId === m.membershipId)
        .map((mo) => mo.outletId);

      let scopeSummary = 'All Branches & Outlets';
      if (m.scopeType === 'branch') {
        scopeSummary =
          bIds.map((id) => branchNameMap.get(id)).filter(Boolean).join(', ') || 'Scoped Branches';
      } else if (m.scopeType === 'outlet') {
        scopeSummary =
          oIds.map((id) => outletNameMap.get(id)).filter(Boolean).join(', ') || 'Scoped Outlets';
      }

      return {
        id: m.membershipId,
        name: m.fullName,
        email: m.email,
        role: m.roleId,
        scopeType: m.scopeType as StaffMember['scopeType'],
        assignedBranchIds: bIds,
        assignedOutletIds: oIds,
        outletName: scopeSummary,
        active: m.status === 'active',
      };
    });
  }

  return {
    id: tenant.id,
    slug: tenant.slug,
    businessName: tenant.businessName,
    tagline: tenant.tagline,
    primaryBusinessType: tenant.primaryBusinessType as BusinessTypeId,
    businessTypes: tenant.businessTypes as BusinessTypeId[],
    enabledCapabilities: tenant.enabledCapabilities as CapabilityId[],
    allowedWorkflows: tenant.allowedWorkflows as OrderingWorkflow[],
    planTier: tenant.planTier,
    subscriptionStatus: tenant.subscriptionStatus,
    vatRegistered: tenant.vatRegistered,
    defaultTaxRateBps: tenant.defaultTaxRateBps,
    maxBranches: tenant.maxBranches,
    maxOutlets: tenant.maxOutlets,
    branches: branchRows.map((b) => ({
      id: b.id,
      name: b.name,
      city: b.city,
      neighborhood: b.neighborhood,
      phone: b.phone,
      whatsappNumber: b.whatsappNumber,
      hours: b.displayHours,
    })),
    outlets: outletRows.map((o) => ({
      id: o.id,
      branchId: o.branchId,
      name: o.nameJson,
      outletKind: o.outletKind as BusinessWorkspace['outlets'][number]['outletKind'],
      description: o.description,
      supportsTables: o.supportsTables,
      supportsRoomService: o.supportsRoomService,
      active: o.active,
    })),
    categories: catRows.map((c) => ({
      id: c.id,
      outletId: c.outletId,
      name: c.nameJson,
      description: c.descriptionJson || undefined,
      regionalOrigin: c.regionalOrigin || undefined,
      isFastingFriendly: c.isFastingFriendly,
      sortOrder: c.sortOrder,
    })),
    products: mappedProducts,
    qrStations: mappedQrStations,
    orders: mappedOrders,
    specialRequests: mappedRequests,
    loyaltyMembers: mappedLoyalty,
    staff: mappedStaff,
    websiteConfig: web
      ? {
          templateId: web.templateId as WebsiteTemplateId,
          accentHex: web.accentHex,
          typographyStyle: web.typographyStyle as BusinessWorkspace['websiteConfig']['typographyStyle'],
          heroHeadline: web.heroHeadlineJson,
          heroSubheadline: web.heroSubheadlineJson,
          heroImage: web.heroImageUrl,
          visibleSections: web.visibleSections as WebsiteSectionKey[],
          lowBandwidthDefault: web.lowBandwidthDefault,
        }
        : {
          templateId: 'traditional_ethiopian',
          accentHex: '#8C3B24',
          typographyStyle: 'editorial',
          heroHeadline: { en: tenant.businessName },
          heroSubheadline: { en: tenant.tagline },
          heroImage: '/src/assets/images/hero_ethiopian_dining_1795378595732.jpg',
          visibleSections: ['hero', 'featured_menu', 'full_catalog', 'branch_hours'],
          lowBandwidthDefault: false,
        },
    localization: web
      ? {
          defaultLanguage: web.defaultLanguage as LanguageCode,
          supportedLanguages: web.supportedLanguages as LanguageCode[],
          currencyCode: 'ETB',
          currencySymbol: 'ETB',
          acceptedPayments: web.acceptedPayments as PaymentProviderId[],
          whatsappOrderingEnabled: web.whatsappOrderingEnabled,
          fastingModeActive: web.fastingModeActive,
        }
      : {
          defaultLanguage: 'en',
          supportedLanguages: ['en', 'am'],
          currencyCode: 'ETB',
          currencySymbol: 'ETB',
          acceptedPayments: ['cash'],
          whatsappOrderingEnabled: true,
          fastingModeActive: false,
        },
    pmsIntegration: web
      ? web.pmsConfigJson
      : {
          enabled: false,
          providerName: 'None',
          roomValidationEndpoint: '',
          folioPostingEnabled: false,
          lastSyncedAt: '',
        },
  };
}
