import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { hashPassword } from '../../server/services/authService';
import { encryptQrToken, etbToMinor, sha256Hex } from '../../server/utils/cryptoAndMoney';
import { BUSINESS_PRESETS } from '../data/presets';
import { createAdminPool } from './index';
import * as schema from './schema';

export const CANONICAL_ROLES = [
  {
    id: 'tenant_owner',
    name: 'Tenant Owner',
    scopeLevel: 'tenant',
    permissions: ['*'],
  },
  {
    id: 'tenant_manager',
    name: 'Tenant Manager',
    scopeLevel: 'tenant',
    permissions: [
      'workspace:read',
      'workspace:write',
      'catalog:write',
      'inventory:write',
      'orders:read',
      'orders:write',
      'qr:write',
      'staff:manage',
      'website:write',
    ],
  },
  {
    id: 'branch_manager',
    name: 'Branch Manager',
    scopeLevel: 'branch',
    permissions: [
      'workspace:read',
      'catalog:write',
      'inventory:write',
      'orders:read',
      'orders:write',
      'qr:write',
    ],
  },
  {
    id: 'outlet_staff',
    name: 'Outlet Floor / Counter Staff',
    scopeLevel: 'outlet',
    permissions: ['workspace:read', 'orders:read', 'orders:write', 'inventory:write'],
  },
  {
    id: 'kitchen_staff',
    name: 'Kitchen Display Staff',
    scopeLevel: 'outlet',
    permissions: ['workspace:read', 'orders:read', 'orders:write'],
  },
] as const;

export async function seedDatabase(): Promise<void> {
  const adminPool = createAdminPool();
  const adminDb = drizzle(adminPool, { schema });

  try {
    // 1. Seed canonical roles
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

    // 2. Seed demo merchant & platform admin users (development demo credentials)
    const demoPassHash = await hashPassword('AmalDemo2026!');
    const adminPassHash = await hashPassword('AmalPlatformAdmin2026!');

    let [demoUser] = await adminDb
      .select()
      .from(schema.users)
      .where(eq(schema.users.emailNormalized, 'demo@amal.hospitality'))
      .limit(1);

    if (!demoUser) {
      [demoUser] = await adminDb
        .insert(schema.users)
        .values({
          email: 'demo@amal.hospitality',
          emailNormalized: 'demo@amal.hospitality',
          passwordHash: demoPassHash,
          fullName: 'Selam Demo Operator',
          phoneE164: '+251911234500',
          isEmailVerified: true,
        })
        .returning();
    }

    const [existingAdmin] = await adminDb
      .select()
      .from(schema.users)
      .where(eq(schema.users.emailNormalized, 'admin@amal.hospitality'))
      .limit(1);

    if (!existingAdmin) {
      await adminDb.insert(schema.users).values({
        email: 'admin@amal.hospitality',
        emailNormalized: 'admin@amal.hospitality',
        passwordHash: adminPassHash,
        fullName: 'AMAL Platform Governance',
        isEmailVerified: true,
        platformRole: 'platform_admin',
      });
    }

    // 3. Seed all 7 Hospitality Business Presets cleanly into PostgreSQL
    for (const preset of Object.values(BUSINESS_PRESETS)) {
      const existingTenant = await adminDb
        .select({ id: schema.tenants.id })
        .from(schema.tenants)
        .where(eq(schema.tenants.slug, preset.slug))
        .limit(1);

      if (existingTenant.length > 0) {
        continue;
      }

      await adminDb.transaction(async (tx) => {
        const [tenant] = await tx
          .insert(schema.tenants)
          .values({
            slug: preset.slug,
            businessName: preset.businessName,
            tagline: preset.tagline,
            operatingCurrency: 'ETB',
            primaryBusinessType: preset.primaryBusinessType,
            businessTypes: preset.businessTypes,
            enabledCapabilities: preset.enabledCapabilities,
            allowedWorkflows: preset.allowedWorkflows,
            planTier: preset.primaryBusinessType === 'hotel' ? 'pro' : 'growth',
            subscriptionStatus: 'active',
            maxBranches: 5,
            maxOutlets: 10,
          })
          .returning();

        // Bind tenant RLS context cleanly inside seed tx too
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`);

        await tx.insert(schema.tenantMemberships).values({
          tenantId: tenant.id,
          userId: demoUser.id,
          roleId: 'tenant_owner',
          scopeType: 'tenant',
          status: 'active',
        });

        const branchIdMap = new Map<string, string>();
        for (const b of preset.branches) {
          const [insertedBranch] = await tx
            .insert(schema.branches)
            .values({
              tenantId: tenant.id,
              name: b.name,
              city: b.city,
              neighborhood: b.neighborhood,
              phone: b.phone,
              whatsappNumber: b.whatsappNumber,
              displayHours: b.hours,
              timezone: 'Africa/Addis_Ababa',
            })
            .returning();
          branchIdMap.set(b.id, insertedBranch.id);

          // Seed standard daily operating hours (07:00 - 23:00)
          for (let d = 0; d < 7; d++) {
            await tx.insert(schema.branchOperatingHours).values({
              tenantId: tenant.id,
              branchId: insertedBranch.id,
              dayOfWeek: d,
              periodIndex: 0,
              openTime: '07:00:00',
              closeTime: '23:00:00',
              crossesMidnight: false,
            });
          }
        }

        const outletMap = new Map<string, { id: string; branchId: string; menuId: string }>();
        for (const o of preset.outlets) {
          const dbBranchId = branchIdMap.get(o.branchId) || Array.from(branchIdMap.values())[0];
          const [insertedOutlet] = await tx
            .insert(schema.outlets)
            .values({
              tenantId: tenant.id,
              branchId: dbBranchId,
              nameJson: o.name,
              outletKind: o.outletKind,
              description: o.description,
              supportsTables: o.supportsTables,
              supportsRoomService: o.supportsRoomService,
              active: o.active,
            })
            .returning();

          const [defaultMenu] = await tx
            .insert(schema.menus)
            .values({
              tenantId: tenant.id,
              outletId: insertedOutlet.id,
              nameJson: { en: `${o.name.en} All-Day Menu` },
              sortOrder: 0,
            })
            .returning();

          outletMap.set(o.id, {
            id: insertedOutlet.id,
            branchId: dbBranchId,
            menuId: defaultMenu.id,
          });
        }

        const catMap = new Map<string, { id: string; outletId: string }>();
        for (const c of preset.categories) {
          const outletTarget = outletMap.get(c.outletId) || Array.from(outletMap.values())[0];
          const [insertedCat] = await tx
            .insert(schema.menuCategories)
            .values({
              tenantId: tenant.id,
              menuId: outletTarget.menuId,
              outletId: outletTarget.id,
              nameJson: c.name,
              descriptionJson: c.description || null,
              regionalOrigin: c.regionalOrigin || null,
              isFastingFriendly: Boolean(c.isFastingFriendly),
              sortOrder: c.sortOrder,
            })
            .returning();
          catMap.set(c.id, { id: insertedCat.id, outletId: outletTarget.id });
        }

        const prodIdMap = new Map<string, string>();
        for (const p of preset.products) {
          const catTarget = catMap.get(p.categoryId) || Array.from(catMap.values())[0];
          const outletTarget = outletMap.get(p.outletId) || Array.from(outletMap.values())[0];

          const [insertedProd] = await tx
            .insert(schema.products)
            .values({
              tenantId: tenant.id,
              categoryId: catTarget.id,
              outletId: catTarget.outletId,
              nameJson: p.name,
              descriptionJson: p.description,
              basePriceMinor: etbToMinor(p.basePriceEtb),
              currencyCode: 'ETB',
              dietaryTags: p.dietaryTags,
              prepTimeMinutes: p.prepTimeMinutes,
              isFeatured: Boolean(p.featured),
              isCombo: Boolean(p.isCombo),
              fastingDayEligible: Boolean(p.availability.fastingDayEligible),
              fastingOnly: Boolean(p.availability.fastingOnly),
              timeWindow: p.availability.timeWindow || null,
              leadTimeHours: p.availability.leadTimeHours ?? null,
              availabilityStatus: p.availability.status,
            })
            .returning();
          prodIdMap.set(p.id, insertedProd.id);

          // Seed inventory record for items tracking batch stock
          if (typeof p.availability.remainingCount === 'number') {
            await tx.insert(schema.inventoryItems).values({
              tenantId: tenant.id,
              branchId: outletTarget.branchId,
              outletId: catTarget.outletId,
              productId: insertedProd.id,
              availableQty: p.availability.remainingCount,
              reservedQty: 0,
              lowStockThreshold: 5,
              trackStock: true,
            });
          }

          for (let vi = 0; vi < p.variations.length; vi++) {
            const v = p.variations[vi];
            await tx.insert(schema.productVariations).values({
              tenantId: tenant.id,
              productId: insertedProd.id,
              nameJson: v.name,
              priceDeltaMinor: etbToMinor(v.priceDeltaEtb),
              currencyCode: 'ETB',
              sku: v.sku || null,
              sortOrder: vi,
              isDefault: vi === 0,
            });
          }

          for (let mi = 0; mi < p.modifierGroups.length; mi++) {
            const mg = p.modifierGroups[mi];
            const [insertedMg] = await tx
              .insert(schema.modifierGroups)
              .values({
                tenantId: tenant.id,
                nameJson: mg.name,
                isRequired: mg.required,
                minSelect: mg.minSelect,
                maxSelect: mg.maxSelect,
              })
              .returning();

            await tx.insert(schema.productModifierGroups).values({
              tenantId: tenant.id,
              productId: insertedProd.id,
              modifierGroupId: insertedMg.id,
              sortOrder: mi,
            });

            for (let oi = 0; oi < mg.options.length; oi++) {
              const opt = mg.options[oi];
              await tx.insert(schema.modifierOptions).values({
                tenantId: tenant.id,
                modifierGroupId: insertedMg.id,
                nameJson: opt.name,
                priceDeltaMinor: etbToMinor(opt.priceDeltaEtb),
                currencyCode: 'ETB',
                isAvailable: opt.available,
                sortOrder: oi,
              });
            }
          }
        }

        // QR Stations (encrypted + hashed)
        for (const q of preset.qrStations) {
          const outletTarget = outletMap.get(q.outletId) || Array.from(outletMap.values())[0];
          const enc = encryptQrToken(q.scanToken);
          await tx.insert(schema.qrStations).values({
            tenantId: tenant.id,
            branchId: outletTarget.branchId,
            outletId: outletTarget.id,
            label: q.label,
            stationType: q.stationType,
            capacityOrZone: q.capacityOrZone,
            status: q.status,
            tokenHash: sha256Hex(q.scanToken),
            tokenCiphertext: enc.ciphertext,
            tokenIv: enc.iv,
            tokenAuthTag: enc.authTag,
          });
        }

        // Website config (force pmsIntegration.enabled = false until real PMS webhook configured)
        await tx.insert(schema.websiteConfigs).values({
          tenantId: tenant.id,
          templateId: preset.websiteConfig.templateId,
          accentHex: preset.websiteConfig.accentHex,
          typographyStyle: preset.websiteConfig.typographyStyle,
          heroHeadlineJson: preset.websiteConfig.heroHeadline,
          heroSubheadlineJson: preset.websiteConfig.heroSubheadline,
          heroImageUrl: preset.websiteConfig.heroImage,
          visibleSections: preset.websiteConfig.visibleSections,
          lowBandwidthDefault: preset.websiteConfig.lowBandwidthDefault,
          defaultLanguage: preset.localization.defaultLanguage,
          supportedLanguages: preset.localization.supportedLanguages,
          acceptedPayments: preset.localization.acceptedPayments,
          whatsappOrderingEnabled: preset.localization.whatsappOrderingEnabled,
          fastingModeActive: preset.localization.fastingModeActive,
          pmsConfigJson: {
            ...preset.pmsIntegration,
            // Correction from technical review: mark sandbox webhook hook as ready, not falsely "Connected"
            enabled: false,
            lastSyncedAt: preset.pmsIntegration.roomValidationEndpoint ? 'Sandbox hook ready' : '',
          },
        });

        // Seed sample loyalty accounts
        for (const lm of preset.loyaltyMembers) {
          const phoneNorm = lm.phone.replace(/\s+/g, '');
          const [cust] = await tx
            .insert(schema.customers)
            .values({
              tenantId: tenant.id,
              fullName: lm.name,
              phoneE164: phoneNorm,
            })
            .returning();

          await tx.insert(schema.loyaltyAccounts).values({
            tenantId: tenant.id,
            customerId: cust.id,
            stampsBalance: lm.stamps,
            targetStamps: lm.targetStamps,
            lifetimeSpentMinor: etbToMinor(lm.totalSpentEtb),
            currencyCode: 'ETB',
          });
        }
      });
    }
  } finally {
    await adminPool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase()
    .then(() => {
      console.log('AMAL database seed completed cleanly.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
