import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { devNotificationCapture } from '../server/services/notificationAdapter';
import { resetTestDatabase, testApp } from './helpers/testSetup';

describe('Authentication, Rotating Sessions, CSRF & Password Reset Security', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('registers with Argon2id, enforces CSRF headers, rotates refresh cookies, and revokes family on token reuse', async () => {
    const regRes = await request(testApp).post('/api/v1/auth/register').send({
      email: 'sec@amal.test',
      password: 'StrongPassword2026!',
      fullName: 'Security Tester',
    });
    expect(regRes.status).toBe(201);
    const csrf1 = regRes.body.csrfToken as string;
    const cookie1 = (regRes.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    // Wrong password rejected
    const badLogin = await request(testApp).post('/api/v1/auth/login').send({
      email: 'sec@amal.test',
      password: 'WrongPassword!',
    });
    expect(badLogin.status).toBe(401);

    // State-changing mutation without X-CSRF-Token rejected with 403
    const noCsrf = await request(testApp)
      .post('/api/v1/onboarding')
      .set('Cookie', cookie1)
      .send({
        businessName: 'No CSRF Cafe',
        city: 'Jimma',
        neighborhood: 'Merkato',
        phone: '+251911223344',
        whatsappNumber: '+251911223344',
        primaryType: 'coffee_house',
        supportedLanguages: ['en'],
        acceptedPayments: ['cash'],
      });
    expect(noCsrf.status).toBe(403);

    // Valid CSRF token succeeds
    const onboardOk = await request(testApp)
      .post('/api/v1/onboarding')
      .set('Cookie', cookie1)
      .set('X-CSRF-Token', csrf1)
      .send({
        businessName: 'Verified Cafe',
        city: 'Jimma',
        neighborhood: 'Merkato',
        phone: '+251911223344',
        whatsappNumber: '+251911223344',
        primaryType: 'coffee_house',
        supportedLanguages: ['en'],
        acceptedPayments: ['cash'],
      });
    expect(onboardOk.status).toBe(201);

    // Rotate session token cleanly
    const refreshRes = await request(testApp).post('/api/v1/auth/refresh').set('Cookie', cookie1);
    expect(refreshRes.status).toBe(200);
    const cookie2 = (refreshRes.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    expect(cookie2).not.toBe(cookie1);

    // Session 2 works
    const me2 = await request(testApp).get('/api/v1/auth/me').set('Cookie', cookie2);
    expect(me2.status).toBe(200);

    // Replaying old/replaced cookie1 triggers family-wide theft revocation!
    const replayRes = await request(testApp).post('/api/v1/auth/refresh').set('Cookie', cookie1);
    expect(replayRes.status).toBe(401);

    // Session 2 (same family) must now ALSO be revoked!
    const meAfterTheft = await request(testApp).get('/api/v1/auth/me').set('Cookie', cookie2);
    expect(meAfterTheft.status).toBe(401);
  });

  it('delivers password reset via NotificationAdapter and invalidates old sessions on reset', async () => {
    const reg = await request(testApp).post('/api/v1/auth/register').send({
      email: 'reset@amal.test',
      password: 'OldPassword123!',
      fullName: 'Reset User',
    });
    const oldCookie = (reg.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    const reqReset = await request(testApp)
      .post('/api/v1/auth/password-reset/request')
      .send({ email: 'reset@amal.test' });
    expect(reqReset.status).toBe(200);

    const captured = devNotificationCapture.listRecent().find((n) => n.type === 'password_reset');
    expect(captured).toBeDefined();
    const token = new URL(captured!.url).searchParams.get('resetToken')!;
    expect(token.length).toBeGreaterThan(10);

    const confirmRes = await request(testApp).post('/api/v1/auth/password-reset/confirm').send({
      token,
      newPassword: 'BrandNewPassword456!',
    });
    expect(confirmRes.status).toBe(200);

    // Old session cookie revoked upon password change
    const oldMe = await request(testApp).get('/api/v1/auth/me').set('Cookie', oldCookie);
    expect(oldMe.status).toBe(401);

    // Can log in with new password
    const newLogin = await request(testApp).post('/api/v1/auth/login').send({
      email: 'reset@amal.test',
      password: 'BrandNewPassword456!',
    });
    expect(newLogin.status).toBe(200);
  });
});
