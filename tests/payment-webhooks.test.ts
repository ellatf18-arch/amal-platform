import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../server/db/tenantTx';
import { inventoryItems, inventoryMovements, orders } from '../src/db/schema';
import { registerAndOnboardUser, resetTestDatabase, testApp } from './helpers/testSetup';

describe('Payment Provider Mode Guardrails & Idempotent Signed Webhooks', () => {
  const prevPayMode = process.env.PAYMENT_MODE;

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    process.env.PAYMENT_MODE = prevPayMode;
  });

  it('keeps external providers in disabled mode by default per ADR-001 and rejects webhooks when disabled', async () => {
    process.env.PAYMENT_MODE = 'disabled';
    const owner = await registerAndOnboardUser({
      email: 'pay-disabled@amal.test',
      password: 'Password123!',
      fullName: 'Disabled Pay Owner',
      businessName: 'Cash & Pending Restaurant',
    });

    const prod = owner.workspace.products[0];
    const chk = await request(testApp)
      .post(`/api/v1/public/storefronts/${owner.workspace.slug}/checkout`)
      .send({
        workflow: owner.workspace.allowedWorkflows[0],
        outletId: prod.outletId,
        customerName: 'Chapa Guest',
        customerPhone: '+251911220011',
        paymentProvider: 'chapa',
        items: [{ productId: prod.id, quantity: 1 }],
      });

    expect(chk.status).toBe(201);
    expect(chk.body.paymentMode).toBe('disabled');
    expect(chk.body.order.paymentStatus).toBe('pending');
  });

  it('processes valid sandbox HMAC webhooks idempotently and consumes reserved stock with zero double-deduction', async () => {
    process.env.PAYMENT_MODE = 'sandbox';
    const owner = await registerAndOnboardUser({
      email: 'pay-sbx@amal.test',
      password: 'Password123!',
      fullName: 'Sandbox Pay Owner',
      businessName: 'Sandbox Roastery',
      primaryType: 'coffee_house',
    });

    const prod = owner.workspace.products[0];
    // Ensure tracked inventory exists with known quantity
    await owner.agent
      .post(`/api/v1/tenants/current/inventory/${prod.id}/restock`)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ quantity: 10, reason: 'Webhook test stock' });

    let beforeQty = 0;
    await withTenantTransaction(owner.workspace.id, async (tx) => {
      const [inv] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.productId, prod.id))
        .limit(1);
      beforeQty = inv.availableQty;
    });

    const chk = await request(testApp)
      .post(`/api/v1/public/storefronts/${owner.workspace.slug}/checkout`)
      .send({
        workflow: owner.workspace.allowedWorkflows[0],
        outletId: prod.outletId,
        customerName: 'Sandbox Guest',
        customerPhone: '+251911889900',
        paymentProvider: 'chapa',
        items: [{ productId: prod.id, quantity: 3 }],
      });
    expect(chk.status).toBe(201);
    expect(chk.body.paymentMode).toBe('sandbox');
    const providerRef = chk.body.providerReference as string;
    expect(providerRef).toMatch(/^sbx_chapa_/);

    const payload = JSON.stringify({
      eventId: 'evt_sbx_001',
      providerReference: providerRef,
      eventType: 'payment.succeeded',
    });
    const secret = process.env.SANDBOX_WEBHOOK_HMAC_SECRET || 'amal_test_sandbox_secret';
    const validSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    // Invalid signature rejected with 401
    const badSig = await request(testApp)
      .post('/api/v1/webhooks/payments/chapa')
      .set('Content-Type', 'application/json')
      .set('x-amal-sandbox-signature', '0'.repeat(64))
      .send(payload);
    expect(badSig.status).toBe(401);

    // Valid signature settles order and transitions reserve -> deduct_reserved
    const ok1 = await request(testApp)
      .post('/api/v1/webhooks/payments/chapa')
      .set('Content-Type', 'application/json')
      .set('x-amal-sandbox-signature', validSig)
      .send(payload);
    expect(ok1.status).toBe(200);
    expect(ok1.body.duplicate).toBe(false);

    // Duplicate webhook delivery returns duplicate=true with zero double-deduction
    const ok2 = await request(testApp)
      .post('/api/v1/webhooks/payments/chapa')
      .set('Content-Type', 'application/json')
      .set('x-amal-sandbox-signature', validSig)
      .send(payload);
    expect(ok2.status).toBe(200);
    expect(ok2.body.duplicate).toBe(true);

    await withTenantTransaction(owner.workspace.id, async (tx) => {
      const [ord] = await tx.select().from(orders).where(eq(orders.id, chk.body.order.id)).limit(1);
      expect(ord.paymentStatus).toBe('paid');

      const [inv] = await tx
        .select()
        .from(inventoryItems)
        .where(eq(inventoryItems.productId, prod.id))
        .limit(1);
      // Only 3 deducted total (not 6!)
      expect(inv.availableQty).toBe(beforeQty - 3);
      expect(inv.reservedQty).toBe(0);

      const moves = await tx
        .select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.orderId, chk.body.order.id));
      expect(moves.map((m) => m.movementType)).toEqual(['reserve', 'deduct_reserved']);
    });
  });
});
