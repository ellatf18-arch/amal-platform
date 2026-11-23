-- AMAL PostgreSQL Row-Level Security, Append-Only Hardening & Public Lookup Function
-- Executed as database schema owner (amal_admin) after Drizzle schema sync.

-- 1. Grant runtime privileges to non-superuser NOBYPASSRLS role (amal_app)
GRANT USAGE ON SCHEMA public TO amal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amal_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO amal_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO amal_app;

-- 2. Enforce append-only immutability on financial/security logs and read-only RBAC catalog for amal_app
REVOKE INSERT, UPDATE, DELETE ON TABLE roles FROM amal_app;
REVOKE UPDATE, DELETE ON TABLE audit_logs FROM amal_app;
REVOKE UPDATE, DELETE ON TABLE inventory_movements FROM amal_app;
REVOKE UPDATE, DELETE ON TABLE loyalty_ledger FROM amal_app;
REVOKE UPDATE, DELETE ON TABLE platform_admin_impersonation_logs FROM amal_app;
REVOKE DELETE ON TABLE payment_webhook_events FROM amal_app;

-- 3. Enable & FORCE Row-Level Security on root `tenants` table (uses `id`)
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_root_isolation_policy ON tenants;
CREATE POLICY tenant_root_isolation_policy ON tenants
  USING (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 4. Enable & FORCE Row-Level Security on all 32 tenant-owned child tables (uses `tenant_id`)
DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tenant_memberships',
    'tenant_membership_branches',
    'tenant_membership_outlets',
    'staff_invitations',
    'staff_invitation_branch_scopes',
    'staff_invitation_outlet_scopes',
    'branches',
    'branch_operating_hours',
    'branch_schedule_overrides',
    'outlets',
    'menus',
    'menu_categories',
    'products',
    'product_variations',
    'modifier_groups',
    'modifier_options',
    'product_modifier_groups',
    'inventory_items',
    'inventory_reservations',
    'inventory_movements',
    'qr_stations',
    'customers',
    'loyalty_accounts',
    'loyalty_ledger',
    'orders',
    'order_items',
    'order_item_modifiers',
    'payment_transactions',
    'payment_webhook_events',
    'special_requests',
    'website_configs',
    'audit_logs'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_policy ON %I
       USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)
       WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)',
      tbl
    );
  END LOOP;
END $$;

-- 5. SECURITY DEFINER narrow lookup for unauthenticated public storefront / QR resolution
CREATE OR REPLACE FUNCTION resolve_public_storefront_context(
  p_slug text,
  p_station_token_hash text DEFAULT NULL
)
RETURNS TABLE (
  tenant_id uuid,
  slug text,
  station_id uuid,
  outlet_id uuid,
  branch_id uuid,
  station_label text,
  station_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_id uuid;
  v_slug text;
BEGIN
  SELECT t.id, t.slug
  INTO v_tenant_id, v_slug
  FROM public.tenants t
  WHERE t.slug = p_slug
    AND t.deleted_at IS NULL
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RETURN;
  END IF;

  IF p_station_token_hash IS NOT NULL AND length(p_station_token_hash) > 0 THEN
    RETURN QUERY
    SELECT
      v_tenant_id,
      v_slug,
      q.id,
      q.outlet_id,
      q.branch_id,
      q.label,
      q.station_type
    FROM public.qr_stations q
    WHERE q.tenant_id = v_tenant_id
      AND q.token_hash = p_station_token_hash
      AND q.deleted_at IS NULL
    LIMIT 1;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    v_tenant_id,
    v_slug,
    NULL::uuid,
    NULL::uuid,
    NULL::uuid,
    NULL::text,
    NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION resolve_public_storefront_context(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_public_storefront_context(text, text) TO amal_app;

-- 6. SECURITY DEFINER helper to resolve user's active memberships during login/session load
CREATE OR REPLACE FUNCTION list_user_tenant_memberships(p_user_id uuid)
RETURNS TABLE (
  tenant_id uuid,
  slug text,
  business_name text,
  primary_business_type text,
  role_id text,
  scope_type text,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    tm.tenant_id,
    t.slug,
    t.business_name,
    t.primary_business_type,
    tm.role_id,
    tm.scope_type,
    tm.status
  FROM public.tenant_memberships tm
  JOIN public.tenants t ON t.id = tm.tenant_id
  WHERE tm.user_id = p_user_id
    AND tm.status = 'active'
    AND t.deleted_at IS NULL
  ORDER BY tm.created_at ASC;
$$;

REVOKE ALL ON FUNCTION list_user_tenant_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_user_tenant_memberships(uuid) TO amal_app;

-- 7. SECURITY DEFINER helper for platform admin audited impersonation / tenant directory (counts only, no PII)
CREATE OR REPLACE FUNCTION list_platform_tenant_summaries()
RETURNS TABLE (
  tenant_id uuid,
  slug text,
  business_name text,
  primary_business_type text,
  plan_tier text,
  subscription_status text,
  vat_registered boolean,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    t.id AS tenant_id,
    t.slug,
    t.business_name,
    t.primary_business_type,
    t.plan_tier,
    t.subscription_status,
    t.vat_registered,
    t.created_at
  FROM public.tenants t
  WHERE t.deleted_at IS NULL
  ORDER BY t.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_platform_tenant_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_platform_tenant_summaries() TO amal_app;

-- 8. SECURITY DEFINER helper to resolve staff invitation by token_hash cleanly under RLS
CREATE OR REPLACE FUNCTION resolve_staff_invitation_by_hash(p_token_hash text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  email_normalized text,
  role_id text,
  scope_type text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT si.id, si.tenant_id, si.email_normalized, si.role_id, si.scope_type
  FROM public.staff_invitations si
  WHERE si.token_hash = p_token_hash
    AND si.accepted_at IS NULL
    AND si.revoked_at IS NULL
    AND si.expires_at > NOW()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_staff_invitation_by_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_staff_invitation_by_hash(text) TO amal_app;

-- 9. SECURITY DEFINER helper for webhook providerReference -> tenant_id lookup
CREATE OR REPLACE FUNCTION resolve_payment_tx_by_ref(p_provider text, p_provider_ref text)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  order_id uuid,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pt.id, pt.tenant_id, pt.order_id, pt.status
  FROM public.payment_transactions pt
  WHERE pt.provider = p_provider
    AND pt.provider_reference = p_provider_ref
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_payment_tx_by_ref(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_payment_tx_by_ref(text, text) TO amal_app;

-- 10. SECURITY DEFINER helper for worker to discover tenants with expired active reservations
CREATE OR REPLACE FUNCTION list_tenants_with_expired_reservations()
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT ir.tenant_id
  FROM public.inventory_reservations ir
  WHERE ir.status = 'active'
    AND ir.expires_at <= NOW();
$$;

REVOKE ALL ON FUNCTION list_tenants_with_expired_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_tenants_with_expired_reservations() TO amal_app;
