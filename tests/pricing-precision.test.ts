import { eq } from 'drizzle-orm';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../server/db/tenantTx';
import { calculateTaxMinorHalfUp, etbToMinor, minorToEtb } from '../server/utils/cryptoAndMoney';
import { tenants } from '../src/db/schema';
import { registerAndOnboardUser, resetTestDatabase, testApp } from './helpers/testSetup';

describe('Server-Authoritative Fixed-Point BigInt ETB Santim Pricing', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('computes half-up 15% VAT in integer santim without floating-point drift', () => {
    // 100.00 ETB = 10000 santim -> 1500 santim VAT
    expect(calculateTaxMinorHalfUp(10000n, 1500)).toBe(1500n);
    // 33.35 ETB = 3335 santim * 15% = 500.25 -> 500 santim
    expect(calculateTaxMinorHalfUp(3335n, 1500)).toBe(500n);
    // 33.37 ETB = 3337 santim * 15% = 500.55 -> half-up 501 santim
    expect(calculateTaxMinorHalfUp(3337n, 1500)).toBe(501n);
    // Boundary exact .50 rounds up: 10 santim * 5% = 0.5 -> 1n
    expect(calculateTaxMinorHalfUp(10n, 500)).toBe(1n);

    expect(etbToMinor(199.95)).toBe(19995n);
    expect(minorToEtb(19995n)).toBe(199.95);
  });

  it('ignores any tampered client price/total fields during public checkout', async () => {
    const owner = await registerAndOnboardUser({
      email: 'price-check@amal.test',
      password: 'Password123!',
      fullName: 'Price Owner',
      businessName: 'Exact Price Restaurant',
      primaryType: 'restaurant',
    });

    await withTenantTransaction(owner.workspace.id, async (tx) => {
      await tx
        .update(tenants)
        .set({ vatRegistered: true, defaultTaxRateBps: 1500 })
        .where(eq(tenants.id, owner.workspace.id));
    });

    const prod = owner.workspace.products[0];
    const tamperedPayload = {
      workflow: owner.workspace.allowedWorkflows[0],
      outletId: prod.outletId,
      customerName: 'Tamper Tester',
      customerPhone: '+251911334455',
      paymentProvider: 'cash',
      // Attempt client-side total tampering
      totalEtb: 0.01,
      subtotalEtb: 0.01,
      items: [
        {
          productId: prod.id,
          quantity: 1,
          unitPriceEtb: 0.01,
        },
      ],
    };

    const res = await request(testApp)
      .post(`/api/v1/public/storefronts/${owner.workspace.slug}/checkout`)
      .send(tamperedPayload);

    expect(res.status).toBe(201);
    const expectedMinor =
      etbToMinor(prod.basePriceEtb) + calculateTaxMinorHalfUp(etbToMinor(prod.basePriceEtb), 1500);
    expect(BigInt(res.body.order.totalMinor)).toBe(expectedMinor);
    expect(res.body.order.totalEtb).toBe(minorToEtb(expectedMinor));
  });
});
