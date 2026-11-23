import { beforeEach, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../server/db/tenantTx';
import {
  branches,
  inventoryItems,
  orders,
  outlets,
  qrStations,
  tenantMembershipOutlets,
  tenantMemberships,
} from '../src/db/schema';
import { generateOpaqueToken, sha256Hex } from '../server/utils/cryptoAndMoney';
import { registerAndOnboardUser, resetTestDatabase } from './helpers/testSetup';

describe('Composite Branch-Outlet Foreign Key Consistency', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('rejects cross-branch outlet references in orders, qr_stations, inventory_items, and membership scopes', async () => {
    const { workspace, user } = await registerAndOnboardUser({
      email: 'branch-fk@amal.test',
      password: 'Password123!',
      fullName: 'FK Tester',
      businessName: 'Multi Branch Grill',
    });

    const tenantId = workspace.id as string;
    const branch1Id = workspace.branches[0].id as string;
    const outlet1Id = workspace.outlets[0].id as string;
    const product1Id = workspace.products[0].id as string;

    const { branch2Id, outlet2Id, membershipId } = await withTenantTransaction(
      tenantId,
      async (tx) => {
        const [branch2] = await tx
          .insert(branches)
          .values({
            tenantId,
            name: 'Bole Branch 2',
            city: 'Addis Ababa',
            neighborhood: 'Bole',
            phone: '+251911998877',
            whatsappNumber: '+251911998877',
            displayHours: '08:00 - 22:00',
          })
          .returning();

        const [outlet2] = await tx
          .insert(outlets)
          .values({
            tenantId,
            branchId: branch2.id,
            nameJson: { en: 'Bole Express Outlet' },
            outletKind: 'dining_room',
            description: 'Branch 2 outlet',
          })
          .returning();

        const [membership] = await tx.select().from(tenantMemberships).limit(1);
        expect(membership.userId).toBe(user.id);

        return { branch2Id: branch2.id, outlet2Id: outlet2.id, membershipId: membership.id };
      }
    );

    // 1. Order referencing Branch 1 + Outlet 2 (belongs to Branch 2) MUST be rejected by composite FK
    await expect(
      withTenantTransaction(tenantId, async (tx) => {
        await tx.insert(orders).values({
          tenantId,
          branchId: branch1Id,
          outletId: outlet2Id,
          orderNumber: 'AM-FK01',
          workflow: 'dine_in',
          status: 'new',
          paymentProvider: 'cash',
          paymentStatus: 'pending',
          currencyCode: 'ETB',
          subtotalMinor: 10000n,
          taxMinor: 1500n,
          discountMinor: 0n,
          totalMinor: 11500n,
          taxRateBps: 1500,
          customerNameSnapshot: 'Guest',
          customerPhoneSnapshot: '+251900000001',
        });
      })
    ).rejects.toThrow();

    // 2. QR Station referencing Branch 1 + Outlet 2 MUST be rejected
    const tok = generateOpaqueToken(16);
    await expect(
      withTenantTransaction(tenantId, async (tx) => {
        await tx.insert(qrStations).values({
          tenantId,
          branchId: branch1Id,
          outletId: outlet2Id,
          label: 'Mismatched Table',
          stationType: 'table',
          capacityOrZone: 'Zone A',
          status: 'available',
          tokenHash: sha256Hex(tok),
          tokenCiphertext: Buffer.from('aa', 'hex'),
          tokenIv: Buffer.from('bbbbbbbbbbbb', 'hex'),
          tokenAuthTag: Buffer.from('cccccccccccccccc', 'hex'),
        });
      })
    ).rejects.toThrow();

    // 3. Inventory Item referencing Branch 1 + Outlet 2 MUST be rejected
    await expect(
      withTenantTransaction(tenantId, async (tx) => {
        await tx.insert(inventoryItems).values({
          tenantId,
          branchId: branch1Id,
          outletId: outlet2Id,
          productId: product1Id,
          availableQty: 10,
          reservedQty: 0,
          trackStock: true,
        });
      })
    ).rejects.toThrow();

    // 4. Tenant Membership Outlet Scope referencing Branch 2 + Outlet 1 MUST be rejected
    await expect(
      withTenantTransaction(tenantId, async (tx) => {
        await tx.insert(tenantMembershipOutlets).values({
          tenantId,
          membershipId,
          branchId: branch2Id,
          outletId: outlet1Id,
        });
      })
    ).rejects.toThrow();
  });
});
