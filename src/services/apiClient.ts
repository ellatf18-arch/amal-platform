import type {
  AvailabilityRule,
  BusinessTypeId,
  BusinessWorkspace,
  LanguageCode,
  OrderRecord,
  OrderingWorkflow,
  PaymentProviderId,
  QrStation,
  ReservationOrSpecialRequest,
  WebsiteSectionKey,
  WebsiteTemplateId,
} from '../types/amal';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  platformRole: 'platform_admin' | 'platform_support_ro' | null;
}

export interface TenantMembershipSummary {
  tenantId: string;
  slug: string;
  businessName: string;
  primaryBusinessType: BusinessTypeId;
  roleId: string;
  scopeType: 'tenant' | 'branch' | 'outlet';
}

export interface AuthSessionResponse {
  user: AuthUser;
  memberships: TenantMembershipSummary[];
  activeTenantId: string | null;
  csrfToken?: string;
}

export interface PublicPresetSummary {
  tenant_id: string;
  slug: string;
  business_name: string;
  primary_business_type: BusinessTypeId;
}

let inMemoryCsrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  inMemoryCsrfToken = token;
}

export function getCsrfToken(): string | null {
  return inMemoryCsrfToken;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    skipRefreshRetry?: boolean;
  } = {}
): Promise<T> {
  const method = options.method || 'GET';
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (method !== 'GET' && inMemoryCsrfToken) {
    headers['X-CSRF-Token'] = inMemoryCsrfToken;
  }

  const res = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  // If authenticated CSRF token is missing after full page reload, refresh session once to obtain fresh CSRF token
  if (
    (res.status === 401 || res.status === 403) &&
    !options.skipRefreshRetry &&
    path !== '/auth/login' &&
    path !== '/auth/register' &&
    path !== '/auth/refresh'
  ) {
    const refreshRes = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (refreshRes.ok) {
      const refreshData = (await refreshRes.json()) as { csrfToken?: string };
      if (refreshData.csrfToken) {
        inMemoryCsrfToken = refreshData.csrfToken;
        return apiRequest<T>(path, { ...options, skipRefreshRetry: true });
      }
    }
  }

  let data: unknown = {};
  const rawText = await res.text();
  if (rawText) {
    try {
      data = JSON.parse(rawText);
    } catch {
      if (res.ok) {
        throw new ApiError(res.status, 'Invalid JSON response from server');
      }
      data = {};
    }
  } else if (res.ok) {
    throw new ApiError(res.status, 'Empty response from server');
  }

  if (!res.ok) {
    throw new ApiError(
      res.status,
      (data as { error?: string }).error || `Request failed (${res.status})`,
      data
    );
  }
  return data as T;
}

export const amalApi = {
  async login(payload: { email: string; password: string }): Promise<AuthSessionResponse> {
    const res = await apiRequest<AuthSessionResponse>('/auth/login', {
      method: 'POST',
      body: payload,
      skipRefreshRetry: true,
    });
    if (res.csrfToken) setCsrfToken(res.csrfToken);
    return res;
  },

  async register(payload: {
    email: string;
    password: string;
    fullName: string;
    phoneE164?: string;
  }): Promise<AuthSessionResponse> {
    const res = await apiRequest<AuthSessionResponse>('/auth/register', {
      method: 'POST',
      body: payload,
      skipRefreshRetry: true,
    });
    if (res.csrfToken) setCsrfToken(res.csrfToken);
    return res;
  },

  async refresh(): Promise<{ csrfToken: string; expiresAt: string } | null> {
    try {
      const res = await apiRequest<{ csrfToken: string; expiresAt: string }>('/auth/refresh', {
        method: 'POST',
        skipRefreshRetry: true,
      });
      if (res.csrfToken) setCsrfToken(res.csrfToken);
      return res;
    } catch {
      setCsrfToken(null);
      return null;
    }
  },

  async getMe(): Promise<AuthSessionResponse | null> {
    try {
      const res = await apiRequest<AuthSessionResponse>('/auth/me', { skipRefreshRetry: true });
      if (!inMemoryCsrfToken) {
        // Hydrate fresh rotating CSRF token silently on page reload if cookie is present
        await this.refresh();
      }
      return res;
    } catch {
      return null;
    }
  },

  async logout(): Promise<void> {
    try {
      await apiRequest<{ ok: boolean }>('/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
    }
  },

  async switchTenant(tenantId: string): Promise<{ activeTenantId: string; workspace: BusinessWorkspace }> {
    return apiRequest('/auth/switch-tenant', {
      method: 'POST',
      body: { tenantId },
    });
  },

  async requestPasswordReset(email: string): Promise<{ ok: boolean; message: string }> {
    return apiRequest('/auth/password-reset/request', {
      method: 'POST',
      body: { email },
      skipRefreshRetry: true,
    });
  },

  async confirmPasswordReset(payload: {
    token: string;
    newPassword: string;
  }): Promise<{ ok: boolean }> {
    return apiRequest('/auth/password-reset/confirm', {
      method: 'POST',
      body: payload,
      skipRefreshRetry: true,
    });
  },

  async listStaff(): Promise<{
    staff: Array<{
      membershipId: string;
      userId: string;
      roleId: string;
      scopeType: 'tenant' | 'branch' | 'outlet';
      status: string;
      fullName: string;
      email: string;
    }>;
  }> {
    return apiRequest('/staff');
  },

  async inviteStaff(payload: {
    email: string;
    roleId: 'tenant_manager' | 'branch_manager' | 'outlet_staff' | 'kitchen_staff';
    scopeType: 'tenant' | 'branch' | 'outlet';
    branchIds?: string[];
    outletAssignments?: Array<{ branchId: string; outletId: string }>;
  }): Promise<{ invitationId: string; expiresAt: string; scopeType: string }> {
    return apiRequest('/staff/invitations', {
      method: 'POST',
      body: payload,
    });
  },

  async acceptStaffInvitation(token: string): Promise<{ ok: boolean; tenantId: string }> {
    return apiRequest('/staff/invitations/accept', {
      method: 'POST',
      body: { token },
    });
  },

  async onboardWorkspace(payload: {
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
    planTier?: 'starter' | 'growth' | 'pro' | 'enterprise';
  }): Promise<{ workspace: BusinessWorkspace }> {
    return apiRequest('/onboarding', {
      method: 'POST',
      body: payload,
    });
  },

  async getCurrentWorkspace(): Promise<{
    workspace: BusinessWorkspace;
    scope: { roleId: string; scopeType: string };
  }> {
    return apiRequest('/tenants/current');
  },

  async createBranch(payload: {
    name: string;
    city: string;
    neighborhood: string;
    phone: string;
    whatsappNumber: string;
    displayHours?: string;
    timezone?: string;
  }): Promise<{
    branch: {
      id: string;
      name: string;
      city: string;
      neighborhood: string;
      phone: string;
      whatsappNumber: string;
      hours: string;
    };
  }> {
    return apiRequest('/tenants/current/branches', {
      method: 'POST',
      body: payload,
    });
  },

  async createOutlet(payload: {
    branchId?: string;
    nameEn: string;
    outletKind:
      | 'dining_room'
      | 'cafe_counter'
      | 'room_service'
      | 'bar_lounge'
      | 'bakery_pickup'
      | 'juice_bar'
      | 'kitchen_express'
      | 'cultural_hall';
    description: string;
    supportsTables?: boolean;
    supportsRoomService?: boolean;
  }): Promise<{ outlet: { id: string } }> {
    return apiRequest('/tenants/current/outlets', {
      method: 'POST',
      body: payload,
    });
  },

  async createProduct(payload: {
    categoryId: string;
    nameEn: string;
    nameAm?: string;
    descriptionEn?: string;
    basePriceEtb: number;
    fastingDayEligible: boolean;
    variations: Array<{ nameEn: string; priceDeltaEtb: number }>;
  }): Promise<{ productId: string }> {
    return apiRequest('/tenants/current/products', {
      method: 'POST',
      body: payload,
    });
  },

  async updateProductAvailability(
    productId: string,
    status: AvailabilityRule['status']
  ): Promise<{ ok: boolean }> {
    return apiRequest(`/tenants/current/products/${encodeURIComponent(productId)}/availability`, {
      method: 'PATCH',
      body: { status },
    });
  },

  async restockProduct(
    productId: string,
    quantity: number,
    reason?: string
  ): Promise<{ availableQty: number; reservedQty: number }> {
    return apiRequest(`/tenants/current/inventory/${encodeURIComponent(productId)}/restock`, {
      method: 'POST',
      body: { quantity, reason },
    });
  },

  async createQrStation(payload: {
    label: string;
    stationType: QrStation['stationType'];
    outletId: string;
    capacityOrZone: string;
  }): Promise<{ station: QrStation }> {
    return apiRequest('/tenants/current/qr-stations', {
      method: 'POST',
      body: payload,
    });
  },

  async rotateQrStation(stationId: string): Promise<{ scanToken: string; tokenVersion: number }> {
    return apiRequest(`/tenants/current/qr-stations/${encodeURIComponent(stationId)}/rotate`, {
      method: 'POST',
      body: {},
    });
  },

  async advanceOrderStatus(orderId: string): Promise<{ status: OrderRecord['status'] }> {
    return apiRequest(`/tenants/current/orders/${encodeURIComponent(orderId)}/advance`, {
      method: 'PATCH',
      body: {},
    });
  },

  async updateSpecialRequest(
    requestId: string,
    payload: {
      status: ReservationOrSpecialRequest['status'];
      estimatedEtb?: number;
    }
  ): Promise<{
    ok: boolean;
    status: ReservationOrSpecialRequest['status'];
    estimatedEtb?: number;
  }> {
    return apiRequest(`/tenants/current/special-requests/${encodeURIComponent(requestId)}`, {
      method: 'PATCH',
      body: payload,
    });
  },

  async updateWebsiteConfig(payload: {
    templateId?: WebsiteTemplateId;
    accentHex?: string;
    typographyStyle?: 'editorial' | 'geometric' | 'athletic';
    heroHeadlineEn?: string;
    heroImageUrl?: string;
    visibleSections?: WebsiteSectionKey[];
    lowBandwidthDefault?: boolean;
    acceptedPayments?: PaymentProviderId[];
    whatsappOrderingEnabled?: boolean;
    fastingModeActive?: boolean;
  }): Promise<{ ok: boolean }> {
    return apiRequest('/tenants/current/website', {
      method: 'PATCH',
      body: payload,
    });
  },

  async importLocalBlueprint(payload: {
    businessName: string;
    tagline?: string;
    accentHex?: string;
    fastingModeActive?: boolean;
  }): Promise<{ ok: boolean; importedPii: false; importedOrders: false }> {
    return apiRequest('/tenants/current/import-local-blueprint', {
      method: 'POST',
      body: payload,
    });
  },

  async getPublicPresets(): Promise<{ presets: PublicPresetSummary[] }> {
    return apiRequest('/public/presets', { skipRefreshRetry: true });
  },

  async getPublicStorefront(
    slug: string,
    stationToken?: string
  ): Promise<{
    workspace: BusinessWorkspace;
    matchedStation: {
      id: string;
      label: string;
      stationType: QrStation['stationType'];
      outletId: string;
      branchId: string;
    } | null;
  }> {
    const qs = stationToken ? `?station=${encodeURIComponent(stationToken)}` : '';
    return apiRequest(`/public/storefronts/${encodeURIComponent(slug)}${qs}`, {
      skipRefreshRetry: true,
    });
  },

  async checkPublicLoyalty(
    slug: string,
    phone: string
  ): Promise<{
    found: boolean;
    loyalty: { maskedName: string; stampsBalance: number; targetStamps: number } | null;
  }> {
    return apiRequest(
      `/public/storefronts/${encodeURIComponent(slug)}/loyalty/check?phone=${encodeURIComponent(phone)}`,
      { skipRefreshRetry: true }
    );
  },

  async publicCheckout(
    slug: string,
    payload: {
      workflow: OrderingWorkflow;
      outletId: string;
      stationToken?: string;
      stationLabel?: string;
      customerName: string;
      customerPhone: string;
      paymentProvider: PaymentProviderId;
      pickupScheduledFor?: string;
      idempotencyKey?: string;
      items: Array<{
        productId: string;
        variationId?: string;
        selectedModifierOptionIds: string[];
        quantity: number;
        notes?: string;
      }>;
    }
  ): Promise<{
    order: {
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
      paymentStatus: OrderRecord['paymentStatus'];
      status: OrderRecord['status'];
      totalMinor: string;
      totalEtb: number;
    };
    paymentMode: string;
    paymentMessage: string;
  }> {
    return apiRequest(`/public/storefronts/${encodeURIComponent(slug)}/checkout`, {
      method: 'POST',
      body: payload,
      skipRefreshRetry: true,
    });
  },

  async submitPublicSpecialRequest(
    slug: string,
    payload: {
      kind: ReservationOrSpecialRequest['kind'];
      outletId?: string;
      customerName: string;
      customerPhone: string;
      dateTime: string;
      partyOrSize: string;
      details: string;
    }
  ): Promise<{ requestId: string; status: string }> {
    return apiRequest(`/public/storefronts/${encodeURIComponent(slug)}/special-requests`, {
      method: 'POST',
      body: payload,
      skipRefreshRetry: true,
    });
  },
};
