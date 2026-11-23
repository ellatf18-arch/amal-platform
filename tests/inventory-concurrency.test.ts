import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../server/db/tenantTx';
import { inventoryItems, inventoryMovements, inventoryReservations } from '../src/db/schema';
import { registerAndOnboardUser, resetTestDatabase, testApp } from './helpers/testSetup';

describe('Inventory Row Locking, Reservation Expiry Worker & Zero Double-Deduction', () => {
  const prevPayMode = process.env.PAYMENT_MODE;

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    process.env.PAYMENT_MODE = prevPayMode;
  });

  it('prevents overselling under concurrent Promise.all checkout races on the last unit in stock', async () => {
    const owner = await registerAndOnboardUser({
      email: 'race@amal.test',
      password: 'Password123!',
      fullName: 'Race Owner',
      businessName: 'Limited Bakery',
      primaryType: 'bakery',
    });

    // Add tracked product with stock = 1
    const addRes = await owner.agent
      .post('/api/v1/tenants/current/products')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        categoryId: owner.workspace.categories[0].id,
        nameEn: 'Last Honey Cake',
        basePriceEtb: 450,
      });
    expect(addRes.status).toBe(201);
    const prodId = addRes.body.productId as string;

    const restockRes = await owner.agent
      .post(`/api/v1/tenants/current/inventory/${prodId}/restock`)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ quantity: 1, reason: 'Initial single batch' });
    expect(restockRes.status).toBe(200);
    expect(restockRes.body.availableQty).toBe(1);

    const outletId = owner.workspace.categories[0].outletId as string;

    // Two concurrent checkout requests for qty=1 of the last item
    const [r1, r2] = await Promise.all([
      request(testApp)
        .post(`/api/v1/public/storefronts/${owner.workspace.slug}/checkout`)
        .send({
          workflow: owner.workspace.allowedWorkflows[0],
          outletId,
          customerName: 'Buyer One',
          customerPhone: '+251911000001',
          paymentProvider: 'cash',
          items: [{ productId: prodId, quantity: 1 }],
        }),
      request(testApp)
        .post(`/api/v1/public/storefronts/${owner.workspace.slug}/checkout`)
        .send({
          workflow: owner.workspace.allowedWorkflows[0],
          outletId,
          customerName: 'Buyer Two',
          customerPhone: '+251911000002',
          paymentProvider: 'cash',
          items: [{ productId: prodId, quantity: 1 }],
        }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    // Verify availableQty >= 0 (never negative)
    await withTenantTransaction(owner.workspace.id, async (tx) => {
      const [inv] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.productId, prodId))
        .limit(1);
      expect(inv.availableQty).toBe(0);
      expect(inv.reservedQty).toBe(0);
    });
  });

  it('expires stale online payment reservations atomically via FOR UPDATE SKIP LOCKED and restores availableQty', async () => {
    process.env.PAYMENT_MODE = 'sandbox';
    const owner = await registerAndOnboardUser({
      email: 'expire@amal.test',
      password: 'Password123!',
      fullName: 'Expiry Owner',
      businessName: 'Expire Grill',
      primaryType: 'restaurant',
    });

    const prod = owner.workspace.products[0];
    await owner.agent
      .post(`/api/v1/tenants/current/inventory/${prod.id}/restock`)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ quantity: 5, reason: 'Seed 5' });

    const chk = await request(testApp)
      .post(`/api/v1/public/storefronts/${owner.workspace.slug}/checkout`)
      .send({
        workflow: owner.workspace.allowedWorkflows[0],
        outletId: prod.outletId,
        customerName: 'Pending Online Guest',
        customerPhone: '+251911777777',
        paymentProvider: 'telebirr',
        items: [{ productId: prod.id, quantity: 2 }],
      });
    expect(chk.status).toBe(201);

    // Check availableQty moved from baseline -> baseline - 2, reservedQty = 2
    let baselineAfterReserve = 0;
    await withTenantTransaction(owner.workspace.id, async (tx) => {
      const [inv] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.productId, prod.id))
        .limit(1);
      expect(inv.reservedQty).toBe(2);
      baselineAfterReserve = inv.availableQty;

      // Force reservation expiry timestamp into the past
      await tx.execute(
        sql`UPDATE inventory_reservations SET expires_at = NOW() - INTERVAL '5 minutes' WHERE order_id = ${chk.body.order.id}::uuid`
      );
    });

    // Unauthorized worker call without secret rejected
    const unauth = await request(testApp).post('/api/v1/internal/workers/expire-reservations');
    expect(unauth.status).toBe(401);

    // Authorized worker expires reservation & restores stock
    const workerRes = await request(testApp)
      .post('/api/v1/internal/workers/expire-reservations')
      .set('X-Worker-Secret', 'amal_dev_worker_secret');
    expect(workerRes.status).toBe(200);
    expect(workerRes.body.expiredCount).toBe(1);

    await withTenantTransaction(owner.workspace.id, async (tx) => {
      const [inv] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.productId, prod.id))
        .limit(1);
      expect(inv.availableQty).toBe(baselineAfterReserve + 2);
      expect(inv.reservedQty).toBe(0);

      const [resRow] = await tx
        .select()
        .from(inventoryReservations)
        .where(eq(inventoryReservations.orderId, chk.body.order.id))
        .limit(1);
      expect(resRow.status).toBe('expired');

      const moves = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.orderId, chk.body.order.id));
      expect(moves.map((m) => m.movementType)).toEqual(['reserve', 'expire']);
    });
  });
});
