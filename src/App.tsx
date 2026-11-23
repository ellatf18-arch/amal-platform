/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { LiveStorefront } from './components/LiveStorefront';
import { MerchantDashboard } from './components/MerchantDashboard';
import { OnboardingWizard } from './components/OnboardingWizard';
import { PlatformOverview } from './components/PlatformOverview';
import { OfflineIndicator } from './components/PWAInstallButton';
import { AppView, TopBar } from './components/TopBar';
import { BUSINESS_PRESETS } from './data/presets';
import {
  amalApi,
  type AuthSessionResponse,
  type PublicPresetSummary,
} from './services/apiClient';
import {
  BusinessTypeId,
  BusinessWorkspace,
  OrderRecord,
  ReservationOrSpecialRequest,
} from './types/amal';

const LEGACY_STORAGE_KEY = 'amal_workspaces_v1';
const LEGACY_DISMISSED_KEY = 'amal_legacy_import_dismissed_v1';

const ALL_PRESET_IDS: BusinessTypeId[] = [
  'traditional_ethiopian',
  'coffee_house',
  'restaurant',
  'hotel',
  'juice_bar',
  'fast_food',
  'bakery',
];

export interface LegacyBlueprintCandidate {
  businessName: string;
  tagline?: string;
  accentHex?: string;
  fastingModeActive?: boolean;
}

function parseStorefrontUrl(): {
  slug: string | null;
  stationToken?: string;
  inviteToken?: string;
  resetToken?: string;
} {
  if (typeof window === 'undefined') return { slug: null };
  const match = window.location.pathname.match(/^\/s\/([^/]+)\/?$/);
  const slug = match ? decodeURIComponent(match[1]) : null;
  const params = new URLSearchParams(window.location.search);
  return {
    slug,
    stationToken: params.get('station') || undefined,
    inviteToken: params.get('inviteToken') || undefined,
    resetToken: params.get('resetToken') || undefined,
  };
}

function detectLegacyBlueprintCandidate(): LegacyBlueprintCandidate | null {
  try {
    if (localStorage.getItem(LEGACY_DISMISSED_KEY) === '1') return null;
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, Partial<BusinessWorkspace>>;
    const customEntry = Object.values(parsed).find(
      (ws) => ws && typeof ws.id === 'string' && !ws.id.startsWith('ws-') && ws.businessName
    );
    if (!customEntry || !customEntry.businessName) return null;
    return {
      businessName: customEntry.businessName,
      tagline: typeof customEntry.tagline === 'string' ? customEntry.tagline : undefined,
      accentHex:
        typeof customEntry.websiteConfig?.accentHex === 'string'
          ? customEntry.websiteConfig.accentHex
          : undefined,
      fastingModeActive:
        typeof customEntry.localization?.fastingModeActive === 'boolean'
          ? customEntry.localization.fastingModeActive
          : undefined,
    };
  } catch {
    return null;
  }
}

class AppErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[AMAL UI ERROR]', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-lg mx-auto my-16 p-6 bg-white border border-neutral-200 rounded-xl text-center space-y-4">
          <h2 className="text-lg font-bold text-neutral-950">Something went wrong loading this view</h2>
          <p className="text-sm text-neutral-600">
            Your session and business data are safe. Return to the platform overview to continue.
          </p>
          <button
            type="button"
            onClick={() => {
              this.setState({ hasError: false });
              this.props.onReset();
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0F4C3A] rounded-lg hover:bg-[#0B3B2D] cursor-pointer"
          >
            Return to Platform Overview
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function isValidWorkspace(ws: unknown): ws is BusinessWorkspace {
  return (
    typeof ws === 'object' &&
    ws !== null &&
    typeof (ws as BusinessWorkspace).id === 'string' &&
    typeof (ws as BusinessWorkspace).primaryBusinessType === 'string'
  );
}

export default function App() {
  const initialRoute = parseStorefrontUrl();

  const [activeWorkspace, setActiveWorkspaceState] = useState<BusinessWorkspace>(
    BUSINESS_PRESETS.traditional_ethiopian
  );
  const setActiveWorkspace = useCallback(
    (
      next:
        | BusinessWorkspace
        | ((prev: BusinessWorkspace) => BusinessWorkspace)
    ) => {
      if (typeof next === 'function') {
        setActiveWorkspaceState((prev) => {
          const candidate = next(prev);
          return isValidWorkspace(candidate) ? candidate : prev;
        });
      } else if (isValidWorkspace(next)) {
        setActiveWorkspaceState(next);
      }
    },
    []
  );
  const [isAuthenticatedWorkspace, setIsAuthenticatedWorkspace] = useState<boolean>(false);
  const [authSession, setAuthSession] = useState<AuthSessionResponse | null>(null);
  const [publicPresetsByType, setPublicPresetsByType] = useState<
    Partial<Record<BusinessTypeId, PublicPresetSummary>>
  >({});

  const [activeView, setActiveView] = useState<AppView>(
    initialRoute.slug ? 'storefront' : 'platform'
  );
  const [onboardingInitialType, setOnboardingInitialType] =
    useState<BusinessTypeId>('coffee_house');
  const [storefrontStationToken, setStorefrontStationToken] = useState<
    string | undefined
  >(initialRoute.stationToken);

  const [authModalOpen, setAuthModalOpen] = useState<boolean>(
    Boolean(initialRoute.resetToken)
  );
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register' | 'reset_confirm'>(
    initialRoute.resetToken ? 'reset_confirm' : 'login'
  );
  const [authModalMessage, setAuthModalMessage] = useState<string | undefined>(
    initialRoute.resetToken
      ? 'Enter a new password (minimum 8 characters) to complete your password reset.'
      : undefined
  );
  const [pendingInviteToken, setPendingInviteToken] = useState<string | undefined>(
    initialRoute.inviteToken
  );
  const [inviteStatusMessage, setInviteStatusMessage] = useState<string>('');
  const [legacyBlueprintCandidate, setLegacyBlueprintCandidate] =
    useState<LegacyBlueprintCandidate | null>(detectLegacyBlueprintCandidate);

  const loadPresetWorkspace = useCallback(
    async (
      typeId: BusinessTypeId,
      presetMap?: Partial<Record<BusinessTypeId, PublicPresetSummary>>
    ) => {
      const lookup = presetMap || publicPresetsByType;
      const preset = lookup[typeId];
      if (preset?.slug) {
        try {
          const { workspace } = await amalApi.getPublicStorefront(preset.slug);
          if (isValidWorkspace(workspace)) {
            setActiveWorkspace(workspace);
            setIsAuthenticatedWorkspace(false);
            return workspace;
          }
        } catch {
          // Fall back cleanly to static preset definition if database storefront is unavailable
        }
      }
      const fallback = BUSINESS_PRESETS[typeId] || BUSINESS_PRESETS.traditional_ethiopian;
      setActiveWorkspace(fallback);
      setIsAuthenticatedWorkspace(false);
      return fallback;
    },
    [publicPresetsByType, setActiveWorkspace]
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const route = parseStorefrontUrl();
      const [presetsRes, meRes] = await Promise.all([
        amalApi.getPublicPresets().catch(() => ({ presets: [] as PublicPresetSummary[] })),
        amalApi.getMe().catch(() => null),
      ]);

      if (cancelled) return;

      const byType: Partial<Record<BusinessTypeId, PublicPresetSummary>> = {};
      for (const p of presetsRes.presets) {
        byType[p.primary_business_type] = p;
      }
      setPublicPresetsByType(byType);
      setAuthSession(meRes);

      if (route.slug) {
        try {
          const { workspace } = await amalApi.getPublicStorefront(
            route.slug,
            route.stationToken
          );
          if (!cancelled && isValidWorkspace(workspace)) {
            setActiveWorkspace(workspace);
            setIsAuthenticatedWorkspace(false);
            setStorefrontStationToken(route.stationToken);
            setActiveView('storefront');
            return;
          }
        } catch {
          // Fall through to normal workspace hydration if slug is unknown
        }
      }

      if (meRes?.activeTenantId) {
        try {
          const { workspace } = await amalApi.getCurrentWorkspace();
          if (!cancelled && isValidWorkspace(workspace)) {
            setActiveWorkspace(workspace);
            setIsAuthenticatedWorkspace(true);
            return;
          }
        } catch {
          // Fall back to default public preset
        }
      }

      await loadPresetWorkspace('traditional_ethiopian', byType);
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [loadPresetWorkspace]);

  useEffect(() => {
    const handlePopState = async () => {
      const route = parseStorefrontUrl();
      if (route.slug) {
        try {
          const { workspace } = await amalApi.getPublicStorefront(
            route.slug,
            route.stationToken
          );
          setActiveWorkspace(workspace);
          setIsAuthenticatedWorkspace(false);
          setStorefrontStationToken(route.stationToken);
          setActiveView('storefront');
        } catch {
          setActiveView('platform');
        }
      } else if (activeView === 'storefront') {
        setStorefrontStationToken(undefined);
        setActiveView('platform');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeView]);

  const syncUrlForView = (
    view: AppView,
    slug?: string,
    stationToken?: string
  ) => {
    if (typeof window === 'undefined') return;
    if (view === 'storefront' && slug) {
      const targetUrl = `/s/${encodeURIComponent(slug)}${
        stationToken ? `?station=${encodeURIComponent(stationToken)}` : ''
      }`;
      if (`${window.location.pathname}${window.location.search}` !== targetUrl) {
        window.history.pushState(null, '', targetUrl);
      }
    } else if (window.location.pathname.startsWith('/s/')) {
      window.history.replaceState(null, '', '/');
    }
  };

  const handleNavigate = (view: AppView) => {
    if (view !== 'storefront') {
      setStorefrontStationToken(undefined);
      syncUrlForView(view);
    } else {
      syncUrlForView('storefront', activeWorkspace.slug, storefrontStationToken);
    }
    setActiveView(view);
  };

  const handleSelectCategoryPreset = async (
    typeId: BusinessTypeId,
    destination: 'dashboard' | 'storefront'
  ) => {
    const loaded = await loadPresetWorkspace(typeId);
    setStorefrontStationToken(undefined);
    syncUrlForView(destination, loaded.slug);
    setActiveView(destination);
  };

  const handleSwitchTenant = async (tenantId: string) => {
    const res = await amalApi.switchTenant(tenantId);
    setActiveWorkspace(res.workspace);
    setIsAuthenticatedWorkspace(true);
    setAuthSession((prev) => (prev ? { ...prev, activeTenantId: res.activeTenantId } : prev));
  };

  const handleRefreshWorkspace = async () => {
    if (isAuthenticatedWorkspace) {
      const { workspace } = await amalApi.getCurrentWorkspace();
      setActiveWorkspace(workspace);
    } else if (activeWorkspace.slug) {
      try {
        const { workspace } = await amalApi.getPublicStorefront(
          activeWorkspace.slug,
          storefrontStationToken
        );
        setActiveWorkspace(workspace);
      } catch {
        // Keep current workspace state if public refresh fails
      }
    }
  };

  const handleCompleteOnboarding = async (newWorkspace: BusinessWorkspace) => {
    setActiveWorkspace(newWorkspace);
    setIsAuthenticatedWorkspace(true);
    setStorefrontStationToken(undefined);
    syncUrlForView('dashboard');
    setActiveView('dashboard');
    const updatedMe = await amalApi.getMe().catch(() => null);
    if (updatedMe) setAuthSession(updatedMe);
  };

  const handleAuthenticated = async (session: AuthSessionResponse) => {
    setAuthSession(session);
    if (session.activeTenantId && activeView !== 'onboarding') {
      try {
        const { workspace } = await amalApi.getCurrentWorkspace();
        setActiveWorkspace(workspace);
        setIsAuthenticatedWorkspace(true);
      } catch {
        // Ignore if active tenant hydration fails
      }
    }
  };

  const handleLogout = async () => {
    await amalApi.logout();
    setAuthSession(null);
    setIsAuthenticatedWorkspace(false);
    await loadPresetWorkspace(activeWorkspace.primaryBusinessType || 'traditional_ethiopian');
  };

  const handleLaunchStorefront = (token?: string) => {
    setStorefrontStationToken(token);
    syncUrlForView('storefront', activeWorkspace.slug, token);
    setActiveView('storefront');
  };

  const handlePlaceOrder = (order: OrderRecord) => {
    setActiveWorkspace((prev) => ({
      ...prev,
      orders: [order, ...prev.orders],
    }));
  };

  const handleSpecialRequest = (req: ReservationOrSpecialRequest) => {
    setActiveWorkspace((prev) => ({
      ...prev,
      specialRequests: [req, ...prev.specialRequests],
    }));
  };

  const handleImportLocalBlueprint = async () => {
    if (!legacyBlueprintCandidate || !isAuthenticatedWorkspace) return;
    await amalApi.importLocalBlueprint(legacyBlueprintCandidate);
    try {
      localStorage.setItem(LEGACY_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage failures
    }
    setLegacyBlueprintCandidate(null);
    await handleRefreshWorkspace();
  };

  const handleDismissLocalBlueprint = () => {
    try {
      localStorage.setItem(LEGACY_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage failures
    }
    setLegacyBlueprintCandidate(null);
  };

  const handleAcceptPendingInvite = async () => {
    if (!pendingInviteToken) return;
    if (!authSession?.user) {
      setAuthModalMode('login');
      setAuthModalMessage('Sign in (or create an account matching your invited email) to accept this workspace invitation.');
      setAuthModalOpen(true);
      return;
    }
    setInviteStatusMessage('');
    try {
      await amalApi.acceptStaffInvitation(pendingInviteToken);
      setPendingInviteToken(undefined);
      if (typeof window !== 'undefined' && window.location.search.includes('inviteToken')) {
        window.history.replaceState(null, '', window.location.pathname);
      }
      const [meRes, wsRes] = await Promise.all([
        amalApi.getMe().catch(() => null),
        amalApi.getCurrentWorkspace(),
      ]);
      if (meRes) setAuthSession(meRes);
      setActiveWorkspace(wsRes.workspace);
      setIsAuthenticatedWorkspace(true);
      setActiveView('dashboard');
    } catch (err) {
      setInviteStatusMessage(err instanceof Error ? err.message : 'Unable to accept invitation');
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-neutral-950 flex flex-col">
      <TopBar
        activeView={activeView}
        onNavigate={handleNavigate}
        onQuickStorefront={() => {
          setStorefrontStationToken(undefined);
          syncUrlForView('storefront', activeWorkspace.slug);
          setActiveView('storefront');
        }}
        authUser={authSession?.user || null}
        onOpenAuth={() => {
          setAuthModalMode('login');
          setAuthModalMessage(undefined);
          setAuthModalOpen(true);
        }}
        onLogout={handleLogout}
      />

      {pendingInviteToken && (
        <div className="bg-[#0F4C3A] text-white px-6 py-2.5 text-xs flex flex-wrap items-center justify-between gap-3">
          <span>
            You have a pending staff workspace invitation.
            {inviteStatusMessage ? ` (${inviteStatusMessage})` : ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAcceptPendingInvite}
              className="px-3 py-1 bg-white text-neutral-950 font-semibold rounded cursor-pointer"
            >
              {authSession?.user ? 'Accept Invitation' : 'Sign In to Accept'}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingInviteToken(undefined);
                if (typeof window !== 'undefined' && window.location.search.includes('inviteToken')) {
                  window.history.replaceState(null, '', window.location.pathname);
                }
              }}
              className="px-2 py-1 text-white/80 hover:text-white cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex-1">
        <AppErrorBoundary
          onReset={() => {
            setActiveWorkspace(BUSINESS_PRESETS.traditional_ethiopian);
            setActiveView('platform');
          }}
        >
          {activeView === 'platform' && (
            <PlatformOverview
              activeWorkspace={activeWorkspace}
              onSelectCategoryPreset={handleSelectCategoryPreset}
              onStartOnboarding={(initialType) => {
                if (initialType) setOnboardingInitialType(initialType);
                syncUrlForView('onboarding');
                setActiveView('onboarding');
              }}
            />
          )}

          {activeView === 'onboarding' && (
            <OnboardingWizard
              initialPrimaryType={onboardingInitialType}
              isAuthenticated={Boolean(authSession?.user)}
              onRequireAuth={(message) => {
                setAuthModalMessage(message);
                setAuthModalOpen(true);
              }}
              onComplete={handleCompleteOnboarding}
              onCancel={() => {
                syncUrlForView('platform');
                setActiveView('platform');
              }}
            />
          )}

          {activeView === 'dashboard' && (
            <MerchantDashboard
              workspace={activeWorkspace}
              allPresetIds={ALL_PRESET_IDS}
              isAuthenticatedWorkspace={isAuthenticatedWorkspace}
              memberships={authSession?.memberships || []}
              onSwitchTenant={handleSwitchTenant}
              onRefreshWorkspace={handleRefreshWorkspace}
              onSwitchPreset={async (typeId) => {
                await loadPresetWorkspace(typeId);
                setStorefrontStationToken(undefined);
              }}
              onUpdateWorkspace={setActiveWorkspace}
              onLaunchStorefront={handleLaunchStorefront}
              onStartOnboarding={() => {
                setOnboardingInitialType(activeWorkspace.primaryBusinessType);
                syncUrlForView('onboarding');
                setActiveView('onboarding');
              }}
              legacyBlueprintCandidate={legacyBlueprintCandidate}
              onImportLocalBlueprint={handleImportLocalBlueprint}
              onDismissLocalBlueprint={handleDismissLocalBlueprint}
            />
          )}

          {activeView === 'storefront' && (
            <LiveStorefront
              key={`${activeWorkspace.id}-${storefrontStationToken || 'root'}`}
              workspace={activeWorkspace}
              initialStationToken={storefrontStationToken}
              onPlaceOrder={handlePlaceOrder}
              onSubmitSpecialRequest={handleSpecialRequest}
              onBackToDashboard={() => {
                syncUrlForView('dashboard');
                setActiveView('dashboard');
              }}
            />
          )}
        </AppErrorBoundary>
      </div>

      <AuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        initialResetToken={initialRoute.resetToken || ''}
        contextMessage={authModalMessage}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={handleAuthenticated}
        onResetCompleted={() => {
          if (typeof window !== 'undefined' && window.location.search.includes('resetToken')) {
            window.history.replaceState(null, '', window.location.pathname);
          }
        }}
      />
      <OfflineIndicator />
    </div>
  );
}
