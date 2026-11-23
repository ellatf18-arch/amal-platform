import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Building2,
  ChefHat,
  Coffee,
  Download,
  ExternalLink,
  Globe,
  LayoutTemplate,
  Plus,
  QrCode,
  Receipt,
  RefreshCw,
  Sparkles,
  Users,
  Utensils,
} from 'lucide-react';
import {
  BUSINESS_CATEGORY_REGISTRY,
  CAPABILITY_LABELS,
  PAYMENT_PROVIDERS,
  WEBSITE_TEMPLATE_REGISTRY,
  formatEtb,
} from '../data/businessRegistry';
import { BUSINESS_PRESETS } from '../data/presets';
import { amalApi, type TenantMembershipSummary } from '../services/apiClient';
import {
  AvailabilityRule,
  BusinessTypeId,
  BusinessWorkspace,
  LanguageCode,
  OrderRecord,
  Outlet,
  PaymentProviderId,
  Product,
  QrStation,
  ReservationOrSpecialRequest,
  WebsiteSectionKey,
  WebsiteTemplateId,
} from '../types/amal';
import { QrCodeSvg } from './QrCodeSvg';

export type DashboardTab =
  | 'overview'
  | 'catalog'
  | 'qr_studio'
  | 'orders'
  | 'website'
  | 'localization';

interface MerchantDashboardProps {
  workspace: BusinessWorkspace;
  allPresetIds: BusinessTypeId[];
  isAuthenticatedWorkspace?: boolean;
  memberships?: TenantMembershipSummary[];
  onSwitchTenant?: (tenantId: string) => Promise<void>;
  onRefreshWorkspace?: () => Promise<void>;
  onSwitchPreset: (typeId: BusinessTypeId) => void;
  onUpdateWorkspace: (updated: BusinessWorkspace) => void;
  onLaunchStorefront: (stationToken?: string) => void;
  onStartOnboarding: () => void;
  legacyBlueprintCandidate?: {
    businessName: string;
    tagline?: string;
    accentHex?: string;
    fastingModeActive?: boolean;
  } | null;
  onImportLocalBlueprint?: () => Promise<void>;
  onDismissLocalBlueprint?: () => void;
}

function defaultStationTypeForBusiness(primaryType: BusinessTypeId): QrStation['stationType'] {
  if (primaryType === 'hotel') return 'room';
  if (primaryType === 'traditional_ethiopian') return 'mesob_table';
  if (primaryType === 'bakery') return 'pickup_zone';
  if (primaryType === 'restaurant') return 'table';
  return 'counter';
}

export const MerchantDashboard: React.FC<MerchantDashboardProps> = ({
  workspace,
  allPresetIds,
  isAuthenticatedWorkspace = false,
  memberships = [],
  onSwitchTenant,
  onRefreshWorkspace,
  onSwitchPreset,
  onUpdateWorkspace,
  onLaunchStorefront,
  onStartOnboarding,
  legacyBlueprintCandidate,
  onImportLocalBlueprint,
  onDismissLocalBlueprint,
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [selectedOutletFilter, setSelectedOutletFilter] = useState<string>('all');
  const [catalogSearch, setCatalogSearch] = useState<string>('');
  const [catalogLang, setCatalogLang] = useState<LanguageCode>('en');
  const [actionNotice, setActionNotice] = useState<string>('');
  const [actionError, setActionError] = useState<string>('');

  // New Product Modal / Inline Form state
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [newProdNameEn, setNewProdNameEn] = useState('');
  const [newProdNameAm, setNewProdNameAm] = useState('');
  const [newProdDescEn, setNewProdDescEn] = useState('');
  const [newProdPrice, setNewProdPrice] = useState('350');
  const [newProdCategoryId, setNewProdCategoryId] = useState(
    workspace.categories[0]?.id || ''
  );
  const [newProdFasting, setNewProdFasting] = useState(false);
  const [newProdSizes, setNewProdSizes] = useState('Regular (+0), Large (+80)');

  // New QR Station form
  const [newStationLabel, setNewStationLabel] = useState('');
  const [newStationZone, setNewStationZone] = useState('');
  const [newStationType, setNewStationType] = useState<QrStation['stationType']>(() =>
    defaultStationTypeForBusiness(workspace.primaryBusinessType)
  );
  const [newStationOutletId, setNewStationOutletId] = useState(
    workspace.outlets[0]?.id || ''
  );

  // New Outlet & Branch form
  const [newOutletBranchId, setNewOutletBranchId] = useState(workspace.branches[0]?.id || '');
  const [newOutletName, setNewOutletName] = useState('');
  const [newOutletDesc, setNewOutletDesc] = useState('');
  const [newOutletKind, setNewOutletKind] = useState<Outlet['outletKind']>('dining_room');

  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchCity, setNewBranchCity] = useState('Addis Ababa');
  const [newBranchNeighborhood, setNewBranchNeighborhood] = useState('');
  const [newBranchPhone, setNewBranchPhone] = useState('+251 11 000 0000');

  // Staff invitation form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState<
    'tenant_manager' | 'branch_manager' | 'outlet_staff' | 'kitchen_staff'
  >('outlet_staff');
  const [inviteScopeType, setInviteScopeType] = useState<'tenant' | 'branch' | 'outlet'>('outlet');
  const [inviteBranchId, setInviteBranchId] = useState(workspace.branches[0]?.id || '');
  const [inviteOutletId, setInviteOutletId] = useState(workspace.outlets[0]?.id || '');

  useEffect(() => {
    setNewProdCategoryId(workspace.categories[0]?.id || '');
    setNewStationOutletId(workspace.outlets[0]?.id || '');
    setNewOutletBranchId(workspace.branches[0]?.id || '');
    setInviteBranchId(workspace.branches[0]?.id || '');
    setInviteOutletId(workspace.outlets[0]?.id || '');
    setNewStationType(defaultStationTypeForBusiness(workspace.primaryBusinessType));
  }, [workspace.id, workspace.primaryBusinessType]);

  const isPresetPreview = allPresetIds.some(
    (typeId) => BUSINESS_PRESETS[typeId].id === workspace.id || BUSINESS_PRESETS[typeId].slug === workspace.slug
  ) && !isAuthenticatedWorkspace;

  const hasCap = (cap: string) =>
    workspace.enabledCapabilities.includes(cap as any);

  const totalRevenueEtb = useMemo(
    () => workspace.orders.reduce((sum, o) => sum + o.totalEtb, 0),
    [workspace.orders]
  );

  const filteredProducts = useMemo(() => {
    return workspace.products.filter((p) => {
      const matchesOutlet =
        selectedOutletFilter === 'all' || p.outletId === selectedOutletFilter;
      const matchesSearch =
        !catalogSearch.trim() ||
        p.name.en.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        (p.name.am && p.name.am.includes(catalogSearch));
      return matchesOutlet && matchesSearch;
    });
  }, [workspace.products, selectedOutletFilter, catalogSearch]);

  const handleToggleProductAvailability = async (
    productId: string,
    status: AvailabilityRule['status']
  ) => {
    setActionError('');
    const updatedProducts = workspace.products.map((p) =>
      p.id === productId
        ? { ...p, availability: { ...p.availability, status } }
        : p
    );
    onUpdateWorkspace({ ...workspace, products: updatedProducts });
    if (isAuthenticatedWorkspace) {
      try {
        await amalApi.updateProductAvailability(productId, status);
        await onRefreshWorkspace?.();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to update availability');
      }
    }
  };

  const handleRestockProduct = async (productId: string, qty: number) => {
    if (!isAuthenticatedWorkspace) return;
    setActionError('');
    try {
      await amalApi.restockProduct(productId, qty, 'Dashboard quick restock');
      setActionNotice(`Added +${qty} stock units.`);
      await onRefreshWorkspace?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to restock item');
    }
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProdNameEn.trim()) return;
    setActionError('');
    const cat =
      workspace.categories.find((c) => c.id === newProdCategoryId) ||
      workspace.categories[0];
    const parsedVariations = newProdSizes
      .split(',')
      .map((s, idx) => {
        const match = s.trim().match(/^(.+?)\s*\(\+?(\d+)\)$/);
        if (match) {
          return {
            id: `v-${Date.now()}-${idx}`,
            name: { en: match[1].trim() },
            priceDeltaEtb: Number(match[2]) || 0,
          };
        }
        return s.trim()
          ? {
              id: `v-${Date.now()}-${idx}`,
              name: { en: s.trim() },
              priceDeltaEtb: 0,
            }
          : null;
      })
      .filter(Boolean) as Product['variations'];

    if (isAuthenticatedWorkspace && cat) {
      try {
        await amalApi.createProduct({
          categoryId: cat.id,
          nameEn: newProdNameEn.trim(),
          nameAm: newProdNameAm.trim() || undefined,
          descriptionEn: newProdDescEn.trim() || 'Freshly prepared to order.',
          basePriceEtb: Math.max(10, Number(newProdPrice) || 250),
          fastingDayEligible: newProdFasting,
          variations: parsedVariations.map((v) => ({
            nameEn: v.name.en,
            priceDeltaEtb: v.priceDeltaEtb,
          })),
        });
        await onRefreshWorkspace?.();
        setActionNotice(`Saved "${newProdNameEn.trim()}" to PostgreSQL catalog.`);
        setNewProdNameEn('');
        setNewProdNameAm('');
        setNewProdDescEn('');
        setShowAddProduct(false);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to create product');
      }
      return;
    }

    const created: Product = {
      id: `prod-${Date.now()}`,
      categoryId: cat?.id || 'cat-default',
      outletId: cat?.outletId || workspace.outlets[0]?.id || 'out-default',
      name: {
        en: newProdNameEn.trim(),
        am: newProdNameAm.trim() || undefined,
      },
      description: {
        en: newProdDescEn.trim() || 'Freshly prepared to order.',
      },
      basePriceEtb: Math.max(10, Number(newProdPrice) || 250),
      dietaryTags: newProdFasting ? ['Tsom / Fasting', 'New'] : ['New'],
      prepTimeMinutes: 10,
      variations: parsedVariations,
      modifierGroups: [],
      availability: {
        status: 'in_stock',
        fastingDayEligible: newProdFasting,
      },
    };

    onUpdateWorkspace({
      ...workspace,
      products: [created, ...workspace.products],
    });
    setNewProdNameEn('');
    setNewProdNameAm('');
    setNewProdDescEn('');
    setShowAddProduct(false);
  };

  const handleAdvanceOrderStatus = async (orderId: string) => {
    setActionError('');
    if (isAuthenticatedWorkspace) {
      try {
        await amalApi.advanceOrderStatus(orderId);
        await onRefreshWorkspace?.();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to update order status');
      }
      return;
    }
    const orderFlow: OrderRecord['status'][] = [
      'new',
      'preparing',
      'ready',
      'completed',
    ];
    const updatedOrders = workspace.orders.map((ord) => {
      if (ord.id !== orderId) return ord;
      const nextIdx = Math.min(
        orderFlow.indexOf(ord.status) + 1,
        orderFlow.length - 1
      );
      return { ...ord, status: orderFlow[nextIdx] };
    });
    onUpdateWorkspace({ ...workspace, orders: updatedOrders });
  };

  const handleUpdateSpecialRequestStatus = async (
    requestId: string,
    status: ReservationOrSpecialRequest['status']
  ) => {
    setActionError('');
    if (isAuthenticatedWorkspace) {
      try {
        await amalApi.updateSpecialRequest(requestId, { status });
        setActionNotice(`Special request marked ${status.replace('_', ' ')}.`);
        await onRefreshWorkspace?.();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to update special request');
      }
      return;
    }
    onUpdateWorkspace({
      ...workspace,
      specialRequests: workspace.specialRequests.map((sr) =>
        sr.id === requestId ? { ...sr, status } : sr
      ),
    });
  };

  const handleCreateQrStation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStationLabel.trim()) return;
    setActionError('');
    const outletId = newStationOutletId || workspace.outlets[0]?.id || 'out-1';

    if (isAuthenticatedWorkspace) {
      try {
        await amalApi.createQrStation({
          label: newStationLabel.trim(),
          stationType: newStationType,
          outletId,
          capacityOrZone: newStationZone.trim() || 'Active Zone',
        });
        await onRefreshWorkspace?.();
        setActionNotice(`Generated cryptographic QR station "${newStationLabel.trim()}".`);
        setNewStationLabel('');
        setNewStationZone('');
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to create QR station');
      }
      return;
    }

    const token = newStationLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const created: QrStation = {
      id: `qr-${Date.now()}`,
      label: newStationLabel.trim(),
      stationType: newStationType,
      outletId,
      capacityOrZone: newStationZone.trim() || 'Active Zone',
      status: 'available',
      scanToken: token || `qr-${Date.now()}`,
    };
    onUpdateWorkspace({
      ...workspace,
      qrStations: [...workspace.qrStations, created],
    });
    setNewStationLabel('');
    setNewStationZone('');
  };

  const handleRotateQrToken = async (stationId: string) => {
    if (!isAuthenticatedWorkspace) return;
    setActionError('');
    try {
      const res = await amalApi.rotateQrStation(stationId);
      setActionNotice(`Rotated QR token to v${res.tokenVersion}. Previous QR code is now invalid.`);
      await onRefreshWorkspace?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to rotate QR token');
    }
  };

  const persistWebsitePatch = async (
    patch: Parameters<typeof amalApi.updateWebsiteConfig>[0]
  ) => {
    if (!isAuthenticatedWorkspace) return;
    setActionError('');
    try {
      await amalApi.updateWebsiteConfig(patch);
      setActionNotice('Website & localization settings saved.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save website configuration');
    }
  };

  const handleSelectWebsiteTemplate = async (templateId: WebsiteTemplateId) => {
    const tmpl = WEBSITE_TEMPLATE_REGISTRY[templateId];
    onUpdateWorkspace({
      ...workspace,
      websiteConfig: {
        ...workspace.websiteConfig,
        templateId,
        accentHex: tmpl.accentHex,
        typographyStyle: tmpl.typographyStyle,
        heroImage: tmpl.heroImage,
        visibleSections: tmpl.defaultSections,
      },
    });
    await persistWebsitePatch({
      templateId,
      accentHex: tmpl.accentHex,
      typographyStyle: tmpl.typographyStyle,
      heroImageUrl: tmpl.heroImage,
      visibleSections: tmpl.defaultSections,
    });
  };

  const handleToggleSection = async (section: WebsiteSectionKey) => {
    const current = workspace.websiteConfig.visibleSections;
    const next = current.includes(section)
      ? current.filter((s) => s !== section)
      : [...current, section];
    onUpdateWorkspace({
      ...workspace,
      websiteConfig: { ...workspace.websiteConfig, visibleSections: next },
    });
    await persistWebsitePatch({ visibleSections: next });
  };

  const handleAddBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBranchName.trim() || !newBranchNeighborhood.trim()) return;
    setActionError('');
    if (!isAuthenticatedWorkspace) {
      setActionError('Sign in to an authenticated workspace to create persistent branches.');
      return;
    }
    try {
      await amalApi.createBranch({
        name: newBranchName.trim(),
        city: newBranchCity.trim() || 'Addis Ababa',
        neighborhood: newBranchNeighborhood.trim(),
        phone: newBranchPhone.trim() || '+251 11 000 0000',
        whatsappNumber: newBranchPhone.trim() || '+251911000000',
      });
      await onRefreshWorkspace?.();
      setActionNotice(`Created branch "${newBranchName.trim()}".`);
      setNewBranchName('');
      setNewBranchNeighborhood('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create branch');
    }
  };

  const handleInviteStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setActionError('');
    if (!isAuthenticatedWorkspace) {
      setActionError('Sign in to an authenticated workspace to send staff invitations.');
      return;
    }
    try {
      const targetOutlet = workspace.outlets.find((o) => o.id === inviteOutletId) || workspace.outlets[0];
      const targetBranchId = inviteBranchId || targetOutlet?.branchId || workspace.branches[0]?.id;
      await amalApi.inviteStaff({
        email: inviteEmail.trim(),
        roleId: inviteRoleId,
        scopeType: inviteScopeType,
        branchIds: inviteScopeType === 'branch' && targetBranchId ? [targetBranchId] : [],
        outletAssignments:
          inviteScopeType === 'outlet' && targetOutlet
            ? [{ branchId: targetOutlet.branchId, outletId: targetOutlet.id }]
            : [],
      });
      setActionNotice(
        `Scoped ${inviteRoleId.replace('_', ' ')} invitation queued for ${inviteEmail.trim()}.`
      );
      setInviteEmail('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to send invitation');
    }
  };

  const handleAddOutlet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOutletName.trim()) return;
    setActionError('');

    const targetBranchId = newOutletBranchId || workspace.branches[0]?.id;

    if (isAuthenticatedWorkspace) {
      try {
        await amalApi.createOutlet({
          branchId: targetBranchId,
          nameEn: newOutletName.trim(),
          outletKind: newOutletKind,
          description: newOutletDesc.trim() || 'Configured outlet menu',
          supportsTables: newOutletKind !== 'bakery_pickup' && newOutletKind !== 'kitchen_express',
          supportsRoomService: newOutletKind === 'room_service',
        });
        await onRefreshWorkspace?.();
        setActionNotice(`Added outlet "${newOutletName.trim()}".`);
        setNewOutletName('');
        setNewOutletDesc('');
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Failed to add outlet');
      }
      return;
    }

    const outletId = `out-${Date.now()}`;
    onUpdateWorkspace({
      ...workspace,
      outlets: [
        ...workspace.outlets,
        {
          id: outletId,
          branchId: targetBranchId || 'br-1',
          name: { en: newOutletName.trim() },
          outletKind: newOutletKind,
          description: newOutletDesc.trim() || 'Configured outlet menu',
          supportsTables: newOutletKind !== 'bakery_pickup' && newOutletKind !== 'kitchen_express',
          supportsRoomService: newOutletKind === 'room_service',
          active: true,
        },
      ],
    });
    setNewOutletName('');
    setNewOutletDesc('');
  };

  const handleDownloadQrSvg = (station: QrStation) => {
    const svgEl = document.getElementById(`qr-svg-wrap-${station.id}`)?.querySelector('svg');
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svgEl);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${workspace.slug}-${station.scanToken}-qr.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const navTabs: { id: DashboardTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview & Modules', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'catalog', label: 'Menu & Variations', icon: <Utensils className="w-4 h-4" /> },
    { id: 'qr_studio', label: 'QR Code Studio', icon: <QrCode className="w-4 h-4" /> },
    { id: 'orders', label: 'Orders & Operations', icon: <Receipt className="w-4 h-4" /> },
    { id: 'website', label: 'Website Builder', icon: <LayoutTemplate className="w-4 h-4" /> },
    { id: 'localization', label: 'Localization & Outlets', icon: <Globe className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8">
      {/* Category Preset & Authenticated Workspace Bar */}
      <div className="mb-6 p-3 bg-white border border-neutral-200 rounded-xl flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
          {memberships.length > 0 && onSwitchTenant && (
            <select
              value={isAuthenticatedWorkspace ? workspace.id : ''}
              onChange={(e) => {
                if (e.target.value) void onSwitchTenant(e.target.value);
              }}
              aria-label="Select your persisted workspace"
              className="px-2.5 py-1.5 text-xs font-semibold bg-[#0F4C3A]/10 text-[#0F4C3A] border border-[#0F4C3A]/30 rounded-lg focus:outline-none shrink-0"
            >
              <option value="" disabled>
                My Saved Workspaces ({memberships.length})
              </option>
              {memberships.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.businessName} ({m.roleId.replace('_', ' ')})
                </option>
              ))}
            </select>
          )}
          <span className="text-xs font-semibold text-neutral-500 whitespace-nowrap shrink-0 px-2">
            Test Category:
          </span>
          {allPresetIds.map((typeId) => {
            const def = BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === typeId)!;
            const isCurrent = isPresetPreview && workspace.primaryBusinessType === typeId;
            return (
              <button
                key={typeId}
                type="button"
                onClick={() => {
                  onSwitchPreset(typeId);
                  setSelectedOutletFilter('all');
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isCurrent
                    ? 'bg-neutral-950 text-white'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                {def.shortLabel}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onStartOnboarding}
            className="px-3 py-1.5 text-xs font-semibold text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            + Custom Multi-Category Setup
          </button>
          <button
            type="button"
            onClick={() => onLaunchStorefront()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Open Live Website</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Legacy localStorage Blueprint Import Notice (Milestone 5) */}
      {isAuthenticatedWorkspace && legacyBlueprintCandidate && onImportLocalBlueprint && (
        <div className="mb-4 p-4 bg-white border border-[#0F4C3A]/30 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-neutral-950">
              Previous Local Blueprint Detected: "{legacyBlueprintCandidate.businessName}"
            </p>
            <p className="text-xs text-neutral-600 mt-0.5">
              Safely import your brand name, accent color, and fasting toggle into this PostgreSQL
              workspace (no demo orders or personal data are imported).
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onDismissLocalBlueprint}
              className="px-3 py-1.5 text-xs font-medium text-neutral-600 bg-neutral-100 rounded-lg hover:bg-neutral-200 cursor-pointer"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => void onImportLocalBlueprint()}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] cursor-pointer"
            >
              Import Blueprint
            </button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} className="underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {actionNotice && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900 flex items-center justify-between">
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice('')} className="underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      {/* Sidebar + Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <aside className="lg:col-span-3 bg-white border border-neutral-200 rounded-xl p-4 space-y-6">
          <div className="space-y-1 pb-4 border-b border-neutral-100">
            <p className="text-xs text-neutral-500">
              {workspace.businessTypes
                .map((t) => BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === t)?.shortLabel)
                .join(' · ')}
            </p>
            <h2 className="text-lg font-bold text-neutral-950 leading-snug">
              {workspace.businessName}
            </h2>
            <p className="text-xs text-neutral-500">
              {workspace.branches[0]?.neighborhood}, {workspace.branches[0]?.city}
            </p>
          </div>

          <nav className="space-y-1" aria-label="Workspace modules">
            {navTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#0F4C3A] text-white'
                      : 'text-neutral-700 hover:bg-neutral-100'
                  }`}
                >
                  {tab.icon}
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="pt-4 border-t border-neutral-100 space-y-2 text-xs">
            <div className="flex justify-between text-neutral-600">
              <span>Active Outlets</span>
              <span className="font-mono-tabular font-semibold text-neutral-950">
                {workspace.outlets.length}
              </span>
            </div>
            <div className="flex justify-between text-neutral-600">
              <span>Catalog Items</span>
              <span className="font-mono-tabular font-semibold text-neutral-950">
                {workspace.products.length}
              </span>
            </div>
            <div className="flex justify-between text-neutral-600">
              <span>QR Stations</span>
              <span className="font-mono-tabular font-semibold text-neutral-950">
                {workspace.qrStations.length}
              </span>
            </div>
            <div className="flex justify-between text-neutral-600">
              <span>Active Workflows</span>
              <span className="font-semibold text-neutral-950">
                {workspace.allowedWorkflows.length}
              </span>
            </div>
          </div>
        </aside>

        {/* Main Viewport */}
        <section className="lg:col-span-9 space-y-6">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-neutral-200 rounded-xl p-5">
                  <p className="text-xs text-neutral-500">Today’s Order Volume</p>
                  <p className="text-2xl font-bold text-neutral-950 mt-1 font-mono-tabular">
                    {formatEtb(totalRevenueEtb)}
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Across {workspace.orders.length} active tickets
                  </p>
                </div>
                <div className="bg-white border border-neutral-200 rounded-xl p-5">
                  <p className="text-xs text-neutral-500">Ordering Workflows</p>
                  <p className="text-lg font-bold text-neutral-950 mt-1 capitalize">
                    {workspace.allowedWorkflows.map((w) => w.replace('_', ' ')).join(' · ')}
                  </p>
                </div>
                <div className="bg-white border border-neutral-200 rounded-xl p-5">
                  <p className="text-xs text-neutral-500">Fasting (Tsom) Mode</p>
                  <p className="text-lg font-bold text-neutral-950 mt-1">
                    {workspace.localization.fastingModeActive ? 'Active on Storefront' : 'Standby'}
                  </p>
                </div>
                <div className="bg-white border border-neutral-200 rounded-xl p-5">
                  <p className="text-xs text-neutral-500">Website Template</p>
                  <p className="text-lg font-bold text-neutral-950 mt-1 truncate">
                    {WEBSITE_TEMPLATE_REGISTRY[workspace.websiteConfig.templateId].name}
                  </p>
                </div>
              </div>

              <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-neutral-950">
                      Configured Platform Capabilities
                    </h3>
                    <p className="text-xs text-neutral-500">
                      Universal commerce modules paired with capabilities unlocked for{' '}
                      {workspace.businessTypes
                        .map(
                          (t) =>
                            BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === t)?.shortLabel
                        )
                        .join(' + ')}
                      .
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {workspace.enabledCapabilities.map((capId) => {
                    const cap = CAPABILITY_LABELS[capId];
                    return (
                      <div
                        key={capId}
                        className="p-3.5 rounded-lg bg-[#F8F9FA] border border-neutral-200/80 space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-neutral-950">
                            {cap.label}
                          </span>
                          <span className="text-[11px] font-medium text-neutral-500">
                            {cap.scope}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-600 leading-relaxed">
                          {cap.summary}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Hotel PMS Integration Bridge Card when hotel is enabled */}
              {hasCap('pms_bridge') && (
                <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-bold text-neutral-950">
                        Hotel PMS Expansion Bridge
                      </h3>
                      <p className="text-xs text-neutral-600">
                        AMAL focuses on dining outlets and room-service commerce while exposing
                        structured folio & room validation hooks for external hotel PMS software.
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold whitespace-nowrap ${
                        workspace.pmsIntegration.enabled ? 'text-[#0F4C3A]' : 'text-amber-700'
                      }`}
                    >
                      {workspace.pmsIntegration.enabled
                        ? `Connected · Synced ${workspace.pmsIntegration.lastSyncedAt}`
                        : workspace.pmsIntegration.lastSyncedAt ||
                          'Webhook contract ready (Not connected)'}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-neutral-100 text-xs">
                    <div>
                      <span className="text-neutral-500 block">Adapter</span>
                      <span className="font-semibold text-neutral-900">
                        {workspace.pmsIntegration.providerName}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block">Room Validation Endpoint</span>
                      <span className="font-mono-tabular text-neutral-900 break-all">
                        {workspace.pmsIntegration.roomValidationEndpoint}
                      </span>
                    </div>
                    <div>
                      <span className="text-neutral-500 block">Charge-to-Room Posting</span>
                      <span className="font-semibold text-neutral-900">
                        {workspace.pmsIntegration.folioPostingEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: CATALOG & VARIATIONS */}
          {activeTab === 'catalog' && (
            <div className="space-y-5">
              <div className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Search items in English or አማርኛ..."
                    className="px-3.5 py-2 text-xs bg-[#F8F9FA] border border-neutral-200 rounded-lg w-60 focus:outline-none focus:border-[#0F4C3A]"
                  />
                  <select
                    value={selectedOutletFilter}
                    onChange={(e) => setSelectedOutletFilter(e.target.value)}
                    className="px-3 py-2 text-xs bg-[#F8F9FA] border border-neutral-200 rounded-lg focus:outline-none"
                  >
                    <option value="all">All Outlets ({workspace.outlets.length})</option>
                    {workspace.outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name.en}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center p-0.5 bg-neutral-100 rounded-lg">
                    {(['en', 'am', 'om'] as LanguageCode[]).map((l) => (
                      <button
                        key={l}
                        type="button"
                        onClick={() => setCatalogLang(l)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md cursor-pointer ${
                          catalogLang === l
                            ? 'bg-white text-neutral-950 shadow-sm'
                            : 'text-neutral-600'
                        }`}
                      >
                        {l.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAddProduct(!showAddProduct)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Menu Item</span>
                </button>
              </div>

              {showAddProduct && (
                <form
                  onSubmit={handleCreateProduct}
                  className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4"
                >
                  <h3 className="text-sm font-bold text-neutral-950">
                    Create Product with Variations & Availability
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-neutral-700">
                        Item Name (English)
                      </span>
                      <input
                        type="text"
                        required
                        value={newProdNameEn}
                        onChange={(e) => setNewProdNameEn(e.target.value)}
                        placeholder="e.g., Cardamom Iced Cortado"
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-neutral-700">
                        Item Name (Amharic · አማርኛ)
                      </span>
                      <input
                        type="text"
                        value={newProdNameAm}
                        onChange={(e) => setNewProdNameAm(e.target.value)}
                        placeholder="Optional Amharic title"
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-neutral-700">
                        Base Price (ETB)
                      </span>
                      <input
                        type="number"
                        required
                        value={newProdPrice}
                        onChange={(e) => setNewProdPrice(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono-tabular border border-neutral-300 rounded-lg"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-neutral-700">Category</span>
                      <select
                        value={newProdCategoryId}
                        onChange={(e) => setNewProdCategoryId(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                      >
                        {workspace.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name.en}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-1 sm:col-span-2">
                      <span className="text-xs font-medium text-neutral-700">
                        Variations (comma-separated, e.g. Small (+0), Large (+80))
                      </span>
                      <input
                        type="text"
                        value={newProdSizes}
                        onChange={(e) => setNewProdSizes(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                      />
                    </label>
                    <label className="block space-y-1 sm:col-span-2">
                      <span className="text-xs font-medium text-neutral-700">Description</span>
                      <input
                        type="text"
                        value={newProdDescEn}
                        onChange={(e) => setNewProdDescEn(e.target.value)}
                        placeholder="Ingredients, preparation, or portion notes"
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                      />
                    </label>
                    <label className="flex items-center gap-2 pt-5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newProdFasting}
                        onChange={(e) => setNewProdFasting(e.target.checked)}
                        className="accent-[#0F4C3A]"
                      />
                      <span className="text-xs font-medium text-neutral-800">
                        Tsom / Fasting Eligible
                      </span>
                    </label>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAddProduct(false)}
                      className="px-4 py-2 text-xs font-semibold text-neutral-600 bg-neutral-100 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg cursor-pointer"
                    >
                      Save Item to Menu
                    </button>
                  </div>
                </form>
              )}

              {/* Structured Data Grid */}
              <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-200 bg-[#F8F9FA] text-xs font-semibold text-neutral-600">
                        <th className="py-3 px-4">Product ({catalogLang.toUpperCase()})</th>
                        <th className="py-3 px-4">Category / Outlet</th>
                        <th className="py-3 px-4">Variations & Modifiers</th>
                        <th className="py-3 px-4 text-right">Base Price</th>
                        <th className="py-3 px-4">Availability</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 text-sm">
                      {filteredProducts.map((product) => {
                        const cat = workspace.categories.find(
                          (c) => c.id === product.categoryId
                        );
                        const outlet = workspace.outlets.find(
                          (o) => o.id === product.outletId
                        );
                        return (
                          <tr key={product.id} className="hover:bg-neutral-50/80">
                            <td className="py-3.5 px-4 align-top">
                              <p className="font-semibold text-neutral-950">
                                {product.name[catalogLang] || product.name.en}
                              </p>
                              <p className="text-xs text-neutral-500 line-clamp-1 max-w-xs mt-0.5">
                                {product.description[catalogLang] || product.description.en}
                              </p>
                              <p className="text-[11px] text-neutral-400 mt-1">
                                {[
                                  ...product.dietaryTags,
                                  product.availability.fastingDayEligible
                                    ? 'Tsom Eligible'
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            </td>
                            <td className="py-3.5 px-4 align-top text-xs text-neutral-600">
                              <p className="font-medium text-neutral-800">{cat?.name.en}</p>
                              <p className="text-neutral-500 mt-0.5">{outlet?.name.en}</p>
                            </td>
                            <td className="py-3.5 px-4 align-top text-xs text-neutral-600">
                              <p>
                                {product.variations.length > 0
                                  ? `${product.variations.length} sizes/variations`
                                  : 'Standard portion'}
                              </p>
                              <p className="text-neutral-500 mt-0.5">
                                {product.modifierGroups.length > 0
                                  ? product.modifierGroups
                                      .map(
                                        (mg) =>
                                          `${mg.name.en} (${mg.required ? 'Req' : 'Opt'})`
                                      )
                                      .join(', ')
                                  : 'No modifiers'}
                              </p>
                            </td>
                            <td className="py-3.5 px-4 align-top text-right font-mono-tabular font-semibold text-neutral-950 whitespace-nowrap">
                              {formatEtb(product.basePriceEtb)}
                            </td>
                            <td className="py-3.5 px-4 align-top">
                              <div className="flex flex-col gap-1.5 items-start">
                                <select
                                  value={product.availability.status}
                                  onChange={(e) =>
                                    handleToggleProductAvailability(
                                      product.id,
                                      e.target.value as AvailabilityRule['status']
                                    )
                                  }
                                  className={`px-2.5 py-1 text-xs font-medium rounded-md border ${
                                    product.availability.status === 'sold_out'
                                      ? 'border-red-200 bg-red-50 text-red-700'
                                      : product.availability.status === 'low_stock'
                                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                                        : product.availability.status === 'pre_order_only'
                                          ? 'border-blue-200 bg-blue-50 text-blue-800'
                                          : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                  }`}
                                >
                                  <option value="in_stock">In Stock</option>
                                  <option value="low_stock">Low Stock</option>
                                  <option value="sold_out">Sold Out</option>
                                  <option value="pre_order_only">Pre-Order Only</option>
                                </select>
                                {isAuthenticatedWorkspace && (
                                  <button
                                    type="button"
                                    onClick={() => handleRestockProduct(product.id, 10)}
                                    className="text-[11px] font-medium text-[#0F4C3A] hover:underline cursor-pointer"
                                  >
                                    {typeof product.availability.remainingCount === 'number'
                                      ? `Stock: ${product.availability.remainingCount} (+10)`
                                      : 'Enable Track Stock (+10)'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: QR CODE STUDIO */}
          {activeTab === 'qr_studio' && (
            <div className="space-y-6">
              <form
                onSubmit={handleCreateQrStation}
                className="bg-white border border-neutral-200 rounded-xl p-6 grid grid-cols-1 md:grid-cols-12 md:items-end gap-4"
              >
                <label className="md:col-span-3 space-y-1">
                  <span className="text-xs font-semibold text-neutral-700">
                    New QR Station Label
                  </span>
                  <input
                    type="text"
                    required
                    value={newStationLabel}
                    onChange={(e) => setNewStationLabel(e.target.value)}
                    placeholder={
                      workspace.primaryBusinessType === 'hotel'
                        ? 'e.g., Room 305'
                        : 'e.g., Table 12 or Pickup Window'
                    }
                    className="w-full px-3.5 py-2 text-sm border border-neutral-300 rounded-lg"
                  />
                </label>
                <label className="md:col-span-2 space-y-1">
                  <span className="text-xs font-semibold text-neutral-700">Station Type</span>
                  <select
                    value={newStationType}
                    onChange={(e) =>
                      setNewStationType(e.target.value as QrStation['stationType'])
                    }
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  >
                    <option value="table">Table</option>
                    <option value="mesob_table">Mesob Table</option>
                    <option value="room">Hotel Room</option>
                    <option value="counter">Counter</option>
                    <option value="pickup_zone">Pickup Zone</option>
                  </select>
                </label>
                <label className="md:col-span-3 space-y-1">
                  <span className="text-xs font-semibold text-neutral-700">
                    Zone / Capacity Note
                  </span>
                  <input
                    type="text"
                    value={newStationZone}
                    onChange={(e) => setNewStationZone(e.target.value)}
                    placeholder="e.g., 4 Guests · Terrace"
                    className="w-full px-3.5 py-2 text-sm border border-neutral-300 rounded-lg"
                  />
                </label>
                <label className="md:col-span-2 space-y-1">
                  <span className="text-xs font-semibold text-neutral-700">Outlet</span>
                  <select
                    value={newStationOutletId}
                    onChange={(e) => setNewStationOutletId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  >
                    {workspace.outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name.en}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="md:col-span-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Generate QR Card
                </button>
              </form>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {workspace.qrStations.map((station) => {
                  const outlet = workspace.outlets.find(
                    (o) => o.id === station.outletId
                  );
                  const origin =
                    typeof window !== 'undefined'
                      ? window.location.origin
                      : 'https://amal.hospitality';
                  const qrTargetUrl = `${origin}/s/${workspace.slug}?station=${encodeURIComponent(
                    station.scanToken
                  )}`;
                  return (
                    <div
                      key={station.id}
                      className="bg-white border border-neutral-200 rounded-xl p-5 flex flex-col justify-between gap-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-xs text-neutral-500">
                            {station.stationType.replace('_', ' ').toUpperCase()} ·{' '}
                            {outlet?.name.en}
                          </p>
                          <h3 className="text-lg font-bold text-neutral-950">
                            {station.label}
                          </h3>
                          <p className="text-xs text-neutral-600">{station.capacityOrZone}</p>
                        </div>
                        <div
                          id={`qr-svg-wrap-${station.id}`}
                          className="p-2 bg-white border border-neutral-200 rounded-lg shrink-0"
                        >
                          <QrCodeSvg
                            value={qrTargetUrl}
                            size={104}
                            title={`QR Code for ${station.label}`}
                          />
                        </div>
                      </div>

                      <div className="pt-3 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDownloadQrSvg(station)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 cursor-pointer whitespace-nowrap"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>SVG</span>
                          </button>
                          {isAuthenticatedWorkspace && (
                            <button
                              type="button"
                              onClick={() => handleRotateQrToken(station.id)}
                              title="Invalidate old QR link and issue a fresh cryptographic token"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 rounded-lg hover:bg-neutral-200 cursor-pointer whitespace-nowrap"
                            >
                              <RefreshCw className="w-3 h-3" />
                              <span>Rotate</span>
                            </button>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onLaunchStorefront(station.scanToken)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-neutral-950 rounded-lg hover:bg-neutral-800 cursor-pointer whitespace-nowrap"
                        >
                          <span>Simulate Guest Scan</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 4: ORDERS & ADAPTIVE OPERATIONS */}
          {activeTab === 'orders' && (
            <div className="space-y-6">
              {/* Live Order Queue / KDS */}
              <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <ChefHat className="w-5 h-5 text-[#0F4C3A]" />
                    <div>
                      <h3 className="text-lg font-bold text-neutral-950">
                        {hasCap('kitchen_display')
                          ? 'Kitchen Order Management (KDS) & Live Queue'
                          : 'Live Order Queue'}
                      </h3>
                      <p className="text-xs text-neutral-500">
                        Orders placed on the Live Storefront appear here immediately with
                        workflow, payment rail, and modifier breakdown.
                      </p>
                    </div>
                  </div>
                </div>

                {workspace.orders.length === 0 ? (
                  <div className="py-10 text-center border border-dashed border-neutral-200 rounded-xl space-y-2">
                    <p className="text-sm font-medium text-neutral-700">
                      No active orders in this workspace yet.
                    </p>
                    <button
                      type="button"
                      onClick={() => onLaunchStorefront()}
                      className="px-4 py-2 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg cursor-pointer"
                    >
                      Place a Test Order on Live Storefront
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {workspace.orders.map((order) => (
                      <div
                        key={order.id}
                        className="p-4 rounded-xl border border-neutral-200 bg-[#F8F9FA] space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs text-neutral-500 font-mono-tabular">
                              {order.orderNumber} · {order.createdAt} ·{' '}
                              {order.workflow.replace('_', ' ')}
                            </p>
                            <h4 className="text-sm font-bold text-neutral-950 mt-0.5">
                              {order.customerName}{' '}
                              {order.stationLabel ? `· ${order.stationLabel}` : ''}
                            </h4>
                            <p className="text-xs text-neutral-500">{order.outletName}</p>
                          </div>
                          <span className="text-sm font-bold font-mono-tabular text-neutral-950">
                            {formatEtb(order.totalEtb)}
                          </span>
                        </div>

                        <ul className="space-y-1.5 border-t border-neutral-200 pt-2.5 text-xs text-neutral-700">
                          {order.items.map((item) => (
                            <li key={item.id}>
                              <span className="font-semibold font-mono-tabular">
                                {item.quantity}x
                              </span>{' '}
                              {item.productName}
                              {item.variationName ? ` (${item.variationName})` : ''}
                              {item.selectedModifiers.length > 0 && (
                                <span className="block text-neutral-500 pl-5">
                                  +{' '}
                                  {item.selectedModifiers
                                    .map((m) => m.optionName)
                                    .join(', ')}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>

                        {order.pickupScheduledFor && (
                          <p className="text-xs font-medium text-blue-800">
                            Scheduled Pickup: {order.pickupScheduledFor}
                          </p>
                        )}

                        <div className="pt-2 border-t border-neutral-200 flex items-center justify-between gap-2">
                          <span className="text-xs text-neutral-600">
                            {PAYMENT_PROVIDERS[order.paymentProvider].name} ·{' '}
                            {order.paymentStatus.replace('_', ' ')}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleAdvanceOrderStatus(order.id)}
                            disabled={order.status === 'completed'}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                              order.status === 'completed'
                                ? 'bg-neutral-200 text-neutral-600 cursor-default'
                                : 'bg-neutral-950 text-white hover:bg-neutral-800 cursor-pointer'
                            }`}
                          >
                            {order.status === 'new'
                              ? 'Start Preparing'
                              : order.status === 'preparing'
                                ? 'Mark Ready'
                                : order.status === 'ready'
                                  ? 'Complete Order'
                                  : 'Completed'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Adaptive Operations Modules (Reservations / Custom Cakes / Coffee Ceremony / Coffee Loyalty) */}
              {(workspace.specialRequests.length > 0 ||
                hasCap('table_reservations') ||
                hasCap('custom_cake_requests') ||
                hasCap('coffee_ceremony')) && (
                <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#0F4C3A]" />
                    <h3 className="text-base font-bold text-neutral-950">
                      Reservations, Custom Cakes & Coffee Ceremony Requests
                    </h3>
                  </div>
                  {workspace.specialRequests.length === 0 ? (
                    <p className="text-xs text-neutral-500">
                      Requests submitted from your Live Storefront (table reservations, custom
                      cake inquiries, or coffee ceremony bookings) appear here.
                    </p>
                  ) : (
                    <div className="divide-y divide-neutral-100">
                      {workspace.specialRequests.map((req) => (
                        <div
                          key={req.id}
                          className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-0.5">
                            <p className="text-xs text-neutral-500">
                              {req.kind.replace('_', ' ').toUpperCase()} · {req.dateTime} ·{' '}
                              {req.partyOrSize}
                            </p>
                            <p className="text-sm font-bold text-neutral-950">
                              {req.customerName} ({req.customerPhone})
                            </p>
                            <p className="text-xs text-neutral-600">{req.details}</p>
                          </div>
                          <div className="flex flex-col sm:items-end gap-2 shrink-0">
                            <span className="text-xs font-semibold text-[#0F4C3A] capitalize">
                              {req.status.replace('_', ' ')}
                            </span>
                            {req.estimatedEtb && (
                              <p className="text-xs font-mono-tabular text-neutral-700">
                                Est. {formatEtb(req.estimatedEtb)}
                              </p>
                            )}
                            <div className="flex items-center gap-1.5">
                              {req.status !== 'confirmed' && req.status !== 'cancelled' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSpecialRequestStatus(req.id, 'confirmed')}
                                  className="px-2.5 py-1 text-[11px] font-semibold bg-[#0F4C3A] text-white rounded cursor-pointer"
                                >
                                  Confirm
                                </button>
                              )}
                              {req.kind === 'custom_cake' && req.status !== 'in_production' && req.status !== 'cancelled' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSpecialRequestStatus(req.id, 'in_production')}
                                  className="px-2.5 py-1 text-[11px] font-semibold bg-neutral-900 text-white rounded cursor-pointer"
                                >
                                  Start Prep
                                </button>
                              )}
                              {req.status !== 'cancelled' && (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSpecialRequestStatus(req.id, 'cancelled')}
                                  className="px-2.5 py-1 text-[11px] font-semibold border border-neutral-300 text-neutral-700 rounded hover:bg-neutral-100 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {hasCap('coffee_loyalty') && (
                <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Coffee className="w-4 h-4 text-[#0F4C3A]" />
                    <h3 className="text-base font-bold text-neutral-950">
                      Coffee House Stamp Loyalty Members
                    </h3>
                  </div>
                  <div className="divide-y divide-neutral-100">
                    {workspace.loyaltyMembers.map((m) => (
                      <div
                        key={m.id}
                        className="py-3 flex items-center justify-between gap-4 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-neutral-950">{m.name}</p>
                          <p className="text-xs text-neutral-500">
                            {m.phone} · Favorite: {m.favoriteDrink}
                          </p>
                        </div>
                        <div className="text-right font-mono-tabular">
                          <p className="font-bold text-neutral-950">
                            {m.stamps} / {m.targetStamps} stamps
                          </p>
                          <p className="text-xs text-neutral-500">
                            Lifetime {formatEtb(m.totalSpentEtb)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: ADAPTIVE WEBSITE BUILDER */}
          {activeTab === 'website' && (
            <div className="space-y-6">
              <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-neutral-950">
                      Adaptive Industry Website Templates
                    </h3>
                    <p className="text-xs text-neutral-600">
                      Select any reusable template below and customize hero messaging, brand
                      accent color, and active page sections.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onLaunchStorefront()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Launch Customized Site
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {Object.values(WEBSITE_TEMPLATE_REGISTRY).map((tmpl) => {
                    const selected = workspace.websiteConfig.templateId === tmpl.id;
                    return (
                      <button
                        key={tmpl.id}
                        type="button"
                        onClick={() => handleSelectWebsiteTemplate(tmpl.id)}
                        className={`text-left rounded-xl border overflow-hidden transition-colors cursor-pointer ${
                          selected
                            ? 'border-[#0F4C3A] ring-2 ring-[#0F4C3A]/20'
                            : 'border-neutral-200 hover:border-neutral-300'
                        }`}
                      >
                        <div className="h-28 bg-neutral-200 overflow-hidden relative">
                          <img
                            src={tmpl.heroImage}
                            alt={tmpl.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="p-3.5 space-y-1 bg-white">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-neutral-950">
                              {tmpl.name}
                            </span>
                            {selected && (
                              <span className="text-xs font-semibold text-[#0F4C3A]">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-neutral-500 line-clamp-2">
                            {tmpl.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-5">
                <h3 className="text-base font-bold text-neutral-950">
                  Visual Identity & Section Controls
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-neutral-700">
                      Hero Headline (English)
                    </span>
                    <div className="flex items-end gap-2">
                      <input
                        type="text"
                        value={workspace.websiteConfig.heroHeadline.en}
                        onChange={(e) =>
                          onUpdateWorkspace({
                            ...workspace,
                            websiteConfig: {
                              ...workspace.websiteConfig,
                              heroHeadline: {
                                ...workspace.websiteConfig.heroHeadline,
                                en: e.target.value,
                              },
                            },
                          })
                        }
                        onBlur={(e) =>
                          void persistWebsitePatch({ heroHeadlineEn: e.target.value })
                        }
                        className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                      />
                    </div>
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-semibold text-neutral-700">
                      Brand Accent Color
                    </span>
                    <div className="flex items-center gap-2">
                      {['#0F4C3A', '#8C3B24', '#5C3A21', '#B4833E', '#15803D', '#DC2626', '#9A5B25'].map(
                        (hex) => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => {
                              onUpdateWorkspace({
                                ...workspace,
                                websiteConfig: {
                                  ...workspace.websiteConfig,
                                  accentHex: hex,
                                },
                              });
                              void persistWebsitePatch({ accentHex: hex });
                            }}
                            style={{ backgroundColor: hex }}
                            aria-label={`Accent ${hex}`}
                            className={`w-7 h-7 rounded-lg cursor-pointer ${
                              workspace.websiteConfig.accentHex === hex
                                ? 'ring-2 ring-offset-2 ring-neutral-900'
                                : ''
                            }`}
                          />
                        )
                      )}
                    </div>
                  </label>
                </div>

                <div className="space-y-2 pt-2 border-t border-neutral-100">
                  <span className="text-xs font-semibold text-neutral-700 block">
                    Enabled Storefront Sections
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { id: 'hero', label: 'Hero Banner' },
                        { id: 'fasting_banner', label: 'Tsom (Fasting) Strip' },
                        { id: 'outlet_switcher', label: 'Outlet Switcher' },
                        { id: 'featured_menu', label: 'Signature Selection' },
                        { id: 'full_catalog', label: 'Full Interactive Menu' },
                        { id: 'coffee_ceremony_showcase', label: 'Coffee Ceremony' },
                        { id: 'custom_cake_form', label: 'Custom Cake Desk' },
                        { id: 'table_reservation', label: 'Table Reservations' },
                        { id: 'loyalty_card', label: 'Coffee Loyalty' },
                        { id: 'branch_hours', label: 'Branches & Hours' },
                      ] as { id: WebsiteSectionKey; label: string }[]
                    ).map((sec) => {
                      const active = workspace.websiteConfig.visibleSections.includes(
                        sec.id
                      );
                      return (
                        <button
                          key={sec.id}
                          type="button"
                          onClick={() => handleToggleSection(sec.id)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer whitespace-nowrap ${
                            active
                              ? 'bg-neutral-950 text-white border-neutral-950'
                              : 'bg-white text-neutral-600 border-neutral-200'
                          }`}
                        >
                          {sec.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: LOCALIZATION, PAYMENTS & OUTLETS */}
          {activeTab === 'localization' && (
            <div className="space-y-6">
              <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                <h3 className="text-lg font-bold text-neutral-950">
                  Ethiopian Market Localization & Payments
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-neutral-700">
                      Storefront Fasting & Bandwidth Rules
                    </p>
                    <label className="flex items-center gap-2.5 text-sm text-neutral-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={workspace.localization.fastingModeActive}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          onUpdateWorkspace({
                            ...workspace,
                            localization: {
                              ...workspace.localization,
                              fastingModeActive: checked,
                            },
                          });
                          void persistWebsitePatch({ fastingModeActive: checked });
                        }}
                        className="accent-[#0F4C3A]"
                      />
                      <span>Highlight Tsom (Fasting) Filter on Menu</span>
                    </label>
                    <label className="flex items-center gap-2.5 text-sm text-neutral-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={workspace.websiteConfig.lowBandwidthDefault}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          onUpdateWorkspace({
                            ...workspace,
                            websiteConfig: {
                              ...workspace.websiteConfig,
                              lowBandwidthDefault: checked,
                            },
                          });
                          void persistWebsitePatch({ lowBandwidthDefault: checked });
                        }}
                        className="accent-[#0F4C3A]"
                      />
                      <span>Default Storefront to Low-Bandwidth Lite Mode</span>
                    </label>
                    <label className="flex items-center gap-2.5 text-sm text-neutral-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={workspace.localization.whatsappOrderingEnabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          onUpdateWorkspace({
                            ...workspace,
                            localization: {
                              ...workspace.localization,
                              whatsappOrderingEnabled: checked,
                            },
                          });
                          void persistWebsitePatch({ whatsappOrderingEnabled: checked });
                        }}
                        className="accent-[#0F4C3A]"
                      />
                      <span>Enable WhatsApp Direct Order Dispatch</span>
                    </label>
                  </div>

                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-neutral-700">
                      Accepted Payment Channels (ETB)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(PAYMENT_PROVIDERS) as PaymentProviderId[]).map(
                        (pid) => {
                          const active =
                            workspace.localization.acceptedPayments.includes(pid);
                          return (
                            <button
                              key={pid}
                              type="button"
                              onClick={() => {
                                const cur = workspace.localization.acceptedPayments;
                                const next = active
                                  ? cur.length > 1
                                    ? cur.filter((x) => x !== pid)
                                    : cur
                                  : [...cur, pid];
                                onUpdateWorkspace({
                                  ...workspace,
                                  localization: {
                                    ...workspace.localization,
                                    acceptedPayments: next,
                                  },
                                });
                                void persistWebsitePatch({ acceptedPayments: next });
                              }}
                              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer ${
                                active
                                  ? 'bg-[#0F4C3A] text-white border-[#0F4C3A]'
                                  : 'bg-white text-neutral-600 border-neutral-200'
                              }`}
                            >
                              {PAYMENT_PROVIDERS[pid].name}
                            </button>
                          );
                        }
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-[#0F4C3A]" />
                  <h3 className="text-base font-bold text-neutral-950">
                    Outlets & Departments ({workspace.outlets.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {workspace.outlets.map((o) => (
                    <div
                      key={o.id}
                      className="p-3.5 rounded-lg border border-neutral-200 bg-[#F8F9FA]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-neutral-950">{o.name.en}</p>
                        <span className="text-[11px] font-medium text-neutral-500">
                          {o.outletKind.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-neutral-600 mt-0.5">{o.description}</p>
                    </div>
                  ))}
                </div>
                <form
                  onSubmit={handleAddOutlet}
                  className="pt-4 border-t border-neutral-100 flex flex-col sm:flex-row flex-wrap gap-3"
                >
                  {workspace.branches.length > 0 && (
                    <select
                      value={newOutletBranchId || workspace.branches[0]?.id}
                      onChange={(e) => setNewOutletBranchId(e.target.value)}
                      aria-label="Target branch"
                      className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                    >
                      {workspace.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="text"
                    value={newOutletName}
                    onChange={(e) => setNewOutletName(e.target.value)}
                    placeholder="Add outlet (e.g., Rooftop Terrace Bar)"
                    className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  />
                  <select
                    value={newOutletKind}
                    onChange={(e) => setNewOutletKind(e.target.value as Outlet['outletKind'])}
                    className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  >
                    <option value="dining_room">Dining Room</option>
                    <option value="cafe_counter">Cafe Counter</option>
                    <option value="room_service">Room Service</option>
                    <option value="bar_lounge">Bar / Lounge</option>
                    <option value="bakery_pickup">Bakery Pickup</option>
                    <option value="juice_bar">Juice Bar</option>
                    <option value="kitchen_express">Kitchen Express</option>
                    <option value="cultural_hall">Cultural Hall</option>
                  </select>
                  <input
                    type="text"
                    value={newOutletDesc}
                    onChange={(e) => setNewOutletDesc(e.target.value)}
                    placeholder="Short description"
                    className="flex-1 min-w-[180px] px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-neutral-950 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    + Add Outlet
                  </button>
                </form>
              </div>

              {/* Multi-Branch Management */}
              <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-[#0F4C3A]" />
                    <h3 className="text-base font-bold text-neutral-950">
                      Branches ({workspace.branches.length})
                    </h3>
                  </div>
                  <span className="text-xs text-neutral-500">Timezone: Africa/Addis_Ababa</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {workspace.branches.map((b) => (
                    <div
                      key={b.id}
                      className="p-3.5 rounded-lg border border-neutral-200 bg-[#F8F9FA] space-y-1"
                    >
                      <p className="text-sm font-bold text-neutral-950">{b.name}</p>
                      <p className="text-xs text-neutral-600">
                        {b.neighborhood}, {b.city} · {b.hours}
                      </p>
                      <p className="text-xs font-mono-tabular text-neutral-500">{b.phone}</p>
                    </div>
                  ))}
                </div>
                <form
                  onSubmit={handleAddBranch}
                  className="pt-4 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-5 gap-3"
                >
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="Branch name (e.g., Bole Atlas)"
                    className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  />
                  <input
                    type="text"
                    value={newBranchCity}
                    onChange={(e) => setNewBranchCity(e.target.value)}
                    placeholder="City"
                    className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  />
                  <input
                    type="text"
                    value={newBranchNeighborhood}
                    onChange={(e) => setNewBranchNeighborhood(e.target.value)}
                    placeholder="Neighborhood"
                    className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  />
                  <input
                    type="text"
                    value={newBranchPhone}
                    onChange={(e) => setNewBranchPhone(e.target.value)}
                    placeholder="+251 11 ..."
                    className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    + Add Branch
                  </button>
                </form>
              </div>

              {/* Team & Scoped RBAC Access */}
              <div className="bg-white border border-neutral-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-[#0F4C3A]" />
                    <h3 className="text-base font-bold text-neutral-950">
                      Team & Scoped RBAC Access ({workspace.staff.length})
                    </h3>
                  </div>
                  <span className="text-xs text-neutral-500">
                    Tenant · Branch · Outlet Isolation
                  </span>
                </div>

                {workspace.staff.length === 0 ? (
                  <p className="text-xs text-neutral-500">
                    Sign in to view active tenant memberships and send scoped staff invitations.
                  </p>
                ) : (
                  <div className="divide-y divide-neutral-100">
                    {workspace.staff.map((member) => (
                      <div
                        key={member.id}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                      >
                        <div>
                          <p className="font-semibold text-neutral-950">
                            {member.name}
                            {member.email ? ` (${member.email})` : ''}
                          </p>
                          <p className="text-xs text-neutral-500">
                            Scope: {member.scopeType || 'tenant'} · {member.outletName}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-[#0F4C3A] capitalize">
                          {member.role.replace('_', ' ')} · {member.active ? 'Active' : 'Suspended'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={handleInviteStaff}
                  className="pt-4 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-5 gap-3"
                >
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@business.et"
                    className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  />
                  <select
                    value={inviteRoleId}
                    onChange={(e) =>
                      setInviteRoleId(
                        e.target.value as
                          | 'tenant_manager'
                          | 'branch_manager'
                          | 'outlet_staff'
                          | 'kitchen_staff'
                      )
                    }
                    aria-label="Staff role"
                    className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  >
                    <option value="tenant_manager">Tenant Manager</option>
                    <option value="branch_manager">Branch Manager</option>
                    <option value="outlet_staff">Outlet Staff</option>
                    <option value="kitchen_staff">Kitchen Staff</option>
                  </select>
                  <select
                    value={inviteScopeType}
                    onChange={(e) =>
                      setInviteScopeType(e.target.value as 'tenant' | 'branch' | 'outlet')
                    }
                    aria-label="Access scope level"
                    className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                  >
                    <option value="tenant">Tenant-wide</option>
                    <option value="branch">Branch-scoped</option>
                    <option value="outlet">Outlet-scoped</option>
                  </select>
                  {inviteScopeType === 'branch' ? (
                    <select
                      value={inviteBranchId || workspace.branches[0]?.id || ''}
                      onChange={(e) => setInviteBranchId(e.target.value)}
                      aria-label="Assigned branch"
                      className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                    >
                      {workspace.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  ) : inviteScopeType === 'outlet' ? (
                    <select
                      value={inviteOutletId || workspace.outlets[0]?.id || ''}
                      onChange={(e) => setInviteOutletId(e.target.value)}
                      aria-label="Assigned outlet"
                      className="px-3 py-2 text-sm border border-neutral-300 rounded-lg"
                    >
                      {workspace.outlets.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name.en}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="px-3 py-2 text-xs text-neutral-500 border border-neutral-200 rounded-lg flex items-center bg-[#F8F9FA]">
                      All branches & outlets
                    </div>
                  )}
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-neutral-950 rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    Send Scoped Invite
                  </button>
                </form>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
