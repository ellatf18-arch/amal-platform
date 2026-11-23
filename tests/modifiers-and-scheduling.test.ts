import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getLocalTimeAndDayInTimezone,
  isWithinTimeWindow,
} from '../server/services/workspaceMapper';
import { registerAndOnboardUser, resetTestDatabase, testApp } from './helpers/testSetup';

describe('Product Modifiers, Midnight-Crossing Schedules & IANA Timezones', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('correctly evaluates midnight-crossing operating hours and Africa/Addis_Ababa timezones', () => {
    // 18:00 -> 02:00 overnight shift
    expect(isWithinTimeWindow('23:30:00', '18:00:00', '02:00:00', true)).toBe(true);
    expect(isWithinTimeWindow('01:15:00', '18:00:00', '02:00:00', true)).toBe(true);
    expect(isWithinTimeWindow('14:00:00', '18:00:00', '02:00:00', true)).toBe(false);

    // Same-day window 08:00 -> 20:00
    expect(isWithinTimeWindow('12:00:00', '08:00:00', '20:00:00', false)).toBe(true);
    expect(isWithinTimeWindow('21:00:00', '08:00:00', '20:00:00', false)).toBe(false);

    const addis = getLocalTimeAndDayInTimezone('Africa/Addis_Ababa', new Date('2026-03-01T12:00:00Z'));
    expect(addis.timeStr).toBe('15:00:00'); // UTC+3 year-round in Ethiopia
    expect(addis.dateStr).toBe('2026-03-01');
  });

  it('prices variations + modifiers server-side on checkout', async () => {
    const owner = await registerAndOnboardUser({
      email: 'mods@amal.test',
      password: 'Password123!',
      fullName: 'Coffee Owner',
      businessName: 'Kaffa Roasters',
      primaryType: 'coffee_house',
    });

    const prodWithExtras = owner.workspace.products.find(
      (p: any) => p.variations.length > 0 && p.modifierGroups.length > 0
    );
    expect(prodWithExtras).toBeDefined();

    const variation = prodWithExtras.variations[prodWithExtras.variations.length - 1];
    const modOpt = prodWithExtras.modifierGroups[0].options.find((o: any) => o.available);
    expect(modOpt).toBeDefined();

    const chkRes = await request(testApp)
      .post(`/api/v1/public/storefronts/${owner.workspace.slug}/checkout`)
      .send({
        workflow: owner.workspace.allowedWorkflows[0],
        outletId: prodWithExtras.outletId,
        customerName: 'Abebe',
        customerPhone: '+251911001122',
        paymentProvider: 'cash',
        items: [
          {
            productId: prodWithExtras.id,
            variationId: variation.id,
            selectedModifierOptionIds: [modOpt.id],
            quantity: 2,
          },
        ],
      });

    expect(chkRes.status).toBe(201);
    const expectedUnit = prodWithExtras.basePriceEtb + variation.priceDeltaEtb + modOpt.priceDeltaEtb;
    const expectedSubtotal = expectedUnit * 2;
    const taxFactor = 1 + (owner.workspace.defaultTaxRateBps || 0) / 10000;
    const expectedTotal = Math.round(expectedSubtotal * taxFactor * 100) / 100;
    expect(chkRes.body.order.totalEtb).toBeCloseTo(expectedTotal, 2);
  });
});
