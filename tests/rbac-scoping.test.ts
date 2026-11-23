import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { devNotificationCapture } from '../server/services/notificationAdapter';
import { registerAndOnboardUser, resetTestDatabase, testApp } from './helpers/testSetup';

describe('Scoped RBAC & Normalized Staff Invitations', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('invites outlet_staff scoped to Outlet A only, filters read results, and returns 403 on Outlet B writes', async () => {
    const owner = await registerAndOnboardUser({
      email: 'hotel-owner@amal.test',
      password: 'Password123!',
      fullName: 'Hotel Owner',
      businessName: 'Jimma Grand Hotel',
      primaryType: 'hotel',
      planTier: 'pro',
    });

    const branchId = owner.workspace.branches[0].id as string;
    const outletA = owner.workspace.outlets[0];
    expect(owner.workspace.outlets.length).toBeGreaterThanOrEqual(2);
    const outletB = owner.workspace.outlets[1];

    const prodInOutletA = owner.workspace.products.find((p: any) => p.outletId === outletA.id);
    const prodInOutletB = owner.workspace.products.find((p: any) => p.outletId === outletB.id);
    expect(prodInOutletA).toBeDefined();
    expect(prodInOutletB).toBeDefined();

    // Invite staff member scoped ONLY to Outlet A
    const invRes = await owner.agent
      .post('/api/v1/staff/invitations')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        email: 'staff-a@amal.test',
        roleId: 'outlet_staff',
        scopeType: 'outlet',
        outletAssignments: [{ branchId, outletId: outletA.id }],
      });
    expect(invRes.status).toBe(201);

    const inviteMsg = devNotificationCapture.listRecent().find((n) => n.type === 'staff_invite');
    expect(inviteMsg).toBeDefined();
    const inviteToken = new URL(inviteMsg!.url).searchParams.get('inviteToken')!;

    // Staff accepts invitation (resolve_staff_invitation_by_hash SECURITY DEFINER)
    const staffAgent = request.agent(testApp);
    const staffReg = await staffAgent.post('/api/v1/auth/register').send({
      email: 'staff-a@amal.test',
      password: 'StaffPassword123!',
      fullName: 'Outlet A Cashier',
    });
    expect(staffReg.status).toBe(201);
    const staffCsrf = staffReg.body.csrfToken as string;

    const acceptRes = await staffAgent
      .post('/api/v1/staff/invitations/accept')
      .set('X-CSRF-Token', staffCsrf)
      .send({ token: inviteToken });
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.tenantId).toBe(owner.workspace.id);

    // Scoped GET /tenants/current sees Outlet A only
    const staffWs = await staffAgent.get('/api/v1/tenants/current');
    expect(staffWs.status).toBe(200);
    expect(staffWs.body.workspace.outlets.map((o: any) => o.id)).toEqual([outletA.id]);

    // Allowed: Outlet A inventory toggle succeeds
    const okPatch = await staffAgent
      .patch(`/api/v1/tenants/current/products/${prodInOutletA.id}/availability`)
      .set('X-CSRF-Token', staffCsrf)
      .send({ status: 'low_stock' });
    expect(okPatch.status).toBe(200);

    // Forbidden: Outlet B inventory toggle fails with 403
    const deniedPatch = await staffAgent
      .patch(`/api/v1/tenants/current/products/${prodInOutletB.id}/availability`)
      .set('X-CSRF-Token', staffCsrf)
      .send({ status: 'sold_out' });
    expect(deniedPatch.status).toBe(403);

    // Forbidden: outlet_staff lacks catalog:write permission -> 403
    const deniedAddProd = await staffAgent
      .post('/api/v1/tenants/current/products')
      .set('X-CSRF-Token', staffCsrf)
      .send({
        categoryId: owner.workspace.categories[0].id,
        nameEn: 'Unauthorized Item',
        basePriceEtb: 100,
      });
    expect(deniedAddProd.status).toBe(403);
  });
});
