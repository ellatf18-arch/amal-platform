import { sql } from 'drizzle-orm';
import { db } from '../../src/db';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

declare const tenantBrand: unique symbol;
export type TenantScopedTx = DrizzleTx & { readonly [tenantBrand]: string };

export function assertValidUuid(value: string, label = 'UUID'): string {
  if (!UUID_REGEX.test(value)) {
    throw new Error(`Invalid ${label} format`);
  }
  return value;
}

/**
 * Executes database work inside a transaction bound to a single tenant_id via
 * transaction-local `set_config('app.current_tenant_id', $1, true)`.
 * Because `is_local = true`, PostgreSQL automatically resets the setting when the
 * transaction commits or rolls back, preventing pooled connection state leaks.
 */
export async function withTenantTransaction<T>(
  tenantId: string,
  fn: (tx: TenantScopedTx) => Promise<T>
): Promise<T> {
  const safeTenantId = assertValidUuid(tenantId, 'tenantId');
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${safeTenantId}, true)`
    );
    return fn(tx as TenantScopedTx);
  });
}

export interface ResolvedStorefrontTarget {
  tenantId: string;
  slug: string;
  stationId: string | null;
  outletId: string | null;
  branchId: string | null;
  stationLabel: string | null;
  stationType: string | null;
}

/**
 * Resolves a public storefront slug (and optional QR station token hash) using a
 * narrow SECURITY DEFINER function before entering a tenant-scoped RLS transaction.
 */
export async function resolvePublicStorefrontTarget(
  slug: string,
  stationTokenHash?: string | null
): Promise<ResolvedStorefrontTarget | null> {
  const result = await db.execute(
    sql`SELECT tenant_id, slug, station_id, outlet_id, branch_id, station_label, station_type
        FROM resolve_public_storefront_context(${slug}, ${stationTokenHash ?? null})`
  );
  const row = result.rows[0] as
    | {
        tenant_id: string;
        slug: string;
        station_id: string | null;
        outlet_id: string | null;
        branch_id: string | null;
        station_label: string | null;
        station_type: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    slug: row.slug,
    stationId: row.station_id,
    outletId: row.outlet_id,
    branchId: row.branch_id,
    stationLabel: row.station_label,
    stationType: row.station_type,
  };
}
