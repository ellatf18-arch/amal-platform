import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../../src/db';
import {
  auditLogs,
  branches,
  customers,
  inventoryItems,
  inventoryMovements,
  inventoryReservations,
  loyaltyAccounts,
  loyaltyLedger,
  modifierGroups,
  modifierOptions,
  orderItemModifiers,
  orderItems,
  orders,
  outlets,
  paymentTransactions,
  paymentWebhookEvents,
  platformAdminImpersonationLogs,
  productVariations,
  products,
  qrStations,
  specialRequests,
  tenants,
  userSessions,
} from '../../src/db/schema';
import type { PaymentProviderId } from '../../src/types/amal';
import { resolvePublicStorefrontTarget, withTenantTransaction } from '../db/tenantTx';
import { requireAuth, requirePlatformAdmin, verifyCsrf } from '../middleware/auth';
import { getPaymentAdapter } from '../services/paymentAdapters';
import { hydrateWorkspaceForTenant } from '../services/workspaceMapper';
import {
  calculateTaxMinorHalfUp,
  constantTimeEqual,
  generateOpaqueToken,
  minorToEtb,
  sha256Hex,
} from '../utils/cryptoAndMoney';

export const publicAndWorkerRouter = Router();

const publicWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 45,
  standardHeaders: true,
  legacyHeaders: false,
});

// List public showcase presets stored in PostgreSQL
publicAndWorkerRouter.get('/public/presets', async (_req, res, next) => {
  try {
    const result = await db.execute(
      sql`SELECT tenant_id, slug, business_name, primary_business_type
          FROM list_platform_tenant_summaries()`
    );
    res.json({ presets: result.rows });
  } catch (err) {
    next(err);
  }
});

// Resolve public storefront by slug + optional QR station token (zero customer PII exposed)
publicAndWorkerRouter.get('/public/storefronts/:slug', async (req, res, next) => {
  try {
    const slug = req.params.slug;
    const rawStationToken =
      typeof req.query.station === 'string' && req.query.station.trim().length > 0
        ? req.query.station.trim()
        : null;

    const target = await resolvePublicStorefrontTarget(
      slug,
      rawStationToken ? sha256Hex(rawStationToken) : null
    );
    if (!target) {
      res.status(404).json({ error: 'Storefront not found' });
      return;
    }

    const workspace = await withTenantTransaction(target.tenantId, (tx) =>
      hydrateWorkspaceForTenant(tx, target.tenantId, { includeSensitiveCustomerData: false })
    );
    if (!workspace) {
      res.status(404).json({ error: 'Storefront not found' });
      return;
    }

    res.json({
      workspace,
      matchedStation: target.stationId
        ? {
            id: target.stationId,
            label: target.stationLabel,
            stationType: target.stationType,
            outletId: target.outletId,
            branchId: target.branchId,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// Rate-limited masked loyalty balance check (prevents phone-enumeration PII leaks)
publicAndWorkerRouter.get(
  '/public/storefronts/:slug/loyalty/check',
  publicWriteLimiter,
  async (req, res, next) => {
    try {
      const slug = req.params.slug;
      const rawPhone = typeof req.query.phone === 'string' ? req.query.phone.replace(/\s+/g, '') : '';
      if (rawPhone.length < 7) {
        res.status(400).json({ error: 'Enter full phone number to check loyalty stamps' });
        return;
      }

      const target = await resolvePublicStorefrontTarget(slug, null);
      if (!target) {
        res.status(404).json({ error: 'Storefront not found' });
        return;
      }

      const loyalty = await withTenantTransaction(target.tenantId, async (tx) => {
        const [cust] = await tx
          .select({ id: customers.id, fullName: customers.fullName })
          .from(customers)
          .where(and(eq(customers.phoneE164, rawPhone), isNull(customers.deletedAt)))
          .limit(1);
        if (!cust) return null;

        const [acct] = await tx
          .select({
            stampsBalance: loyaltyAccounts.stampsBalance,
            targetStamps: loyaltyAccounts.targetStamps,
          })
          .from(loyaltyAccounts)
          .where(eq(loyaltyAccounts.customerId, cust.id))
          .limit(1);
        if (!acct) return null;

        const firstInitial = cust.fullName.trim().charAt(0).toUpperCase() || 'G';
        return {
          maskedName: `${firstInitial}***`,
          stampsBalance: acct.stampsBalance,
          targetStamps: acct.targetStamps,
        };
      });

      res.json({ found: Boolean(loyalty), loyalty });
    } catch (err) {
      next(err);
    }
  }
);

const checkoutSchema = z.object({
  workflow: z.enum(['dine_in', 'takeaway', 'delivery', 'room_service', 'pre_order']),
  outletId: z.string().uuid(),
  stationToken: z.string().max(120).optional(),
  stationLabel: z.string().max(120).optional(),
  customerName: z.string().min(1).max(120),
  customerPhone: z.string().min(5).max(32),
  paymentProvider: z.enum(['telebirr', 'cbe_birr', 'chapa', 'cash', 'room_charge']),
  pickupScheduledFor: z.string().max(120).optional(),
  idempotencyKey: z.string().min(4).max(120).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variationId: z.string().uuid().optional(),
        selectedModifierOptionIds: z.array(z.string().uuid()).default([]),
        quantity: z.number().int().min(1).max(50),
        notes: z.string().max(240).optional(),
      })
    )
    .min(1)
    .max(50),
});

// Server-authoritative transactional checkout
publicAndWorkerRouter.post(
  '/public/storefronts/:slug/checkout',
  publicWriteLimiter,
  async (req, res, next) => {
    try {
      const parsed = checkoutSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid checkout payload', issues: parsed.error.issues });
        return;
      }

      const data = parsed.data;
      const slug = req.params.slug;
      const stationHash = data.stationToken ? sha256Hex(data.stationToken) : null;
      const target = await resolvePublicStorefrontTarget(slug, stationHash);
      if (!target) {
        res.status(404).json({ error: 'Storefront not found' });
        return;
      }

      const idempKey =
        (typeof req.headers['idempotency-key'] === 'string' && req.headers['idempotency-key']) ||
        data.idempotencyKey ||
        `chk_${generateOpaqueToken(12)}`;

      const outcome = await withTenantTransaction(target.tenantId, async (tx) => {
        // Idempotent replay check
        const [existingOrder] = await tx
          .select()
          .from(orders)
          .where(eq(orders.idempotencyKey, idempKey))
          .limit(1);
        if (existingOrder) {
          return { replayed: true, order: existingOrder, paymentMessage: 'Order already recorded.' };
        }

        const [tenant] = await tx.select().from(tenants).limit(1);
        if (!tenant) throw new Error('Tenant not found');
        if (!tenant.allowedWorkflows.includes(data.workflow)) {
          throw new Error(`BAD_REQ:Workflow ${data.workflow} is not enabled for this business`);
        }

        const [outlet] = await tx
          .select()
          .from(outlets)
          .where(and(eq(outlets.id, data.outletId), isNull(outlets.deletedAt)))
          .limit(1);
        if (!outlet) throw new Error('BAD_REQ:Outlet not found');

        const normalizedPhone = data.customerPhone.replace(/\s+/g, '');
        let [customer] = await tx
          .select()
          .from(customers)
          .where(and(eq(customers.phoneE164, normalizedPhone), isNull(customers.deletedAt)))
          .limit(1);

        if (!customer) {
          [customer] = await tx
            .insert(customers)
            .values({
              tenantId: target.tenantId,
              fullName: data.customerName.trim(),
              phoneE164: normalizedPhone,
            })
            .returning();
        }

        // Compute authoritative BigInt minor-unit prices & lock tracked inventory rows
        let subtotalMinor = 0n;
        const resolvedLines: Array<{
          productId: string;
          variationId: string | null;
          productName: string;
          variationName: string | null;
          quantity: number;
          unitBaseMinor: bigint;
          variationDeltaMinor: bigint;
          modifiersTotalMinor: bigint;
          unitTotalMinor: bigint;
          lineTotalMinor: bigint;
          notes: string | null;
          inventoryItemId: string | null;
          modifiers: Array<{
            modifierGroupId: string;
            modifierOptionId: string;
            groupName: string;
            optionName: string;
            priceDeltaMinor: bigint;
          }>;
        }> = [];

        for (const item of data.items) {
          const [prod] = await tx
            .select()
            .from(products)
            .where(
              and(
                eq(products.id, item.productId),
                eq(products.outletId, outlet.id),
                isNull(products.deletedAt)
              )
            )
            .limit(1);
          if (!prod) throw new Error('BAD_REQ:Product not available in selected outlet');
          if (prod.availabilityStatus === 'sold_out') {
            throw new Error(`CONFLICT:${prod.nameJson.en} is currently sold out`);
          }

          let variationDeltaMinor = 0n;
          let variationName: string | null = null;
          if (item.variationId) {
            const [variation] = await tx
              .select()
              .from(productVariations)
              .where(
                and(
                  eq(productVariations.id, item.variationId),
                  eq(productVariations.productId, prod.id),
                  isNull(productVariations.deletedAt)
                )
              )
              .limit(1);
            if (!variation) throw new Error('BAD_REQ:Invalid product variation');
            variationDeltaMinor = variation.priceDeltaMinor;
            variationName = variation.nameJson.en;
          }

          let modifiersTotalMinor = 0n;
          const resolvedMods: (typeof resolvedLines)[number]['modifiers'] = [];
          for (const optId of item.selectedModifierOptionIds) {
            const [optRow] = await tx
              .select({
                optionId: modifierOptions.id,
                groupId: modifierOptions.modifierGroupId,
                optName: modifierOptions.nameJson,
                delta: modifierOptions.priceDeltaMinor,
                avail: modifierOptions.isAvailable,
                groupName: modifierGroups.nameJson,
              })
              .from(modifierOptions)
              .innerJoin(modifierGroups, eq(modifierGroups.id, modifierOptions.modifierGroupId))
              .where(and(eq(modifierOptions.id, optId), isNull(modifierOptions.deletedAt)))
              .limit(1);
            if (!optRow || !optRow.avail) {
              throw new Error('CONFLICT:Selected modifier option is unavailable');
            }
            modifiersTotalMinor += optRow.delta;
            resolvedMods.push({
              modifierGroupId: optRow.groupId,
              modifierOptionId: optRow.optionId,
              groupName: optRow.groupName.en,
              optionName: optRow.optName.en,
              priceDeltaMinor: optRow.delta,
            });
          }

          // Lock tracked inventory row (SELECT ... FOR UPDATE)
          const invLockRes = await tx.execute(
            sql`SELECT id, available_qty, reserved_qty, track_stock
                FROM inventory_items
                WHERE tenant_id = ${target.tenantId}::uuid
                  AND product_id = ${prod.id}::uuid
                  AND variation_id IS NULL
                FOR UPDATE`
          );
          const invRow = invLockRes.rows[0] as
            | { id: string; available_qty: number; reserved_qty: number; track_stock: boolean }
            | undefined;

          if (invRow && invRow.track_stock) {
            if (invRow.available_qty < item.quantity) {
              throw new Error(`CONFLICT:Insufficient stock for ${prod.nameJson.en}`);
            }
          }

          const unitTotalMinor = prod.basePriceMinor + variationDeltaMinor + modifiersTotalMinor;
          const lineTotalMinor = unitTotalMinor * BigInt(item.quantity);
          subtotalMinor += lineTotalMinor;

          resolvedLines.push({
            productId: prod.id,
            variationId: item.variationId || null,
            productName: prod.nameJson.en,
            variationName,
            quantity: item.quantity,
            unitBaseMinor: prod.basePriceMinor,
            variationDeltaMinor,
            modifiersTotalMinor,
            unitTotalMinor,
            lineTotalMinor,
            notes: item.notes?.trim() || null,
            inventoryItemId: invRow && invRow.track_stock ? invRow.id : null,
            modifiers: resolvedMods,
          });
        }

        const taxMinor = calculateTaxMinorHalfUp(subtotalMinor, tenant.defaultTaxRateBps);
        const totalMinor = subtotalMinor + taxMinor;
        const orderNumber = `AM-${Math.floor(1000 + Math.random() * 8999)}`;

        const adapter = getPaymentAdapter(data.paymentProvider as PaymentProviderId);
        const isImmediateOffline =
          data.paymentProvider === 'cash' || data.paymentProvider === 'room_charge';
        const initialPaymentStatus =
          data.paymentProvider === 'room_charge' ? 'charge_to_room' : 'pending';

        const [createdOrder] = await tx
          .insert(orders)
          .values({
            tenantId: target.tenantId,
            branchId: outlet.branchId,
            outletId: outlet.id,
            qrStationId: target.stationId,
            customerId: customer.id,
            orderNumber,
            workflow: data.workflow,
            status: 'new',
            paymentProvider: data.paymentProvider,
            paymentStatus: initialPaymentStatus,
            currencyCode: tenant.operatingCurrency,
            subtotalMinor,
            taxMinor,
            discountMinor: 0n,
            totalMinor,
            taxRateBps: tenant.defaultTaxRateBps,
            customerNameSnapshot: data.customerName.trim(),
            customerPhoneSnapshot: normalizedPhone,
            stationLabelSnapshot: target.stationLabel || data.stationLabel || null,
            pickupScheduledFor: data.pickupScheduledFor || null,
            idempotencyKey: idempKey,
          })
          .returning();

        for (const line of resolvedLines) {
          const [createdItem] = await tx
            .insert(orderItems)
            .values({
              tenantId: target.tenantId,
              orderId: createdOrder.id,
              productId: line.productId,
              variationId: line.variationId,
              productNameSnapshot: line.productName,
              variationNameSnapshot: line.variationName,
              quantity: line.quantity,
              unitBaseMinor: line.unitBaseMinor,
              variationDeltaMinor: line.variationDeltaMinor,
              modifiersTotalMinor: line.modifiersTotalMinor,
              unitTotalMinor: line.unitTotalMinor,
              lineTotalMinor: line.lineTotalMinor,
              currencyCode: tenant.operatingCurrency,
              notes: line.notes,
            })
            .returning();

          for (const mod of line.modifiers) {
            await tx.insert(orderItemModifiers).values({
              tenantId: target.tenantId,
              orderItemId: createdItem.id,
              modifierGroupId: mod.modifierGroupId,
              modifierOptionId: mod.modifierOptionId,
              groupNameSnapshot: mod.groupName,
              optionNameSnapshot: mod.optionName,
              priceDeltaMinor: mod.priceDeltaMinor,
              currencyCode: tenant.operatingCurrency,
            });
          }

          if (line.inventoryItemId) {
            const [inv] = await tx
              .select()
              .from(inventoryItems)
              .where(eq(inventoryItems.id, line.inventoryItemId))
              .limit(1);

            if (inv) {
              const afterAvail = inv.availableQty - line.quantity;
              if (isImmediateOffline) {
                // Direct consumption for cash/room_charge (no active reservation)
                await tx
                  .update(inventoryItems)
                  .set({ availableQty: afterAvail, updatedAt: new Date() })
                  .where(eq(inventoryItems.id, inv.id));

                await tx.insert(inventoryMovements).values({
                  tenantId: target.tenantId,
                  inventoryItemId: inv.id,
                  orderId: createdOrder.id,
                  movementType: 'deduct_direct',
                  availableDelta: -line.quantity,
                  reservedDelta: 0,
                  availableAfter: afterAvail,
                  reservedAfter: inv.reservedQty,
                  reason: `Checkout ${orderNumber}`,
                });
              } else {
                // Asynchronous online payment: reserve stock until webhook/expiry
                const afterRes = inv.reservedQty + line.quantity;
                await tx
                  .update(inventoryItems)
                  .set({
                    availableQty: afterAvail,
                    reservedQty: afterRes,
                    updatedAt: new Date(),
                  })
                  .where(eq(inventoryItems.id, inv.id));

                await tx.insert(inventoryReservations).values({
                  tenantId: target.tenantId,
                  inventoryItemId: inv.id,
                  orderId: createdOrder.id,
                  quantity: line.quantity,
                  status: 'active',
                  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
                });

                await tx.insert(inventoryMovements).values({
                  tenantId: target.tenantId,
                  inventoryItemId: inv.id,
                  orderId: createdOrder.id,
                  movementType: 'reserve',
                  availableDelta: -line.quantity,
                  reservedDelta: line.quantity,
                  availableAfter: afterAvail,
                  reservedAfter: afterRes,
                  reason: `Reserved for ${orderNumber}`,
                });
              }
            }
          }
        }

        const payInit = await adapter.initiatePayment({
          tenantId: target.tenantId,
          orderId: createdOrder.id,
          orderNumber: createdOrder.orderNumber,
          amountMinor: totalMinor,
          currencyCode: tenant.operatingCurrency,
          idempotencyKey: idempKey,
        });

        await tx.insert(paymentTransactions).values({
          tenantId: target.tenantId,
          orderId: createdOrder.id,
          provider: data.paymentProvider,
          mode: payInit.mode,
          status: payInit.status,
          amountMinor: totalMinor,
          currencyCode: tenant.operatingCurrency,
          providerReference: payInit.providerReference,
          checkoutUrl: payInit.checkoutUrl,
          idempotencyKey: idempKey,
        });

        // Award coffee loyalty stamp if enabled
        if (tenant.enabledCapabilities.includes('coffee_loyalty')) {
          let [la] = await tx
            .select()
            .from(loyaltyAccounts)
            .where(eq(loyaltyAccounts.customerId, customer.id))
            .limit(1);
          if (!la) {
            [la] = await tx
              .insert(loyaltyAccounts)
              .values({
                tenantId: target.tenantId,
                customerId: customer.id,
                stampsBalance: 1,
                targetStamps: 8,
                lifetimeSpentMinor: totalMinor,
                currencyCode: tenant.operatingCurrency,
              })
              .returning();
          } else {
            await tx
              .update(loyaltyAccounts)
              .set({
                stampsBalance: la.stampsBalance + 1,
                lifetimeSpentMinor: la.lifetimeSpentMinor + totalMinor,
                updatedAt: new Date(),
              })
              .where(eq(loyaltyAccounts.id, la.id));
          }
          await tx.insert(loyaltyLedger).values({
            tenantId: target.tenantId,
            loyaltyAccountId: la.id,
            orderId: createdOrder.id,
            stampsDelta: 1,
            reason: `Order ${orderNumber}`,
          });
        }

        return {
          replayed: false,
          order: createdOrder,
          outletName: outlet.nameJson.en,
          paymentMessage: payInit.message,
          paymentMode: payInit.mode,
          providerReference: payInit.providerReference,
        };
      });

      res.status(outcome.replayed ? 200 : 201).json({
        order: {
          id: outcome.order.id,
          orderNumber: outcome.order.orderNumber,
          createdAt: 'Just now',
          workflow: outcome.order.workflow,
          outletId: outcome.order.outletId,
          outletName: outcome.outletName || '',
          stationLabel: outcome.order.stationLabelSnapshot || undefined,
          customerName: outcome.order.customerNameSnapshot,
          customerPhone: outcome.order.customerPhoneSnapshot,
          paymentProvider: outcome.order.paymentProvider,
          paymentStatus: outcome.order.paymentStatus,
          status: outcome.order.status,
          totalMinor: outcome.order.totalMinor.toString(),
          totalEtb: minorToEtb(outcome.order.totalMinor),
        },
        paymentMode: outcome.paymentMode,
        paymentMessage: outcome.paymentMessage,
        providerReference: outcome.providerReference,
      });
    } catch (err) {
      if (err instanceof Error) {
        if (err.message.startsWith('CONFLICT:')) {
          res.status(409).json({ error: err.message.replace('CONFLICT:', '') });
          return;
        }
        if (err.message.startsWith('BAD_REQ:')) {
          res.status(400).json({ error: err.message.replace('BAD_REQ:', '') });
          return;
        }
      }
      next(err);
    }
  }
);

publicAndWorkerRouter.post(
  '/public/storefronts/:slug/special-requests',
  publicWriteLimiter,
  async (req, res, next) => {
    try {
      const schema = z.object({
        kind: z.enum(['table_reservation', 'custom_cake', 'coffee_ceremony', 'room_amenity']),
        outletId: z.string().uuid().optional(),
        customerName: z.string().min(1).max(120),
        customerPhone: z.string().min(5).max(32),
        dateTime: z.string().min(1).max(120),
        partyOrSize: z.string().max(80).default('Standard'),
        details: z.string().max(500).default('Submitted via storefront'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid special request payload' });
        return;
      }

      const target = await resolvePublicStorefrontTarget(req.params.slug, null);
      if (!target) {
        res.status(404).json({ error: 'Storefront not found' });
        return;
      }

      const created = await withTenantTransaction(target.tenantId, async (tx) => {
        const [outlet] = parsed.data.outletId
          ? await tx.select().from(outlets).where(eq(outlets.id, parsed.data.outletId)).limit(1)
          : await tx.select().from(outlets).where(isNull(outlets.deletedAt)).limit(1);

        if (!outlet) throw new Error('No active outlet found');

        const [sr] = await tx
          .insert(specialRequests)
          .values({
            tenantId: target.tenantId,
            branchId: outlet.branchId,
            outletId: outlet.id,
            kind: parsed.data.kind,
            customerName: parsed.data.customerName.trim(),
            customerPhone: parsed.data.customerPhone.replace(/\s+/g, ''),
            requestedDateTime: parsed.data.dateTime.trim(),
            partyOrSize: parsed.data.partyOrSize.trim() || 'Standard',
            details: parsed.data.details.trim() || 'Submitted via storefront',
            status: 'pending',
            currencyCode: 'ETB',
          })
          .returning();
        return sr;
      });

      res.status(201).json({ requestId: created.id, status: created.status });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================================
// IDEMPOTENT PAYMENT WEBHOOKS (ADR-001)
// ============================================================================

publicAndWorkerRouter.post('/webhooks/payments/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider as PaymentProviderId;
    if (!['chapa', 'telebirr', 'cbe_birr'].includes(provider)) {
      res.status(400).json({ error: 'Unsupported webhook payment provider' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body || {}), 'utf8');

    const adapter = getPaymentAdapter(provider);
    const verified = adapter.verifyWebhook(rawBody, req.headers);

    if (!verified.verified) {
      res.status(401).json({ error: verified.reason || 'Webhook signature rejected' });
      return;
    }

    // Resolve tenant + transaction via SECURITY DEFINER lookup under FORCE RLS
    const lookupRes = await db.execute(
      sql`SELECT id, tenant_id, order_id, status
          FROM resolve_payment_tx_by_ref(${provider}, ${verified.providerReference})`
    );

    const txRef = lookupRes.rows[0] as
      | { id: string; tenant_id: string; order_id: string; status: string }
      | undefined;

    if (!txRef) {
      res.status(404).json({ error: 'Referenced payment transaction not found' });
      return;
    }

    const result = await withTenantTransaction(txRef.tenant_id, async (tx) => {
      // Idempotency check on (provider, provider_event_id)
      const [existingEvt] = await tx
        .select()
        .from(paymentWebhookEvents)
        .where(
          and(
            eq(paymentWebhookEvents.provider, provider),
            eq(paymentWebhookEvents.providerEventId, verified.providerEventId)
          )
        )
        .limit(1);

      if (existingEvt) {
        return { duplicate: true };
      }

      await tx.insert(paymentWebhookEvents).values({
        tenantId: txRef.tenant_id,
        paymentTransactionId: txRef.id,
        provider,
        providerEventId: verified.providerEventId,
        eventType: verified.eventType,
        signatureVerified: true,
        payloadJsonb: JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>,
        processedAt: new Date(),
      });

      if (verified.eventType === 'payment.succeeded') {
        await tx
          .update(paymentTransactions)
          .set({ status: 'paid', settledAt: new Date() })
          .where(eq(paymentTransactions.id, txRef.id));

        await tx
          .update(orders)
          .set({ paymentStatus: 'paid' })
          .where(eq(orders.id, txRef.order_id));

        // Consume active reservations: availableDelta = 0, reservedDelta = -qty (NEVER double-deduct available!)
        const activeResRows = await tx
          .select()
          .from(inventoryReservations)
          .where(
            and(
              eq(inventoryReservations.orderId, txRef.order_id),
              eq(inventoryReservations.status, 'active')
            )
          );

        for (const r of activeResRows) {
          const [inv] = await tx
            .select()
            .from(inventoryItems)
            .where(eq(inventoryItems.id, r.inventoryItemId))
            .limit(1);

          if (inv) {
            const afterReserved = Math.max(0, inv.reservedQty - r.quantity);
            await tx
              .update(inventoryItems)
              .set({ reservedQty: afterReserved, updatedAt: new Date() })
              .where(eq(inventoryItems.id, inv.id));

            await tx
              .update(inventoryReservations)
              .set({ status: 'consumed', resolvedAt: new Date() })
              .where(eq(inventoryReservations.id, r.id));

            await tx.insert(inventoryMovements).values({
              tenantId: txRef.tenant_id,
              inventoryItemId: inv.id,
              orderId: txRef.order_id,
              movementType: 'deduct_reserved',
              availableDelta: 0,
              reservedDelta: -r.quantity,
              availableAfter: inv.availableQty,
              reservedAfter: afterReserved,
              reason: `Webhook ${verified.providerEventId}`,
            });
          }
        }
      } else if (verified.eventType === 'payment.failed') {
        await tx
          .update(paymentTransactions)
          .set({ status: 'failed' })
          .where(eq(paymentTransactions.id, txRef.id));
        await tx
          .update(orders)
          .set({ paymentStatus: 'failed' })
          .where(eq(orders.id, txRef.order_id));
      }

      return { duplicate: false };
    });

    res.json({ ok: true, duplicate: result.duplicate });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// INVENTORY EXPIRY WORKER (ADR-003: FOR UPDATE SKIP LOCKED)
// ============================================================================

publicAndWorkerRouter.post('/internal/workers/expire-reservations', async (req, res, next) => {
  try {
    const expectedSecret = process.env.INTERNAL_WORKER_SECRET || 'amal_dev_worker_secret';
    const providedSecret = req.headers['x-worker-secret'];
    if (
      typeof providedSecret !== 'string' ||
      !constantTimeEqual(providedSecret, expectedSecret)
    ) {
      res.status(401).json({ error: 'Unauthorized internal worker call' });
      return;
    }

    // Group expired reservations per tenant using SECURITY DEFINER function, then settle per-tenant via RLS
    const expiredCandidates = await db.execute(
      sql`SELECT tenant_id FROM list_tenants_with_expired_reservations()`
    );

    let expiredCount = 0;

    for (const row of expiredCandidates.rows as Array<{ tenant_id: string }>) {
      const countForTenant = await withTenantTransaction(row.tenant_id, async (tx) => {
        const locked = await tx.execute(
          sql`SELECT id, inventory_item_id, order_id, quantity
              FROM inventory_reservations
              WHERE status = 'active' AND expires_at <= NOW()
              FOR UPDATE SKIP LOCKED`
        );

        let processed = 0;
        for (const r of locked.rows as Array<{
          id: string;
          inventory_item_id: string;
          order_id: string;
          quantity: number;
        }>) {
          const updatedRes = await tx
            .update(inventoryReservations)
            .set({ status: 'expired', resolvedAt: new Date() })
            .where(
              and(
                eq(inventoryReservations.id, r.id),
                eq(inventoryReservations.status, 'active'),
                lte(inventoryReservations.expiresAt, new Date())
              )
            )
            .returning({ id: inventoryReservations.id });

          if (updatedRes.length === 0) continue;

          const [inv] = await tx
            .select()
            .from(inventoryItems)
            .where(eq(inventoryItems.id, r.inventory_item_id))
            .limit(1);

          if (inv) {
            const afterAvail = inv.availableQty + r.quantity;
            const afterReserved = Math.max(0, inv.reservedQty - r.quantity);
            await tx
              .update(inventoryItems)
              .set({
                availableQty: afterAvail,
                reservedQty: afterReserved,
                updatedAt: new Date(),
              })
              .where(eq(inventoryItems.id, inv.id));

            await tx.insert(inventoryMovements).values({
              tenantId: row.tenant_id,
              inventoryItemId: inv.id,
              orderId: r.order_id,
              movementType: 'expire',
              availableDelta: r.quantity,
              reservedDelta: -r.quantity,
              availableAfter: afterAvail,
              reservedAfter: afterReserved,
              reason: 'Reservation TTL expired',
            });
          }
          processed++;
        }
        return processed;
      });
      expiredCount += countForTenant;
    }

    res.json({ ok: true, expiredCount });
  } catch (err) {
    next(err);
  }
});

// ============================================================================
// PLATFORM GOVERNANCE CONSOLE (MILESTONE 5 — AUDITED, NEVER BYPASSES RLS)
// ============================================================================

publicAndWorkerRouter.get(
  '/platform/tenants',
  requireAuth,
  requirePlatformAdmin,
  async (_req, res, next) => {
    try {
      const rows = await db.execute(
        sql`SELECT tenant_id, slug, business_name, primary_business_type, plan_tier, subscription_status, vat_registered, created_at
            FROM list_platform_tenant_summaries()`
      );
      res.json({ tenants: rows.rows });
    } catch (err) {
      next(err);
    }
  }
);

publicAndWorkerRouter.post(
  '/platform/impersonate',
  requireAuth,
  verifyCsrf,
  requirePlatformAdmin,
  async (req, res, next) => {
    try {
      const schema = z.object({
        targetTenantId: z.string().uuid(),
        reason: z.string().min(5).max(300),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'targetTenantId and audit reason (min 5 chars) required' });
        return;
      }

      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await db.insert(platformAdminImpersonationLogs).values({
        adminUserId: req.auth!.userId,
        targetTenantId: parsed.data.targetTenantId,
        reason: parsed.data.reason.trim(),
        mode: 'read_only',
        expiresAt,
      });

      await withTenantTransaction(parsed.data.targetTenantId, async (tx) => {
        await tx.insert(auditLogs).values({
          tenantId: parsed.data.targetTenantId,
          actorUserId: req.auth!.userId,
          action: 'platform_admin.impersonation_started',
          resourceType: 'tenant',
          resourceId: parsed.data.targetTenantId,
          metadataJsonb: { reason: parsed.data.reason.trim(), mode: 'read_only' },
          ipAddress: req.ip || null,
        });
      });

      await db
        .update(userSessions)
        .set({ activeTenantId: parsed.data.targetTenantId })
        .where(eq(userSessions.id, req.auth!.sessionId));

      res.json({ ok: true, mode: 'read_only', expiresAt: expiresAt.toISOString() });
    } catch (err) {
      next(err);
    }
  }
);

// Keep branches import referenced for future branch schedule endpoints
void branches;
