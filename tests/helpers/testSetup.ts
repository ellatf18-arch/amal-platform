import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import request from 'supertest';
import { createServerApp } from '../../server';
import { createAdminPool } from '../../src/db';
import * as schema from '../../src/db/schema';
import { CANONICAL_ROLES } from '../../src/db/seed';
import { devNotificationCapture } from '../../server/services/notificationAdapter';

export const testApp = createServerApp();

export async function resetTestDatabase(): Promise<void> {
  devNotificationCapture.clear();
  const adminPool = createAdminPool({ database: 'amal_test' });
  const adminDb = drizzle(adminPool, { schema });

  try {
    await adminDb.execute(
      sql`TRUNCATE TABLE
        audit_logs,
        platform_admin_impersonation_logs,
        payment_webhook_events,
        payment_transactions,
        loyalty_ledger,
        loyalty_accounts,
        order_item_modifiers,
        order_items,
        inventory_movements,
        inventory_reservations,
        inventory_items,
        special_requests,
        orders,
        qr_stations,
        product_modifier_groups,
        modifier_options,
        modifier_groups,
        product_variations,
        products,
        menu_categories,
        menus,
        outlets,
        branch_schedule_overrides,
        branch_operating_hours,
        branches,
        website_configs,
        customers,
        staff_invitation_outlet_scopes,
        staff_invitation_branch_scopes,
        staff_invitations,
        tenant_membership_outlets,
        tenant_membership_branches,
        tenant_memberships,
        tenants,
        password_reset_tokens,
        user_sessions,
        users
      RESTART IDENTITY CASCADE`
    );

    for (const role of CANONICAL_ROLES) {
      await adminDb
        .insert(schema.roles)
        .values({
          id: role.id,
          name: role.name,
          scopeLevel: role.scopeLevel,
          permissions: [...role.permissions],
        })
        .onConflictDoUpdate({
          target: schema.roles.id,
          set: {
            name: role.name,
            scopeLevel: role.scopeLevel,
            permissions: [...role.permissions],
          },
        });
    }
  } finally {
    await adminPool.end();
  }
}

export async function registerAndOnboardUser(params: {
  email: string;
  password: string;
  fullName: string;
  businessName: string;
  primaryType?:
    | 'restaurant'
    | 'coffee_house'
    | 'hotel'
    | 'juice_bar'
    | 'fast_food'
    | 'bakery'
    | 'traditional_ethiopian';
  planTier?: 'starter' | 'growth' | 'pro' | 'enterprise';
}) {
  const agent = request.agent(testApp);
  const regRes = await agent.post('/api/v1/auth/register').send({
    email: params.email,
    password: params.password,
    fullName: params.fullName,
  });
  if (regRes.status !== 201) {
    throw new Error(`Register failed (${regRes.status}): ${JSON.stringify(regRes.body)}`);
  }

  let csrfToken: string = regRes.body.csrfToken;
  const onboardRes = await agent
    .post('/api/v1/onboarding')
    .set('X-CSRF-Token', csrfToken)
    .send({
      businessName: params.businessName,
      city: 'Jimma',
      neighborhood: 'Merkato',
      phone: '+251911223344',
      whatsappNumber: '+251911223344',
      primaryType: params.primaryType || 'restaurant',
      secondaryTypes: [],
      supportedLanguages: ['en', 'am', 'om'],
      acceptedPayments: ['telebirr', 'chapa', 'cash'],
      enableFastingMode: true,
      enableLowBandwidthDefault: false,
      planTier: params.planTier || 'pro',
    });

  if (onboardRes.status !== 201) {
    throw new Error(`Onboarding failed (${onboardRes.status}): ${JSON.stringify(onboardRes.body)}`);
  }

  return {
    agent,
    csrfToken,
    user: regRes.body.user as { id: string; email: string; fullName: string },
    workspace: onboardRes.body.workspace,
  };
}
