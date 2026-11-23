import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  date,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Custom bytea column for AES-256-GCM encrypted QR payloads
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export interface LocalizedJson {
  en: string;
  am?: string;
  om?: string;
}

// ============================================================================
// GROUP A: GLOBAL AUTH, RBAC & PLATFORM GOVERNANCE (5 TABLES)
// ============================================================================

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    phoneE164: text('phone_e164'),
    isEmailVerified: boolean('is_email_verified').notNull().default(false),
    platformRole: text('platform_role'), // NULL | 'platform_admin' | 'platform_support_ro'
    status: text('status').notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_users_email_norm').on(t.emailNormalized),
    check('chk_users_status', sql`${t.status} IN ('active', 'locked', 'disabled')`),
    check(
      'chk_users_platform_role',
      sql`${t.platformRole} IS NULL OR ${t.platformRole} IN ('platform_admin', 'platform_support_ro')`
    ),
  ]
);

export const roles = pgTable(
  'roles',
  {
    id: text('id').primaryKey(), // tenant_owner | tenant_manager | branch_manager | outlet_staff | kitchen_staff
    name: text('name').notNull(),
    scopeLevel: text('scope_level').notNull(), // tenant | branch | outlet
    permissions: text('permissions').array().notNull(),
  },
  (t) => [
    check('chk_roles_scope_level', sql`${t.scopeLevel} IN ('tenant', 'branch', 'outlet')`),
  ]
);

// ============================================================================
// GROUP B: TENANT ROOT, MEMBERSHIPS & INVITATIONS (7 TABLES)
// ============================================================================

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    slug: text('slug').notNull(),
    businessName: text('business_name').notNull(),
    tagline: text('tagline').notNull().default(''),
    operatingCurrency: char('operating_currency', { length: 3 }).notNull().default('ETB'),
    primaryBusinessType: text('primary_business_type').notNull(),
    businessTypes: text('business_types').array().notNull(),
    enabledCapabilities: text('enabled_capabilities').array().notNull(),
    allowedWorkflows: text('allowed_workflows').array().notNull(),
    // Plan & Tax governance fields (aligned with AMAL Master Business Strategy)
    planTier: text('plan_tier').notNull().default('starter'),
    subscriptionStatus: text('subscription_status').notNull().default('trial'),
    maxBranches: integer('max_branches').notNull().default(1),
    maxOutlets: integer('max_outlets').notNull().default(1),
    vatRegistered: boolean('vat_registered').notNull().default(false),
    tinNumber: text('tin_number'),
    defaultTaxRateBps: integer('default_tax_rate_bps').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_tenants_active_slug')
      .on(t.slug)
      .where(sql`${t.deletedAt} IS NULL`),
    unique('uq_tenants_id_currency').on(t.id, t.operatingCurrency),
    index('idx_tenants_business_types_gin').using('gin', t.businessTypes),
    index('idx_tenants_capabilities_gin').using('gin', t.enabledCapabilities),
    check('chk_tenants_currency', sql`${t.operatingCurrency} IN ('ETB', 'USD', 'KES', 'EUR')`),
    check(
      'chk_tenants_plan_tier',
      sql`${t.planTier} IN ('starter', 'growth', 'pro', 'enterprise')`
    ),
    check(
      'chk_tenants_sub_status',
      sql`${t.subscriptionStatus} IN ('trial', 'active', 'past_due', 'suspended', 'cancelled')`
    ),
    check(
      'chk_tenants_primary_type',
      sql`${t.primaryBusinessType} IN ('restaurant','coffee_house','hotel','juice_bar','fast_food','bakery','traditional_ethiopian')`
    ),
    check(
      'chk_tenants_business_types_valid',
      sql`cardinality(${t.businessTypes}) >= 1 AND ${t.businessTypes} <@ ARRAY['restaurant','coffee_house','hotel','juice_bar','fast_food','bakery','traditional_ethiopian']::text[]`
    ),
    check('chk_tenants_tax_bps', sql`${t.defaultTaxRateBps} >= 0 AND ${t.defaultTaxRateBps} <= 5000`),
  ]
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeTenantId: uuid('active_tenant_id').references(() => tenants.id, {
      onDelete: 'set null',
    }),
    tokenHash: text('token_hash').notNull(),
    csrfTokenHash: text('csrf_token_hash').notNull(),
    familyId: uuid('family_id').notNull(),
    replacedBySessionId: uuid('replaced_by_session_id'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_user_sessions_token_hash').on(t.tokenHash),
    index('idx_user_sessions_user_exp').on(t.userId, t.expiresAt),
    index('idx_user_sessions_family').on(t.familyId),
  ]
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_pwd_reset_token_hash').on(t.tokenHash),
    index('idx_pwd_reset_user').on(t.userId, t.expiresAt),
  ]
);

export const platformAdminImpersonationLogs = pgTable(
  'platform_admin_impersonation_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    targetTenantId: uuid('target_tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    mode: text('mode').notNull().default('read_only'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('chk_impersonation_mode', sql`${t.mode} IN ('read_only', 'support_write')`),
    index('idx_impersonation_tenant').on(t.targetTenantId, t.createdAt),
  ]
);

// ============================================================================
// GROUP C: BRANCHES, OPERATING HOURS & MULTI-OUTLET STRUCTURE (4 TABLES)
// ============================================================================

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    city: text('city').notNull(),
    neighborhood: text('neighborhood').notNull(),
    phone: text('phone').notNull(),
    whatsappNumber: text('whatsapp_number').notNull(),
    timezone: text('timezone').notNull().default('Africa/Addis_Ababa'),
    displayHours: text('display_hours').notNull().default('08:00 – 22:00 Daily'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('uq_branches_tenant_id').on(t.tenantId, t.id),
    index('idx_branches_tenant_active').on(t.tenantId, t.active),
  ]
);

export const branchOperatingHours = pgTable(
  'branch_operating_hours',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    dayOfWeek: smallint('day_of_week').notNull(), // 0=Sun..6=Sat
    periodIndex: smallint('period_index').notNull().default(0),
    openTime: time('open_time').notNull(),
    closeTime: time('close_time').notNull(),
    crossesMidnight: boolean('crosses_midnight').notNull().default(false),
    isClosed: boolean('is_closed').notNull().default(false),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'fk_boh_tenant_branch',
    }).onDelete('cascade'),
    unique('uq_boh_branch_day_period').on(t.tenantId, t.branchId, t.dayOfWeek, t.periodIndex),
    check('chk_boh_day', sql`${t.dayOfWeek} BETWEEN 0 AND 6`),
    check('chk_boh_period', sql`${t.periodIndex} >= 0`),
  ]
);

export const branchScheduleOverrides = pgTable(
  'branch_schedule_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    isClosed: boolean('is_closed').notNull().default(false),
    openTime: time('open_time'),
    closeTime: time('close_time'),
    crossesMidnight: boolean('crosses_midnight').notNull().default(false),
    reason: text('reason').notNull().default(''),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'fk_bso_tenant_branch',
    }).onDelete('cascade'),
    check('chk_bso_date_range', sql`${t.endDate} >= ${t.startDate}`),
    index('idx_bso_lookup').on(t.tenantId, t.branchId, t.startDate, t.endDate),
  ]
);

export const outlets = pgTable(
  'outlets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    nameJson: jsonb('name_json').$type<LocalizedJson>().notNull(),
    outletKind: text('outlet_kind').notNull(),
    description: text('description').notNull().default(''),
    supportsTables: boolean('supports_tables').notNull().default(true),
    supportsRoomService: boolean('supports_room_service').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'fk_outlets_tenant_branch',
    }).onDelete('restrict'),
    unique('uq_outlets_tenant_id').on(t.tenantId, t.id),
    unique('uq_outlets_tenant_branch_id').on(t.tenantId, t.branchId, t.id),
    check(
      'chk_outlets_kind',
      sql`${t.outletKind} IN ('dining_room','cafe_counter','room_service','bar_lounge','bakery_pickup','juice_bar','kitchen_express','cultural_hall')`
    ),
  ]
);

// ============================================================================
// SCOPED MEMBERSHIPS & INVITATIONS (REMAINING 6 TABLES OF GROUP B)
// ============================================================================

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    scopeType: text('scope_type').notNull(), // tenant | branch | outlet
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_tm_tenant_id').on(t.tenantId, t.id),
    uniqueIndex('uq_tm_tenant_user').on(t.tenantId, t.userId),
    check('chk_tm_scope_type', sql`${t.scopeType} IN ('tenant', 'branch', 'outlet')`),
    check('chk_tm_status', sql`${t.status} IN ('active', 'suspended')`),
  ]
);

export const tenantMembershipBranches = pgTable(
  'tenant_membership_branches',
  {
    tenantId: uuid('tenant_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.membershipId, t.branchId] }),
    foreignKey({
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
      name: 'fk_tmb_membership',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'fk_tmb_branch',
    }).onDelete('restrict'),
  ]
);

export const tenantMembershipOutlets = pgTable(
  'tenant_membership_outlets',
  {
    tenantId: uuid('tenant_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    outletId: uuid('outlet_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.membershipId, t.outletId] }),
    foreignKey({
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [tenantMemberships.tenantId, tenantMemberships.id],
      name: 'fk_tmo_membership',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.branchId, t.outletId],
      foreignColumns: [outlets.tenantId, outlets.branchId, outlets.id],
      name: 'fk_tmo_branch_outlet',
    }).onDelete('restrict'),
  ]
);

export const staffInvitations = pgTable(
  'staff_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    emailNormalized: text('email_normalized').notNull(),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    scopeType: text('scope_type').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uq_si_tenant_id').on(t.tenantId, t.id),
    uniqueIndex('uq_si_token_hash').on(t.tokenHash),
    index('idx_si_tenant_email').on(t.tenantId, t.emailNormalized),
    check('chk_si_scope_type', sql`${t.scopeType} IN ('tenant', 'branch', 'outlet')`),
  ]
);

export const staffInvitationBranchScopes = pgTable(
  'staff_invitation_branch_scopes',
  {
    tenantId: uuid('tenant_id').notNull(),
    invitationId: uuid('invitation_id').notNull(),
    branchId: uuid('branch_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.invitationId, t.branchId] }),
    foreignKey({
      columns: [t.tenantId, t.invitationId],
      foreignColumns: [staffInvitations.tenantId, staffInvitations.id],
      name: 'fk_sibs_invitation',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'fk_sibs_branch',
    }).onDelete('restrict'),
  ]
);

export const staffInvitationOutletScopes = pgTable(
  'staff_invitation_outlet_scopes',
  {
    tenantId: uuid('tenant_id').notNull(),
    invitationId: uuid('invitation_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    outletId: uuid('outlet_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.invitationId, t.outletId] }),
    foreignKey({
      columns: [t.tenantId, t.invitationId],
      foreignColumns: [staffInvitations.tenantId, staffInvitations.id],
      name: 'fk_sios_invitation',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.branchId, t.outletId],
      foreignColumns: [outlets.tenantId, outlets.branchId, outlets.id],
      name: 'fk_sios_branch_outlet',
    }).onDelete('restrict'),
  ]
);

// ============================================================================
// GROUP D: MENUS, CATEGORIES, PRODUCTS, VARIATIONS & MODIFIERS (7 TABLES)
// ============================================================================

export const menus = pgTable(
  'menus',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    outletId: uuid('outlet_id').notNull(),
    nameJson: jsonb('name_json').$type<LocalizedJson>().notNull(),
    activeStartTime: time('active_start_time'),
    activeEndTime: time('active_end_time'),
    crossesMidnight: boolean('crosses_midnight').notNull().default(false),
    activeDays: smallint('active_days').array(), // e.g. [0,1,2,3,4,5,6]
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.outletId],
      foreignColumns: [outlets.tenantId, outlets.id],
      name: 'fk_menus_outlet',
    }).onDelete('restrict'),
    unique('uq_menus_tenant_id').on(t.tenantId, t.id),
    unique('uq_menus_tenant_outlet_id').on(t.tenantId, t.outletId, t.id),
  ]
);

export const menuCategories = pgTable(
  'menu_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    menuId: uuid('menu_id').notNull(),
    outletId: uuid('outlet_id').notNull(),
    nameJson: jsonb('name_json').$type<LocalizedJson>().notNull(),
    descriptionJson: jsonb('description_json').$type<LocalizedJson>(),
    regionalOrigin: text('regional_origin'),
    isFastingFriendly: boolean('is_fasting_friendly').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.outletId, t.menuId],
      foreignColumns: [menus.tenantId, menus.outletId, menus.id],
      name: 'fk_mc_tenant_outlet_menu',
    }).onDelete('restrict'),
    unique('uq_mc_tenant_id').on(t.tenantId, t.id),
    unique('uq_mc_tenant_outlet_id').on(t.tenantId, t.outletId, t.id),
    index('idx_mc_tenant_outlet_sort').on(t.tenantId, t.outletId, t.sortOrder),
  ]
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    categoryId: uuid('category_id').notNull(),
    outletId: uuid('outlet_id').notNull(),
    nameJson: jsonb('name_json').$type<LocalizedJson>().notNull(),
    descriptionJson: jsonb('description_json').$type<LocalizedJson>().notNull(),
    basePriceMinor: bigint('base_price_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('ETB'),
    dietaryTags: text('dietary_tags').array().notNull().default(sql`'{}'::text[]`),
    prepTimeMinutes: integer('prep_time_minutes').notNull().default(10),
    isFeatured: boolean('is_featured').notNull().default(false),
    isCombo: boolean('is_combo').notNull().default(false),
    fastingDayEligible: boolean('fasting_day_eligible').notNull().default(false),
    fastingOnly: boolean('fasting_only').notNull().default(false),
    timeWindow: text('time_window'),
    leadTimeHours: integer('lead_time_hours'),
    availabilityStatus: text('availability_status').notNull().default('in_stock'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.outletId, t.categoryId],
      foreignColumns: [menuCategories.tenantId, menuCategories.outletId, menuCategories.id],
      name: 'fk_products_tenant_outlet_cat',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.currencyCode],
      foreignColumns: [tenants.id, tenants.operatingCurrency],
      name: 'fk_products_tenant_currency',
    }).onDelete('restrict'),
    unique('uq_products_tenant_id').on(t.tenantId, t.id),
    unique('uq_products_tenant_outlet_id').on(t.tenantId, t.outletId, t.id),
    check('chk_products_base_price', sql`${t.basePriceMinor} >= 0`),
    check(
      'chk_products_avail',
      sql`${t.availabilityStatus} IN ('in_stock','low_stock','sold_out','pre_order_only')`
    ),
    index('idx_products_dietary_gin').using('gin', t.dietaryTags),
  ]
);

export const productVariations = pgTable(
  'product_variations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    nameJson: jsonb('name_json').$type<LocalizedJson>().notNull(),
    priceDeltaMinor: bigint('price_delta_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('ETB'),
    sku: text('sku'),
    sortOrder: integer('sort_order').notNull().default(0),
    isDefault: boolean('is_default').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'fk_pv_tenant_product',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.currencyCode],
      foreignColumns: [tenants.id, tenants.operatingCurrency],
      name: 'fk_pv_tenant_currency',
    }).onDelete('restrict'),
    unique('uq_pv_tenant_id').on(t.tenantId, t.id),
    unique('uq_pv_tenant_product_id').on(t.tenantId, t.productId, t.id),
  ]
);

export const modifierGroups = pgTable(
  'modifier_groups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    nameJson: jsonb('name_json').$type<LocalizedJson>().notNull(),
    isRequired: boolean('is_required').notNull().default(false),
    minSelect: integer('min_select').notNull().default(0),
    maxSelect: integer('max_select').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('uq_mg_tenant_id').on(t.tenantId, t.id),
    check('chk_mg_select_bounds', sql`${t.minSelect} >= 0 AND ${t.maxSelect} >= ${t.minSelect}`),
  ]
);

export const modifierOptions = pgTable(
  'modifier_options',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    modifierGroupId: uuid('modifier_group_id').notNull(),
    nameJson: jsonb('name_json').$type<LocalizedJson>().notNull(),
    priceDeltaMinor: bigint('price_delta_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('ETB'),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.modifierGroupId],
      foreignColumns: [modifierGroups.tenantId, modifierGroups.id],
      name: 'fk_mo_tenant_group',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.currencyCode],
      foreignColumns: [tenants.id, tenants.operatingCurrency],
      name: 'fk_mo_tenant_currency',
    }).onDelete('restrict'),
    unique('uq_mo_tenant_id').on(t.tenantId, t.id),
    unique('uq_mo_tenant_group_id').on(t.tenantId, t.modifierGroupId, t.id),
  ]
);

export const productModifierGroups = pgTable(
  'product_modifier_groups',
  {
    tenantId: uuid('tenant_id').notNull(),
    productId: uuid('product_id').notNull(),
    modifierGroupId: uuid('modifier_group_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.productId, t.modifierGroupId] }),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'fk_pmg_tenant_product',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.tenantId, t.modifierGroupId],
      foreignColumns: [modifierGroups.tenantId, modifierGroups.id],
      name: 'fk_pmg_tenant_group',
    }).onDelete('restrict'),
  ]
);

// ============================================================================
// GROUP E: INVENTORY ITEMS, RESERVATIONS & MOVEMENTS (3 TABLES)
// ============================================================================

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    outletId: uuid('outlet_id').notNull(),
    productId: uuid('product_id').notNull(),
    variationId: uuid('variation_id'),
    availableQty: integer('available_qty').notNull().default(0),
    reservedQty: integer('reserved_qty').notNull().default(0),
    lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
    trackStock: boolean('track_stock').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.branchId, t.outletId],
      foreignColumns: [outlets.tenantId, outlets.branchId, outlets.id],
      name: 'fk_inv_tenant_branch_outlet',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.outletId, t.productId],
      foreignColumns: [products.tenantId, products.outletId, products.id],
      name: 'fk_inv_tenant_outlet_product',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.productId, t.variationId],
      foreignColumns: [productVariations.tenantId, productVariations.productId, productVariations.id],
      name: 'fk_inv_tenant_product_var',
    }).onDelete('restrict'),
    unique('uq_inv_tenant_id').on(t.tenantId, t.id),
    uniqueIndex('uq_inv_product_base')
      .on(t.tenantId, t.outletId, t.productId)
      .where(sql`${t.variationId} IS NULL`),
    uniqueIndex('uq_inv_product_var')
      .on(t.tenantId, t.outletId, t.productId, t.variationId)
      .where(sql`${t.variationId} IS NOT NULL`),
    check('chk_inv_qty_nonneg', sql`${t.availableQty} >= 0 AND ${t.reservedQty} >= 0`),
  ]
);

// ============================================================================
// GROUP F: QR STATIONS, CUSTOMERS & LOYALTY (4 TABLES)
// ============================================================================

export const qrStations = pgTable(
  'qr_stations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    outletId: uuid('outlet_id').notNull(),
    label: text('label').notNull(),
    stationType: text('station_type').notNull(),
    capacityOrZone: text('capacity_or_zone').notNull().default(''),
    status: text('status').notNull().default('available'),
    tokenHash: text('token_hash').notNull(),
    tokenCiphertext: bytea('token_ciphertext').notNull(),
    tokenIv: bytea('token_iv').notNull(),
    tokenAuthTag: bytea('token_auth_tag').notNull(),
    tokenVersion: smallint('token_version').notNull().default(1),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.branchId, t.outletId],
      foreignColumns: [outlets.tenantId, outlets.branchId, outlets.id],
      name: 'fk_qr_tenant_branch_outlet',
    }).onDelete('restrict'),
    unique('uq_qr_tenant_id').on(t.tenantId, t.id),
    uniqueIndex('uq_qr_token_hash').on(t.tokenHash),
    check(
      'chk_qr_station_type',
      sql`${t.stationType} IN ('table','room','counter','pickup_zone','mesob_table')`
    ),
    check('chk_qr_status', sql`${t.status} IN ('available','occupied','reserved')`),
    index('idx_qr_tenant_outlet').on(t.tenantId, t.outletId),
  ]
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    fullName: text('full_name').notNull(),
    phoneE164: text('phone_e164').notNull(),
    preferredLanguage: text('preferred_language').notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('uq_customers_tenant_id').on(t.tenantId, t.id),
    uniqueIndex('uq_customers_tenant_phone')
      .on(t.tenantId, t.phoneE164)
      .where(sql`${t.deletedAt} IS NULL`),
    check('chk_customers_lang', sql`${t.preferredLanguage} IN ('en', 'am', 'om')`),
  ]
);

export const loyaltyAccounts = pgTable(
  'loyalty_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    stampsBalance: integer('stamps_balance').notNull().default(0),
    targetStamps: integer('target_stamps').notNull().default(8),
    favoriteProductId: uuid('favorite_product_id'),
    lifetimeSpentMinor: bigint('lifetime_spent_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('ETB'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'fk_la_tenant_customer',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.favoriteProductId],
      foreignColumns: [products.tenantId, products.id],
      name: 'fk_la_tenant_fav_product',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.currencyCode],
      foreignColumns: [tenants.id, tenants.operatingCurrency],
      name: 'fk_la_tenant_currency',
    }).onDelete('restrict'),
    unique('uq_la_tenant_id').on(t.tenantId, t.id),
    unique('uq_la_tenant_customer').on(t.tenantId, t.customerId),
    check('chk_la_stamps_nonneg', sql`${t.stampsBalance} >= 0 AND ${t.targetStamps} > 0`),
  ]
);

// ============================================================================
// GROUP G: ORDERS, PAYMENTS, SPECIAL REQUESTS, STOREFRONT & AUDITS
// ============================================================================

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    outletId: uuid('outlet_id').notNull(),
    qrStationId: uuid('qr_station_id'),
    customerId: uuid('customer_id'),
    orderNumber: text('order_number').notNull(),
    workflow: text('workflow').notNull(),
    status: text('status').notNull().default('new'),
    paymentProvider: text('payment_provider').notNull(),
    paymentStatus: text('payment_status').notNull().default('pending'),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('ETB'),
    subtotalMinor: bigint('subtotal_minor', { mode: 'bigint' }).notNull(),
    taxMinor: bigint('tax_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    discountMinor: bigint('discount_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    totalMinor: bigint('total_minor', { mode: 'bigint' }).notNull(),
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    customerNameSnapshot: text('customer_name_snapshot').notNull(),
    customerPhoneSnapshot: text('customer_phone_snapshot').notNull(),
    stationLabelSnapshot: text('station_label_snapshot'),
    pickupScheduledFor: text('pickup_scheduled_for'),
    idempotencyKey: text('idempotency_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.branchId, t.outletId],
      foreignColumns: [outlets.tenantId, outlets.branchId, outlets.id],
      name: 'fk_orders_tenant_branch_outlet',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.qrStationId],
      foreignColumns: [qrStations.tenantId, qrStations.id],
      name: 'fk_orders_tenant_qr',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'fk_orders_tenant_customer',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.currencyCode],
      foreignColumns: [tenants.id, tenants.operatingCurrency],
      name: 'fk_orders_tenant_currency',
    }).onDelete('restrict'),
    unique('uq_orders_tenant_id').on(t.tenantId, t.id),
    unique('uq_orders_tenant_number').on(t.tenantId, t.orderNumber),
    uniqueIndex('uq_orders_tenant_idemp')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    check(
      'chk_orders_workflow',
      sql`${t.workflow} IN ('dine_in','takeaway','delivery','room_service','pre_order')`
    ),
    check(
      'chk_orders_status',
      sql`${t.status} IN ('new','preparing','ready','completed','cancelled')`
    ),
    check(
      'chk_orders_payment_provider',
      sql`${t.paymentProvider} IN ('telebirr','cbe_birr','chapa','cash','room_charge')`
    ),
    check(
      'chk_orders_payment_status',
      sql`${t.paymentStatus} IN ('pending','paid','failed','refunded','charge_to_room')`
    ),
    check(
      'chk_orders_amounts_nonneg',
      sql`${t.subtotalMinor} >= 0 AND ${t.taxMinor} >= 0 AND ${t.discountMinor} >= 0 AND ${t.totalMinor} >= 0`
    ),
    index('idx_orders_tenant_outlet_status').on(t.tenantId, t.outletId, t.status, t.createdAt),
  ]
);

export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    inventoryItemId: uuid('inventory_item_id').notNull(),
    orderId: uuid('order_id').notNull(),
    quantity: integer('quantity').notNull(),
    status: text('status').notNull().default('active'), // active | consumed | released | expired
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.inventoryItemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
      name: 'fk_ir_tenant_inv_item',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: 'fk_ir_tenant_order',
    }).onDelete('restrict'),
    check('chk_ir_qty_pos', sql`${t.quantity} > 0`),
    check('chk_ir_status', sql`${t.status} IN ('active','consumed','released','expired')`),
    index('idx_ir_active_expiry')
      .on(t.status, t.expiresAt)
      .where(sql`${t.status} = 'active'`),
  ]
);

export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    inventoryItemId: uuid('inventory_item_id').notNull(),
    orderId: uuid('order_id'),
    movementType: text('movement_type').notNull(),
    availableDelta: integer('available_delta').notNull(),
    reservedDelta: integer('reserved_delta').notNull(),
    availableAfter: integer('available_after').notNull(),
    reservedAfter: integer('reserved_after').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.inventoryItemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
      name: 'fk_im_tenant_inv_item',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: 'fk_im_tenant_order',
    }).onDelete('restrict'),
    check(
      'chk_im_type',
      sql`${t.movementType} IN ('restock','reserve','deduct_reserved','deduct_direct','release','expire','adjustment')`
    ),
    index('idx_im_item_created').on(t.tenantId, t.inventoryItemId, t.createdAt),
  ]
);

export const loyaltyLedger = pgTable(
  'loyalty_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    loyaltyAccountId: uuid('loyalty_account_id').notNull(),
    orderId: uuid('order_id'),
    stampsDelta: integer('stamps_delta').notNull(),
    reason: text('reason').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.loyaltyAccountId],
      foreignColumns: [loyaltyAccounts.tenantId, loyaltyAccounts.id],
      name: 'fk_ll_tenant_account',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: 'fk_ll_tenant_order',
    }).onDelete('restrict'),
    index('idx_ll_account_created').on(t.tenantId, t.loyaltyAccountId, t.createdAt),
  ]
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    productId: uuid('product_id').notNull(),
    variationId: uuid('variation_id'),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    variationNameSnapshot: text('variation_name_snapshot'),
    quantity: integer('quantity').notNull(),
    unitBaseMinor: bigint('unit_base_minor', { mode: 'bigint' }).notNull(),
    variationDeltaMinor: bigint('variation_delta_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    modifiersTotalMinor: bigint('modifiers_total_minor', { mode: 'bigint' }).notNull().default(sql`0`),
    unitTotalMinor: bigint('unit_total_minor', { mode: 'bigint' }).notNull(),
    lineTotalMinor: bigint('line_total_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('ETB'),
    notes: text('notes'),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: 'fk_oi_tenant_order',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'fk_oi_tenant_product',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.productId, t.variationId],
      foreignColumns: [productVariations.tenantId, productVariations.productId, productVariations.id],
      name: 'fk_oi_tenant_product_var',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.currencyCode],
      foreignColumns: [tenants.id, tenants.operatingCurrency],
      name: 'fk_oi_tenant_currency',
    }).onDelete('restrict'),
    unique('uq_oi_tenant_id').on(t.tenantId, t.id),
    check('chk_oi_qty_pos', sql`${t.quantity} > 0`),
  ]
);

export const orderItemModifiers = pgTable(
  'order_item_modifiers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    orderItemId: uuid('order_item_id').notNull(),
    modifierGroupId: uuid('modifier_group_id').notNull(),
    modifierOptionId: uuid('modifier_option_id').notNull(),
    groupNameSnapshot: text('group_name_snapshot').notNull(),
    optionNameSnapshot: text('option_name_snapshot').notNull(),
    priceDeltaMinor: bigint('price_delta_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('ETB'),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.orderItemId],
      foreignColumns: [orderItems.tenantId, orderItems.id],
      name: 'fk_oim_tenant_order_item',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.modifierGroupId, t.modifierOptionId],
      foreignColumns: [
        modifierOptions.tenantId,
        modifierOptions.modifierGroupId,
        modifierOptions.id,
      ],
      name: 'fk_oim_tenant_group_opt',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.currencyCode],
      foreignColumns: [tenants.id, tenants.operatingCurrency],
      name: 'fk_oim_tenant_currency',
    }).onDelete('restrict'),
  ]
);

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    orderId: uuid('order_id').notNull(),
    provider: text('provider').notNull(),
    mode: text('mode').notNull().default('disabled'), // disabled | sandbox | live
    status: text('status').notNull().default('pending'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('ETB'),
    providerReference: text('provider_reference'),
    checkoutUrl: text('checkout_url'),
    idempotencyKey: text('idempotency_key').notNull(),
    initiatedAt: timestamp('initiated_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
      name: 'fk_pt_tenant_order',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.currencyCode],
      foreignColumns: [tenants.id, tenants.operatingCurrency],
      name: 'fk_pt_tenant_currency',
    }).onDelete('restrict'),
    unique('uq_pt_tenant_id').on(t.tenantId, t.id),
    unique('uq_pt_tenant_idemp').on(t.tenantId, t.idempotencyKey),
    check('chk_pt_mode', sql`${t.mode} IN ('disabled','sandbox','live')`),
    check(
      'chk_pt_status',
      sql`${t.status} IN ('pending','authorized','paid','failed','refunded','disabled')`
    ),
    index('idx_pt_provider_ref').on(t.provider, t.providerReference),
  ]
);

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    paymentTransactionId: uuid('payment_transaction_id').notNull(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    signatureVerified: boolean('signature_verified').notNull(),
    payloadJsonb: jsonb('payload_jsonb').$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.paymentTransactionId],
      foreignColumns: [paymentTransactions.tenantId, paymentTransactions.id],
      name: 'fk_pwe_tenant_tx',
    }).onDelete('restrict'),
    uniqueIndex('uq_pwe_provider_event').on(t.provider, t.providerEventId),
  ]
);

export const specialRequests = pgTable(
  'special_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    outletId: uuid('outlet_id').notNull(),
    customerId: uuid('customer_id'),
    kind: text('kind').notNull(),
    customerName: text('customer_name').notNull(),
    customerPhone: text('customer_phone').notNull(),
    requestedDateTime: text('requested_datetime').notNull(),
    partyOrSize: text('party_or_size').notNull(),
    details: text('details').notNull(),
    status: text('status').notNull().default('pending'),
    estimatedMinor: bigint('estimated_minor', { mode: 'bigint' }),
    currencyCode: char('currency_code', { length: 3 }).notNull().default('ETB'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.tenantId, t.branchId, t.outletId],
      foreignColumns: [outlets.tenantId, outlets.branchId, outlets.id],
      name: 'fk_sr_tenant_branch_outlet',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'fk_sr_tenant_customer',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.tenantId, t.currencyCode],
      foreignColumns: [tenants.id, tenants.operatingCurrency],
      name: 'fk_sr_tenant_currency',
    }).onDelete('restrict'),
    check(
      'chk_sr_kind',
      sql`${t.kind} IN ('table_reservation','custom_cake','coffee_ceremony','room_amenity')`
    ),
    check('chk_sr_status', sql`${t.status} IN ('confirmed','pending','in_production','cancelled')`),
  ]
);

export const websiteConfigs = pgTable(
  'website_configs',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    templateId: text('template_id').notNull(),
    accentHex: char('accent_hex', { length: 7 }).notNull(),
    typographyStyle: text('typography_style').notNull(),
    heroHeadlineJson: jsonb('hero_headline_json').$type<LocalizedJson>().notNull(),
    heroSubheadlineJson: jsonb('hero_subheadline_json').$type<LocalizedJson>().notNull(),
    heroImageUrl: text('hero_image_url').notNull(),
    visibleSections: text('visible_sections').array().notNull(),
    lowBandwidthDefault: boolean('low_bandwidth_default').notNull().default(false),
    defaultLanguage: text('default_language').notNull().default('en'),
    supportedLanguages: text('supported_languages').array().notNull(),
    acceptedPayments: text('accepted_payments').array().notNull(),
    whatsappOrderingEnabled: boolean('whatsapp_ordering_enabled').notNull().default(true),
    fastingModeActive: boolean('fasting_mode_active').notNull().default(false),
    pmsConfigJson: jsonb('pms_config_json')
      .$type<{
        enabled: boolean;
        providerName: string;
        roomValidationEndpoint: string;
        folioPostingEnabled: boolean;
        lastSyncedAt: string;
      }>()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('chk_wc_typo', sql`${t.typographyStyle} IN ('editorial','geometric','athletic')`),
    check('chk_wc_lang', sql`${t.defaultLanguage} IN ('en','am','om')`),
  ]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    metadataJsonb: jsonb('metadata_jsonb').$type<Record<string, unknown>>().notNull().default({}),
    ipAddress: inet('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_audit_tenant_created').on(t.tenantId, t.createdAt)]
);
