import { and, eq, isNull, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import {
  BUSINESS_CATEGORY_REGISTRY,
  UNIVERSAL_CAPABILITIES,
  WEBSITE_TEMPLATE_REGISTRY,
} from '../../src/data/businessRegistry';
import { BUSINESS_PRESETS } from '../../src/data/presets';
import { db } from '../../src/db';
import {
  auditLogs,
  branchOperatingHours,
  branches,
  inventoryItems,
  inventoryMovements,
  menuCategories,
  menus,
  modifierGroups,
  modifierOptions,
  orders,
  outlets,
  productModifierGroups,
  productVariations,
  products,
  qrStations,
  specialRequests,
  tenantMemberships,
  tenants,
  userSessions,
  websiteConfigs,
} from '../../src/db/schema';
import type {
  BusinessTypeId,
  CapabilityId,
  OrderingWorkflow,
} from '../../src/types/amal';
import { withTenantTransaction } from '../db/tenantTx';
import {
  canAccessBranch,
  canAccessOutlet,
  requireAuth,
  requirePermission,
  requireTenantContext,
  verifyCsrf,
} from '../middleware/auth';
import { hydrateWorkspaceForTenant } from '../services/workspaceMapper';
import {
  encryptQrToken,
  etbToMinor,
  generateOpaqueToken,
  minorToEtb,
  sha256Hex,
} from '../utils/cryptoAndMoney';

export const tenantRouter = Router();

const onboardingSchema = z.object({
  businessName: z.string().min(2).max(120),
  city: z.string().min(2).max(80),
  neighborhood: z.string().min(2).max(80),
  phone: z.string().min(6).max(32),
  whatsappNumber: z.string().min(6).max(32),
  primaryType: z.enum([
    'restaurant',
    'coffee_house',
    'hotel',
    'juice_bar',
    'fast_food',
    'bakery',
    'traditional_ethiopian',
  ]),
  secondaryTypes: z
    .array(
      z.enum([
        'restaurant',
        'coffee_house',
        'hotel',
        'juice_bar',
        'fast_food',
        'bakery',
        'traditional_ethiopian',
      ])
    )
    .default([]),
  supportedLanguages: z.array(z.enum(['en', 'am', 'om'])).min(1),
  acceptedPayments: z
    .array(z.enum(['telebirr', 'cbe_birr', 'chapa', 'cash', 'room_charge']))
    .min(1),
  enableFastingMode: z.boolean().default(false),
  enableLowBandwidthDefault: z.boolean().default(false),
  planTier: z.enum(['starter', 'growth', 'pro', 'enterprise']).default('growth'),
});

const PLAN_LIMITS: Record<string, { maxBranches: number; maxOutlets: number }> = {
  starter: { maxBranches: 1, maxOutlets: 1 },
  growth: { maxBranches: 2, maxOutlets: 4 },
  pro: { maxBranches: 5, maxOutlets: 20 },
  enterprise: { maxBranches: 50, maxOutlets: 100 },
};

tenantRouter.post('/onboarding', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    const parsed = onboardingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid onboarding payload', issues: parsed.error.issues });
      return;
    }

    const input = parsed.data;
    const allTypes = Array.from(new Set<BusinessTypeId>([input.primaryType, ...input.secondaryTypes]));
    const primaryDef = BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === input.primaryType)!;
    const primaryPreset = BUSINESS_PRESETS[input.primaryType];
    const templateDef = WEBSITE_TEMPLATE_REGISTRY[primaryDef.defaultTemplate];

    const capabilitySet = new Set<CapabilityId>(UNIVERSAL_CAPABILITIES);
    const workflowSet = new Set<OrderingWorkflow>();
    for (const typeId of allTypes) {
      const def = BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === typeId);
      if (def) {
        def.recommendedCapabilities.forEach((c) => capabilitySet.add(c));
        def.defaultWorkflows.forEach((w) => workflowSet.add(w));
      }
    }
    if (input.enableFastingMode) capabilitySet.add('fasting_menu_mode');

    const baseSlug =
      input.businessName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'amal-business';
    const uniqueSlug = `${baseSlug}-${generateOpaqueToken(3).toLowerCase()}`;
    const limits = PLAN_LIMITS[input.planTier] || PLAN_LIMITS.growth;

    const preGeneratedTenantId = crypto.randomUUID();
    const createdTenantId = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${preGeneratedTenantId}, true)`
      );

      const [tenant] = await tx
        .insert(tenants)
        .values({
          id: preGeneratedTenantId,
          slug: uniqueSlug,
          businessName: input.businessName.trim(),
          tagline: `${primaryDef.shortLabel}${
            input.secondaryTypes.length > 0
              ? ` + ${input.secondaryTypes
                  .map((t) => BUSINESS_CATEGORY_REGISTRY.find((c) => c.id === t)?.shortLabel)
                  .filter(Boolean)
                  .join(', ')}`
              : ''
          } · ${input.neighborhood}`,
          operatingCurrency: 'ETB',
          primaryBusinessType: input.primaryType,
          businessTypes: allTypes,
          enabledCapabilities: Array.from(capabilitySet),
          allowedWorkflows: Array.from(workflowSet),
          planTier: input.planTier,
          subscriptionStatus: 'trial',
          maxBranches: limits.maxBranches,
          maxOutlets: limits.maxOutlets,
        })
        .returning({ id: tenants.id });

      await tx.insert(tenantMemberships).values({
        tenantId: tenant.id,
        userId: req.auth!.userId,
        roleId: 'tenant_owner',
        scopeType: 'tenant',
        status: 'active',
      });

      const [mainBranch] = await tx
        .insert(branches)
        .values({
          tenantId: tenant.id,
          name: `${input.neighborhood} Branch`,
          city: input.city.trim(),
          neighborhood: input.neighborhood.trim(),
          phone: input.phone.trim(),
          whatsappNumber: input.whatsappNumber.trim(),
          displayHours: primaryPreset.branches[0]?.hours || '08:00 – 22:00 Daily',
          timezone: 'Africa/Addis_Ababa',
        })
        .returning();

      for (let d = 0; d < 7; d++) {
        await tx.insert(branchOperatingHours).values({
          tenantId: tenant.id,
          branchId: mainBranch.id,
          dayOfWeek: d,
          periodIndex: 0,
          openTime: '08:00:00',
          closeTime: '22:00:00',
          crossesMidnight: false,
        });
      }

      // Combine outlets, categories, products & stations from primary + secondary types
      const presetsToMerge = [primaryPreset];
      for (const secType of input.secondaryTypes) {
        if (secType !== input.primaryType) presetsToMerge.push(BUSINESS_PRESETS[secType]);
      }

      const outletMap = new Map<string, { id: string; menuId: string }>();
      const catMap = new Map<string, { id: string; outletId: string }>();
      let outletCount = 0;

      for (const pset of presetsToMerge) {
        for (const o of pset.outlets) {
          if (outletMap.has(o.id) || outletCount >= limits.maxOutlets) continue;
          const [createdOutlet] = await tx
            .insert(outlets)
            .values({
              tenantId: tenant.id,
              branchId: mainBranch.id,
              nameJson: o.name,
              outletKind: o.outletKind,
              description: o.description,
              supportsTables: o.supportsTables,
              supportsRoomService: o.supportsRoomService,
            })
            .returning();

          const [menu] = await tx
            .insert(menus)
            .values({
              tenantId: tenant.id,
              outletId: createdOutlet.id,
              nameJson: { en: `${o.name.en} Menu` },
            })
            .returning();

          outletMap.set(o.id, { id: createdOutlet.id, menuId: menu.id });
          outletCount++;
        }

        for (const c of pset.categories) {
          if (catMap.has(c.id)) continue;
          const targetOutlet = outletMap.get(c.outletId) || Array.from(outletMap.values())[0];
          if (!targetOutlet) continue;
          const [createdCat] = await tx
            .insert(menuCategories)
            .values({
              tenantId: tenant.id,
              menuId: targetOutlet.menuId,
              outletId: targetOutlet.id,
              nameJson: c.name,
              descriptionJson: c.description || null,
              regionalOrigin: c.regionalOrigin || null,
              isFastingFriendly: Boolean(c.isFastingFriendly),
              sortOrder: catMap.size + 1,
            })
            .returning();
          catMap.set(c.id, { id: createdCat.id, outletId: targetOutlet.id });
        }

        for (const p of pset.products) {
          const catTarget = catMap.get(p.categoryId);
          if (!catTarget) continue;
          const [createdProd] = await tx
            .insert(products)
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

          if (typeof p.availability.remainingCount === 'number') {
            await tx.insert(inventoryItems).values({
              tenantId: tenant.id,
              branchId: mainBranch.id,
              outletId: catTarget.outletId,
              productId: createdProd.id,
              availableQty: p.availability.remainingCount,
              reservedQty: 0,
              lowStockThreshold: 5,
              trackStock: true,
            });
          }

          for (let vi = 0; vi < p.variations.length; vi++) {
            const v = p.variations[vi];
            await tx.insert(productVariations).values({
              tenantId: tenant.id,
              productId: createdProd.id,
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
            const [createdMg] = await tx
              .insert(modifierGroups)
              .values({
                tenantId: tenant.id,
                nameJson: mg.name,
                isRequired: mg.required,
                minSelect: mg.minSelect,
                maxSelect: mg.maxSelect,
              })
              .returning();
            await tx.insert(productModifierGroups).values({
              tenantId: tenant.id,
              productId: createdProd.id,
              modifierGroupId: createdMg.id,
              sortOrder: mi,
            });
            for (let oi = 0; oi < mg.options.length; oi++) {
              const opt = mg.options[oi];
              await tx.insert(modifierOptions).values({
                tenantId: tenant.id,
                modifierGroupId: createdMg.id,
                nameJson: opt.name,
                priceDeltaMinor: etbToMinor(opt.priceDeltaEtb),
                currencyCode: 'ETB',
                isAvailable: opt.available,
                sortOrder: oi,
              });
            }
          }
        }

        for (const q of pset.qrStations) {
          const targetOutlet = outletMap.get(q.outletId) || Array.from(outletMap.values())[0];
          if (!targetOutlet) continue;
          const rawToken = generateOpaqueToken(16);
          const enc = encryptQrToken(rawToken);
          await tx.insert(qrStations).values({
            tenantId: tenant.id,
            branchId: mainBranch.id,
            outletId: targetOutlet.id,
            label: q.label,
            stationType: q.stationType,
            capacityOrZone: q.capacityOrZone,
            status: q.status,
            tokenHash: sha256Hex(rawToken),
            tokenCiphertext: enc.ciphertext,
            tokenIv: enc.iv,
            tokenAuthTag: enc.authTag,
          });
        }
      }

      await tx.insert(websiteConfigs).values({
        tenantId: tenant.id,
        templateId: templateDef.id,
        accentHex: templateDef.accentHex,
        typographyStyle: templateDef.typographyStyle,
        heroHeadlineJson: {
          en: `Welcome to ${input.businessName.trim()}`,
          am: `እንኳን ወደ ${input.businessName.trim()} በደህና መጡ`,
          om: `Baga gara ${input.businessName.trim()} nagaan dhuftan`,
        },
        heroSubheadlineJson: primaryPreset.websiteConfig.heroSubheadline,
        heroImageUrl: templateDef.heroImage,
        visibleSections: templateDef.defaultSections,
        lowBandwidthDefault: input.enableLowBandwidthDefault,
        defaultLanguage: input.supportedLanguages[0] || 'en',
        supportedLanguages: input.supportedLanguages,
        acceptedPayments: input.acceptedPayments,
        whatsappOrderingEnabled: true,
        fastingModeActive: input.enableFastingMode,
        pmsConfigJson: allTypes.includes('hotel')
          ? {
              enabled: false,
              providerName: 'AMAL PMS Bridge (Webhook v1)',
              roomValidationEndpoint: '',
              folioPostingEnabled: false,
              lastSyncedAt: 'Webhook contract ready (Not connected)',
            }
          : {
              enabled: false,
              providerName: 'None',
              roomValidationEndpoint: '',
              folioPostingEnabled: false,
              lastSyncedAt: '',
            },
      });

      await tx.insert(auditLogs).values({
        tenantId: tenant.id,
        actorUserId: req.auth!.userId,
        action: 'tenant.onboarded',
        resourceType: 'tenant',
        resourceId: tenant.id,
        metadataJsonb: { businessTypes: allTypes, planTier: input.planTier },
        ipAddress: req.ip || null,
      });

      return tenant.id;
    });

    await db
      .update(userSessions)
      .set({ activeTenantId: createdTenantId })
      .where(eq(userSessions.id, req.auth!.sessionId));

    const workspace = await withTenantTransaction(createdTenantId, (tx) =>
      hydrateWorkspaceForTenant(tx, createdTenantId, { includeSensitiveCustomerData: true })
    );

    res.status(201).json({ workspace });
  } catch (err) {
    next(err);
  }
});

tenantRouter.get(
  '/tenants/current',
  requireAuth,
  requireTenantContext,
  requirePermission('workspace:read'),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const workspace = await withTenantTransaction(ctx.tenantId, (tx) =>
        hydrateWorkspaceForTenant(tx, ctx.tenantId, { includeSensitiveCustomerData: true })
      );
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // Enforce branch/outlet scope filtering for non-tenant-wide staff
      if (ctx.scopeType !== 'tenant') {
        const branchByOutlet = new Map(workspace.outlets.map((o) => [o.id, o.branchId]));
        workspace.branches = workspace.branches.filter((b) => canAccessBranch(ctx, b.id));
        workspace.outlets = workspace.outlets.filter((o) =>
          canAccessOutlet(ctx, o.id, o.branchId)
        );
        const visibleOutletIds = new Set(workspace.outlets.map((o) => o.id));
        workspace.categories = workspace.categories.filter((c) => visibleOutletIds.has(c.outletId));
        workspace.products = workspace.products.filter((p) => visibleOutletIds.has(p.outletId));
        workspace.qrStations = workspace.qrStations.filter((q) => visibleOutletIds.has(q.outletId));
        workspace.orders = workspace.orders.filter((o) =>
          canAccessOutlet(ctx, o.outletId, branchByOutlet.get(o.outletId))
        );
      }

      res.json({ workspace, scope: { roleId: ctx.roleId, scopeType: ctx.scopeType } });
    } catch (err) {
      next(err);
    }
  }
);

tenantRouter.post(
  '/tenants/current/branches',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('workspace:write'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(2).max(120),
        city: z.string().min(2).max(80),
        neighborhood: z.string().min(2).max(80),
        phone: z.string().min(6).max(32),
        whatsappNumber: z.string().min(6).max(32),
        displayHours: z.string().min(3).max(120).default('08:00 – 22:00 Daily'),
        timezone: z.string().min(3).max(60).default('Africa/Addis_Ababa'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid branch payload', issues: parsed.error.issues });
        return;
      }

      // Validate IANA timezone cleanly
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: parsed.data.timezone });
      } catch {
        res.status(400).json({ error: 'Invalid IANA timezone identifier' });
        return;
      }

      const ctx = req.tenantContext!;
      if (ctx.scopeType !== 'tenant') {
        res.status(403).json({ error: 'Only tenant-wide managers can create new branches' });
        return;
      }

      const created = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [tenant] = await tx.select().from(tenants).limit(1);
        const currentBranches = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(isNull(branches.deletedAt));

        if (tenant && currentBranches.length >= tenant.maxBranches) {
          throw new Error(`PLAN_LIMIT:Current plan allows max ${tenant.maxBranches} branches`);
        }

        const [branch] = await tx
          .insert(branches)
          .values({
            tenantId: ctx.tenantId,
            name: parsed.data.name.trim(),
            city: parsed.data.city.trim(),
            neighborhood: parsed.data.neighborhood.trim(),
            phone: parsed.data.phone.trim(),
            whatsappNumber: parsed.data.whatsappNumber.trim(),
            displayHours: parsed.data.displayHours.trim(),
            timezone: parsed.data.timezone,
          })
          .returning();

        for (let d = 0; d < 7; d++) {
          await tx.insert(branchOperatingHours).values({
            tenantId: ctx.tenantId,
            branchId: branch.id,
            dayOfWeek: d,
            periodIndex: 0,
            openTime: '08:00:00',
            closeTime: '22:00:00',
            crossesMidnight: false,
          });
        }

        await tx.insert(auditLogs).values({
          tenantId: ctx.tenantId,
          actorUserId: req.auth!.userId,
          action: 'branch.created',
          resourceType: 'branch',
          resourceId: branch.id,
          metadataJsonb: { name: branch.name, city: branch.city },
          ipAddress: req.ip || null,
        });

        return branch;
      });

      res.status(201).json({
        branch: {
          id: created.id,
          name: created.name,
          city: created.city,
          neighborhood: created.neighborhood,
          phone: created.phone,
          whatsappNumber: created.whatsappNumber,
          hours: created.displayHours,
        },
      });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('PLAN_LIMIT:')) {
        res.status(403).json({ error: err.message.replace('PLAN_LIMIT:', '') });
        return;
      }
      next(err);
    }
  }
);

tenantRouter.post(
  '/tenants/current/outlets',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('workspace:write'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        branchId: z.string().uuid().optional(),
        nameEn: z.string().min(2).max(100),
        nameAm: z.string().max(100).optional(),
        nameOm: z.string().max(100).optional(),
        outletKind: z
          .enum([
            'dining_room',
            'cafe_counter',
            'room_service',
            'bar_lounge',
            'bakery_pickup',
            'juice_bar',
            'kitchen_express',
            'cultural_hall',
          ])
          .default('dining_room'),
        description: z.string().max(300).default('Configured outlet menu'),
        supportsTables: z.boolean().default(true),
        supportsRoomService: z.boolean().default(false),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid outlet payload', issues: parsed.error.issues });
        return;
      }

      const ctx = req.tenantContext!;
      const result = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [tenant] = await tx.select().from(tenants).limit(1);
        const currentOutlets = await tx
          .select({ id: outlets.id })
          .from(outlets)
          .where(isNull(outlets.deletedAt));

        if (tenant && currentOutlets.length >= tenant.maxOutlets) {
          throw new Error(`PLAN_LIMIT:Current plan allows max ${tenant.maxOutlets} outlets`);
        }

        const branchRows = await tx
          .select()
          .from(branches)
          .where(isNull(branches.deletedAt))
          .limit(10);

        const targetBranch = parsed.data.branchId
          ? branchRows.find((b) => b.id === parsed.data.branchId)
          : branchRows[0];

        if (!targetBranch) {
          throw new Error('NOT_FOUND:Branch not found');
        }
        if (!canAccessBranch(ctx, targetBranch.id)) {
          throw new Error('FORBIDDEN:Branch out of scope');
        }

        const [createdOutlet] = await tx
          .insert(outlets)
          .values({
            tenantId: ctx.tenantId,
            branchId: targetBranch.id,
            nameJson: {
              en: parsed.data.nameEn.trim(),
              am: parsed.data.nameAm?.trim() || undefined,
              om: parsed.data.nameOm?.trim() || undefined,
            },
            outletKind: parsed.data.outletKind,
            description: parsed.data.description,
            supportsTables: parsed.data.supportsTables,
            supportsRoomService: parsed.data.supportsRoomService,
          })
          .returning();

        await tx.insert(menus).values({
          tenantId: ctx.tenantId,
          outletId: createdOutlet.id,
          nameJson: { en: `${parsed.data.nameEn.trim()} Menu` },
        });

        return createdOutlet;
      });

      res.status(201).json({ outlet: result });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.startsWith('PLAN_LIMIT:')) {
          res.status(403).json({ error: err.message.replace('PLAN_LIMIT:', '') });
          return;
        }
        if (err.message.startsWith('FORBIDDEN:')) {
          res.status(403).json({ error: err.message.replace('FORBIDDEN:', '') });
          return;
        }
      }
      next(err);
    }
  }
);

tenantRouter.post(
  '/tenants/current/products',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('catalog:write'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        categoryId: z.string().uuid(),
        nameEn: z.string().min(1).max(120),
        nameAm: z.string().max(120).optional(),
        descriptionEn: z.string().max(500).default('Freshly prepared to order.'),
        basePriceEtb: z.number().positive().max(1_000_000),
        fastingDayEligible: z.boolean().default(false),
        prepTimeMinutes: z.number().int().min(1).max(480).default(10),
        variations: z
          .array(
            z.object({
              nameEn: z.string().min(1).max(80),
              priceDeltaEtb: z.number().min(0).max(1_000_000),
            })
          )
          .default([]),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid product payload', issues: parsed.error.issues });
        return;
      }

      const ctx = req.tenantContext!;
      const createdId = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [cat] = await tx
          .select()
          .from(menuCategories)
          .where(and(eq(menuCategories.id, parsed.data.categoryId), isNull(menuCategories.deletedAt)))
          .limit(1);

        if (!cat) throw new Error('Category not found');

        const [outlet] = await tx
          .select()
          .from(outlets)
          .where(eq(outlets.id, cat.outletId))
          .limit(1);

        if (!outlet || !canAccessOutlet(ctx, outlet.id, outlet.branchId)) {
          throw new Error('FORBIDDEN:Outlet out of staff scope');
        }

        const [prod] = await tx
          .insert(products)
          .values({
            tenantId: ctx.tenantId,
            categoryId: cat.id,
            outletId: cat.outletId,
            nameJson: {
              en: parsed.data.nameEn.trim(),
              am: parsed.data.nameAm?.trim() || undefined,
            },
            descriptionJson: { en: parsed.data.descriptionEn.trim() },
            basePriceMinor: etbToMinor(parsed.data.basePriceEtb),
            currencyCode: 'ETB',
            dietaryTags: parsed.data.fastingDayEligible ? ['Tsom / Fasting', 'New'] : ['New'],
            prepTimeMinutes: parsed.data.prepTimeMinutes,
            fastingDayEligible: parsed.data.fastingDayEligible,
            availabilityStatus: 'in_stock',
          })
          .returning({ id: products.id });

        for (let i = 0; i < parsed.data.variations.length; i++) {
          const v = parsed.data.variations[i];
          await tx.insert(productVariations).values({
            tenantId: ctx.tenantId,
            productId: prod.id,
            nameJson: { en: v.nameEn.trim() },
            priceDeltaMinor: etbToMinor(v.priceDeltaEtb),
            currencyCode: 'ETB',
            sortOrder: i,
            isDefault: i === 0,
          });
        }

        return prod.id;
      });

      res.status(201).json({ productId: createdId });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('FORBIDDEN:')) {
        res.status(403).json({ error: err.message.replace('FORBIDDEN:', '') });
        return;
      }
      next(err);
    }
  }
);

tenantRouter.patch(
  '/tenants/current/products/:productId/availability',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('inventory:write'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        status: z.enum(['in_stock', 'low_stock', 'sold_out', 'pre_order_only']),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid availability status' });
        return;
      }

      const ctx = req.tenantContext!;
      const productId = req.params.productId;
      if (!z.string().uuid().safeParse(productId).success) {
        res.status(400).json({ error: 'Valid productId UUID is required' });
        return;
      }
      await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [prod] = await tx
          .select()
          .from(products)
          .where(and(eq(products.id, productId), isNull(products.deletedAt)))
          .limit(1);
        if (!prod) throw new Error('NOT_FOUND');

        const [outlet] = await tx.select().from(outlets).where(eq(outlets.id, prod.outletId)).limit(1);
        if (!outlet || !canAccessOutlet(ctx, outlet.id, outlet.branchId)) {
          throw new Error('FORBIDDEN');
        }

        await tx
          .update(products)
          .set({ availabilityStatus: parsed.data.status })
          .where(eq(products.id, productId));
      });

      res.json({ ok: true });
    } catch (err) {
      if (err instanceof Error && err.message === 'FORBIDDEN') {
        res.status(403).json({ error: 'Outlet out of staff scope' });
        return;
      }
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      next(err);
    }
  }
);

tenantRouter.post(
  '/tenants/current/inventory/:productId/restock',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('inventory:write'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        quantity: z.number().int().min(1).max(100_000),
        reason: z.string().max(200).default('Manual restock'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Valid positive integer quantity required' });
        return;
      }

      const ctx = req.tenantContext!;
      const productId = req.params.productId;
      if (!z.string().uuid().safeParse(productId).success) {
        res.status(400).json({ error: 'Valid productId UUID is required' });
        return;
      }
      const updated = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [prod] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
        if (!prod) throw new Error('NOT_FOUND');

        const [outlet] = await tx.select().from(outlets).where(eq(outlets.id, prod.outletId)).limit(1);
        if (!outlet || !canAccessOutlet(ctx, outlet.id, outlet.branchId)) {
          throw new Error('FORBIDDEN');
        }

        let [inv] = await tx
          .select()
          .from(inventoryItems)
          .where(and(eq(inventoryItems.productId, productId), isNull(inventoryItems.variationId)))
          .limit(1);

        if (!inv) {
          [inv] = await tx
            .insert(inventoryItems)
            .values({
              tenantId: ctx.tenantId,
              branchId: outlet.branchId,
              outletId: outlet.id,
              productId: prod.id,
              availableQty: 0,
              reservedQty: 0,
              trackStock: true,
            })
            .returning();
        }

        const nextAvailable = inv.availableQty + parsed.data.quantity;
        await tx
          .update(inventoryItems)
          .set({ availableQty: nextAvailable, trackStock: true, updatedAt: new Date() })
          .where(eq(inventoryItems.id, inv.id));

        await tx.insert(inventoryMovements).values({
          tenantId: ctx.tenantId,
          inventoryItemId: inv.id,
          movementType: 'restock',
          availableDelta: parsed.data.quantity,
          reservedDelta: 0,
          availableAfter: nextAvailable,
          reservedAfter: inv.reservedQty,
          actorUserId: req.auth!.userId,
          reason: parsed.data.reason,
        });

        return { availableQty: nextAvailable, reservedQty: inv.reservedQty };
      });

      res.json(updated);
    } catch (err) {
      if (err instanceof Error && err.message === 'FORBIDDEN') {
        res.status(403).json({ error: 'Outlet out of staff scope' });
        return;
      }
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'Product not found' });
        return;
      }
      next(err);
    }
  }
);

tenantRouter.post(
  '/tenants/current/qr-stations',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('qr:write'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        label: z.string().min(1).max(80),
        stationType: z.enum(['table', 'room', 'counter', 'pickup_zone', 'mesob_table']),
        outletId: z.string().uuid(),
        capacityOrZone: z.string().max(80).default('Active Zone'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid QR station payload' });
        return;
      }

      const ctx = req.tenantContext!;
      const rawToken = generateOpaqueToken(16);
      const enc = encryptQrToken(rawToken);

      const station = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [outlet] = await tx
          .select()
          .from(outlets)
          .where(and(eq(outlets.id, parsed.data.outletId), isNull(outlets.deletedAt)))
          .limit(1);
        if (!outlet) throw new Error('NOT_FOUND');
        if (!canAccessOutlet(ctx, outlet.id, outlet.branchId)) throw new Error('FORBIDDEN');

        const [created] = await tx
          .insert(qrStations)
          .values({
            tenantId: ctx.tenantId,
            branchId: outlet.branchId,
            outletId: outlet.id,
            label: parsed.data.label.trim(),
            stationType: parsed.data.stationType,
            capacityOrZone: parsed.data.capacityOrZone.trim() || 'Active Zone',
            status: 'available',
            tokenHash: sha256Hex(rawToken),
            tokenCiphertext: enc.ciphertext,
            tokenIv: enc.iv,
            tokenAuthTag: enc.authTag,
          })
          .returning();

        return {
          id: created.id,
          label: created.label,
          stationType: created.stationType,
          outletId: created.outletId,
          capacityOrZone: created.capacityOrZone,
          status: created.status,
          scanToken: rawToken,
        };
      });

      res.status(201).json({ station });
    } catch (err) {
      if (err instanceof Error && err.message === 'FORBIDDEN') {
        res.status(403).json({ error: 'Outlet out of staff scope' });
        return;
      }
      next(err);
    }
  }
);

tenantRouter.post(
  '/tenants/current/qr-stations/:stationId/rotate',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('qr:write'),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const stationId = req.params.stationId;
      if (!z.string().uuid().safeParse(stationId).success) {
        res.status(400).json({ error: 'Valid stationId UUID is required' });
        return;
      }
      const newToken = generateOpaqueToken(16);
      const enc = encryptQrToken(newToken);

      const result = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [existing] = await tx
          .select()
          .from(qrStations)
          .where(and(eq(qrStations.id, stationId), isNull(qrStations.deletedAt)))
          .limit(1);
        if (!existing) throw new Error('NOT_FOUND');
        if (!canAccessOutlet(ctx, existing.outletId, existing.branchId)) throw new Error('FORBIDDEN');

        const nextVersion = existing.tokenVersion + 1;
        await tx
          .update(qrStations)
          .set({
            tokenHash: sha256Hex(newToken),
            tokenCiphertext: enc.ciphertext,
            tokenIv: enc.iv,
            tokenAuthTag: enc.authTag,
            tokenVersion: nextVersion,
            rotatedAt: new Date(),
          })
          .where(eq(qrStations.id, stationId));

        await tx.insert(auditLogs).values({
          tenantId: ctx.tenantId,
          actorUserId: req.auth!.userId,
          action: 'qr_station.token_rotated',
          resourceType: 'qr_station',
          resourceId: stationId,
          metadataJsonb: { tokenVersion: nextVersion },
          ipAddress: req.ip || null,
        });

        return { scanToken: newToken, tokenVersion: nextVersion };
      });

      res.json(result);
    } catch (err) {
      if (err instanceof Error && err.message === 'FORBIDDEN') {
        res.status(403).json({ error: 'Outlet out of staff scope' });
        return;
      }
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'QR station not found' });
        return;
      }
      next(err);
    }
  }
);

tenantRouter.patch(
  '/tenants/current/orders/:orderId/advance',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('orders:write'),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const orderId = req.params.orderId;
      if (!z.string().uuid().safeParse(orderId).success) {
        res.status(400).json({ error: 'Valid orderId UUID is required' });
        return;
      }
      const flow = ['new', 'preparing', 'ready', 'completed'] as const;

      const nextStatus = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [ord] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
        if (!ord) throw new Error('NOT_FOUND');
        if (!canAccessOutlet(ctx, ord.outletId, ord.branchId)) throw new Error('FORBIDDEN');

        const idx = flow.indexOf(ord.status as (typeof flow)[number]);
        if (idx === -1 || idx === flow.length - 1) return ord.status;

        const targetStatus = flow[idx + 1];
        await tx.update(orders).set({ status: targetStatus }).where(eq(orders.id, ord.id));
        return targetStatus;
      });

      res.json({ status: nextStatus });
    } catch (err) {
      if (err instanceof Error && err.message === 'FORBIDDEN') {
        res.status(403).json({ error: 'Outlet out of staff scope' });
        return;
      }
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'Order not found' });
        return;
      }
      next(err);
    }
  }
);

tenantRouter.patch(
  '/tenants/current/special-requests/:requestId',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('orders:write'),
  async (req, res, next) => {
    try {
      const requestId = req.params.requestId;
      if (!z.string().uuid().safeParse(requestId).success) {
        res.status(400).json({ error: 'Valid requestId UUID is required' });
        return;
      }

      const schema = z.object({
        status: z.enum(['pending', 'confirmed', 'in_production', 'cancelled']),
        estimatedEtb: z.number().min(0).max(10_000_000).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid special request update payload' });
        return;
      }

      const ctx = req.tenantContext!;
      const updated = await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [sr] = await tx
          .select()
          .from(specialRequests)
          .where(eq(specialRequests.id, requestId))
          .limit(1);
        if (!sr) throw new Error('NOT_FOUND');
        if (!canAccessOutlet(ctx, sr.outletId, sr.branchId)) throw new Error('FORBIDDEN');

        const nextEstimatedMinor =
          parsed.data.estimatedEtb !== undefined
            ? etbToMinor(parsed.data.estimatedEtb)
            : sr.estimatedMinor;

        await tx
          .update(specialRequests)
          .set({
            status: parsed.data.status,
            estimatedMinor: nextEstimatedMinor,
          })
          .where(eq(specialRequests.id, sr.id));

        await tx.insert(auditLogs).values({
          tenantId: ctx.tenantId,
          actorUserId: req.auth!.userId,
          action: 'special_request.updated',
          resourceType: 'special_request',
          resourceId: sr.id,
          metadataJsonb: { status: parsed.data.status },
          ipAddress: req.ip || null,
        });

        return {
          status: parsed.data.status,
          estimatedEtb:
            nextEstimatedMinor !== null ? minorToEtb(nextEstimatedMinor) : undefined,
        };
      });

      res.json({ ok: true, ...updated });
    } catch (err) {
      if (err instanceof Error && err.message === 'FORBIDDEN') {
        res.status(403).json({ error: 'Outlet out of staff scope' });
        return;
      }
      if (err instanceof Error && err.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'Special request not found' });
        return;
      }
      next(err);
    }
  }
);

tenantRouter.patch(
  '/tenants/current/website',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('website:write'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        templateId: z
          .enum([
            'fine_dining',
            'traditional_ethiopian',
            'coffee_house',
            'hotel_hospitality',
            'juice_bar',
            'fast_food',
            'bakery_patisserie',
          ])
          .optional(),
        accentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        typographyStyle: z.enum(['editorial', 'geometric', 'athletic']).optional(),
        heroHeadlineEn: z.string().min(1).max(200).optional(),
        heroImageUrl: z.string().min(1).max(500).optional(),
        visibleSections: z.array(z.string()).optional(),
        lowBandwidthDefault: z.boolean().optional(),
        acceptedPayments: z
          .array(z.enum(['telebirr', 'cbe_birr', 'chapa', 'cash', 'room_charge']))
          .min(1)
          .optional(),
        whatsappOrderingEnabled: z.boolean().optional(),
        fastingModeActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid website update payload' });
        return;
      }

      const ctx = req.tenantContext!;
      const d = parsed.data;
      await withTenantTransaction(ctx.tenantId, async (tx) => {
        const [existing] = await tx.select().from(websiteConfigs).limit(1);
        if (!existing) throw new Error('Website config missing');

        await tx
          .update(websiteConfigs)
          .set({
            templateId: d.templateId ?? existing.templateId,
            accentHex: d.accentHex ?? existing.accentHex,
            typographyStyle: d.typographyStyle ?? existing.typographyStyle,
            heroHeadlineJson: d.heroHeadlineEn
              ? { ...existing.heroHeadlineJson, en: d.heroHeadlineEn }
              : existing.heroHeadlineJson,
            heroImageUrl: d.heroImageUrl ?? existing.heroImageUrl,
            visibleSections: d.visibleSections ?? existing.visibleSections,
            lowBandwidthDefault: d.lowBandwidthDefault ?? existing.lowBandwidthDefault,
            acceptedPayments: d.acceptedPayments ?? existing.acceptedPayments,
            whatsappOrderingEnabled:
              d.whatsappOrderingEnabled ?? existing.whatsappOrderingEnabled,
            fastingModeActive: d.fastingModeActive ?? existing.fastingModeActive,
            updatedAt: new Date(),
          })
          .where(eq(websiteConfigs.tenantId, ctx.tenantId));
      });

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  }
);

// Milestone 5: Safe blueprint import from legacy localStorage (catalog & branding only, NEVER demo PII/orders)
tenantRouter.post(
  '/tenants/current/import-local-blueprint',
  requireAuth,
  verifyCsrf,
  requireTenantContext,
  requirePermission('workspace:write'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        businessName: z.string().min(2).max(120),
        tagline: z.string().max(240).optional(),
        accentHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        fastingModeActive: z.boolean().optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid blueprint import payload' });
        return;
      }

      const ctx = req.tenantContext!;
      await withTenantTransaction(ctx.tenantId, async (tx) => {
        await tx
          .update(tenants)
          .set({
            businessName: parsed.data.businessName.trim(),
            tagline: parsed.data.tagline?.trim(),
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, ctx.tenantId));

        if (parsed.data.accentHex || parsed.data.fastingModeActive !== undefined) {
          const [web] = await tx.select().from(websiteConfigs).limit(1);
          if (web) {
            await tx
              .update(websiteConfigs)
              .set({
                accentHex: parsed.data.accentHex ?? web.accentHex,
                fastingModeActive: parsed.data.fastingModeActive ?? web.fastingModeActive,
                updatedAt: new Date(),
              })
              .where(eq(websiteConfigs.tenantId, ctx.tenantId));
          }
        }

        await tx.insert(auditLogs).values({
          tenantId: ctx.tenantId,
          actorUserId: req.auth!.userId,
          action: 'tenant.local_blueprint_imported',
          resourceType: 'tenant',
          resourceId: ctx.tenantId,
          metadataJsonb: { piiImported: false, ordersImported: false },
          ipAddress: req.ip || null,
        });
      });

      res.json({ ok: true, importedPii: false, importedOrders: false });
    } catch (err) {
      next(err);
    }
  }
);
