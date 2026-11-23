import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { devNotificationCapture } from '../server/services/notificationAdapter';
import { registerAndOnboardUser, resetTestDatabase, testApp } from './helpers/testSetup';

describe('Multi-Branch Plan Limits, Staff Hydration & Special Request Operations', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('creates branches within plan limits, hydrates workspace.staff cleanly, and enforces outlet scope on special-request updates', async () => {
    const owner = await registerAndOnboardUser({
      email: 'ops-owner@amal.test',
      password: 'Password123!',
      fullName: 'Ops Owner',
      businessName: 'Sheger Heritage Hotel',
      primaryType: 'hotel',
      planTier: 'growth', // maxBranches = 2
    });

    // Growth plan starts with 1 branch -> adding a 2nd succeeds, 3rd rejected (403)
    const branch2Res = await owner.agent
      .post('/api/v1/tenants/current/branches')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        name: 'Kazanchis Annex',
        city: 'Addis Ababa',
        neighborhood: 'Kazanchis',
        phone: '+251115501122',
        whatsappNumber: '+251911501122',
      });
    expect(branch2Res.status).toBe(201);
    expect(branch2Res.body.branch.name).toBe('Kazanchis Annex');

    const branch3Res = await owner.agent
      .post('/api/v1/tenants/current/branches')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        name: 'Piassa Branch',
        city: 'Addis Ababa',
        neighborhood: 'Piassa',
        phone: '+251115509988',
        whatsappNumber: '+251911509988',
      });
    expect(branch3Res.status).toBe(403);

    // Public storefront submits special request for Outlet B
    const branchId = owner.workspace.branches[0].id as string;
    const outletA = owner.workspace.outlets[0];
    const outletB = owner.workspace.outlets[1];
    expect(outletB).toBeDefined();

    const srCreate = await request(testApp)
      .post(`/api/v1/public/storefronts/${encodeURIComponent(owner.workspace.slug)}/special-requests`)
      .send({
        kind: 'table_reservation',
        outletId: outletB.id,
        customerName: 'Dawit Tadesse',
        customerPhone: '+251911778899',
        dateTime: '2026-12-01 19:30',
        partyOrSize: '4 Guests',
        details: 'Window table please',
      });
    expect(srCreate.status).toBe(201);
    const requestId = srCreate.body.requestId as string;

    // Public storefront must NEVER expose staff list or PII
    const pubRes = await request(testApp).get(
      `/api/v1/public/storefronts/${encodeURIComponent(owner.workspace.slug)}`
    );
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.workspace.staff).toEqual([]);

    // Invite staff member scoped ONLY to Outlet A
    const invRes = await owner.agent
      .post('/api/v1/staff/invitations')
      .set('X-CSRF-Token', owner.csrfToken)
      .send({
        email: 'outlet-a-only@amal.test',
        roleId: 'outlet_staff',
        scopeType: 'outlet',
        outletAssignments: [{ branchId, outletId: outletA.id }],
      });
    expect(invRes.status).toBe(201);

    const inviteMsg = devNotificationCapture
      .listRecent()
      .reverse()
      .find((n) => n.type === 'staff_invite' && n.toEmail === 'outlet-a-only@amal.test');
    const inviteToken = new URL(inviteMsg!.url).searchParams.get('inviteToken')!;

    const staffAgent = request.agent(testApp);
    const staffReg = await staffAgent.post('/api/v1/auth/register').send({
      email: 'outlet-a-only@amal.test',
      password: 'StaffPassword123!',
      fullName: 'Outlet A Host',
    });
    const staffCsrf = staffReg.body.csrfToken as string;

    await staffAgent
      .post('/api/v1/staff/invitations/accept')
      .set('X-CSRF-Token', staffCsrf)
      .send({ token: inviteToken });

    // Authenticated workspace hydrates real staff memberships & scopes
    const ownerWs = await owner.agent.get('/api/v1/tenants/current');
    expect(ownerWs.status).toBe(200);
    expect(ownerWs.body.workspace.staff.length).toBe(2);
    const outletHost = ownerWs.body.workspace.staff.find(
      (s: any) => s.email === 'outlet-a-only@amal.test'
    );
    expect(outletHost.scopeType).toBe('outlet');
    expect(outletHost.assignedOutletIds).toEqual([outletA.id]);

    // Outlet-A-only staff cannot mutate Outlet B's special request
    const deniedUpdate = await staffAgent
      .patch(`/api/v1/tenants/current/special-requests/${requestId}`)
      .set('X-CSRF-Token', staffCsrf)
      .send({ status: 'confirmed' });
    expect(deniedUpdate.status).toBe(403);

    // Owner updates Outlet B's special request cleanly
    const ownerUpdate = await owner.agent
      .patch(`/api/v1/tenants/current/special-requests/${requestId}`)
      .set('X-CSRF-Token', owner.csrfToken)
      .send({ status: 'confirmed', estimatedEtb: 2500 });
    expect(ownerUpdate.status).toBe(200);
    expect(ownerUpdate.body.status).toBe('confirmed');
    expect(ownerUpdate.body.estimatedEtb).toBe(2500);
  });
});
