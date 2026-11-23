import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { decryptQrToken, encryptQrToken } from '../server/utils/cryptoAndMoney';
import { registerAndOnboardUser, resetTestDatabase, testApp } from './helpers/testSetup';

describe('QR Station Token Security, Encryption & Rotation', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('encrypts/decrypts tokens via AES-256-GCM and invalidates old tokens immediately upon rotation', async () => {
    const rawSample = 'csprng_qr_token_sample_123456';
    const enc = encryptQrToken(rawSample);
    expect(decryptQrToken(enc)).toBe(rawSample);

    const owner = await registerAndOnboardUser({
      email: 'qr-owner@amal.test',
      password: 'Password123!',
      fullName: 'QR Owner',
      businessName: 'QR Cafe',
      primaryType: 'coffee_house',
    });

    const createRes = await owner.agent
      .post('/api/v1/tenants/current/qr-stations')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        label: 'Window Table 9',
        stationType: 'table',
        outletId: owner.workspace.outlets[0].id,
        capacityOrZone: '4 Seats · Patio',
      });
    expect(createRes.status).toBe(201);
    const stationId = createRes.body.station.id as string;
    const token1 = createRes.body.station.scanToken as string;
    expect(token1.length).toBeGreaterThanOrEqual(20);

    // Public scan with token1 resolves matchedStation
    const scan1 = await request(testApp).get(
      `/api/v1/public/storefronts/${owner.workspace.slug}?station=${encodeURIComponent(token1)}`
    );
    expect(scan1.status).toBe(200);
    expect(scan1.body.matchedStation?.id).toBe(stationId);

    // Rotate station token
    const rotateRes = await owner.agent
      .post(`/api/v1/tenants/current/qr-stations/${stationId}/rotate`)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({});
    expect(rotateRes.status).toBe(200);
    const token2 = rotateRes.body.scanToken as string;
    expect(token2).not.toBe(token1);

    // Old token1 no longer matches station
    const scanOld = await request(testApp).get(
      `/api/v1/public/storefronts/${owner.workspace.slug}?station=${encodeURIComponent(token1)}`
    );
    expect(scanOld.status).toBe(200);
    expect(scanOld.body.matchedStation).toBeNull();

    // New token2 resolves station
    const scanNew = await request(testApp).get(
      `/api/v1/public/storefronts/${owner.workspace.slug}?station=${encodeURIComponent(token2)}`
    );
    expect(scanNew.status).toBe(200);
    expect(scanNew.body.matchedStation?.id).toBe(stationId);
  });
});
