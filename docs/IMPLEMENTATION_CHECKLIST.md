# AMAL — Implementation Checklist & Architecture Status

Last verified against codebase & live PostgreSQL 15 instance: **2026-11-22**

---

## 1. PostgreSQL & Environment Configuration Status

### Completed
- [x] **PostgreSQL 15 Role Separation**:
  - `amal_app` (`NOSUPERUSER`, `NOBYPASSRLS`, `CANLOGIN`) configured for runtime application queries so all tenant-scoped Row-Level Security policies are strictly enforced.
  - `amal_admin` configured as schema owner for migrations and seeding only.
- [x] **Schema & Row-Level Security Applied**:
  - **38 tables** provisioned in `public` schema (`src/db/schema.ts`), including composite foreign keys (`tenant_id`, `branch_id`, `outlet_id`) and fixed-point `BIGINT` *santim* monetary storage.
  - **33 tenant-owned tables** protected with `FORCE ROW LEVEL SECURITY` (`src/db/rls.sql`) bound to transaction-scoped `app.current_tenant_id`.
  - **6 `SECURITY DEFINER` helpers** (`resolve_public_storefront_context`, `list_user_tenant_memberships`, `list_platform_tenant_summaries`, `resolve_staff_invitation_by_hash`, `resolve_payment_tx_by_ref`, `list_tenants_with_expired_reservations`) restricted to `amal_app` with pinned `search_path = pg_catalog, public`.
  - Append-only hardening on `audit_logs`, `inventory_movements`, `loyalty_ledger`, `platform_admin_impersonation_logs`, and read-only `roles` for `amal_app`.
- [x] **Versioned Drizzle Migration Baseline (`drizzle/`, `src/db/migrate.ts`)**:
  - `drizzle/0000_initial_baseline.sql` + `drizzle/meta/_journal.json` + `0000_snapshot.json` generated and verified via `npm run db:check`.
  - Baselined on `amal_dev` and `amal_test` without overwriting data (`npm run db:baseline` / `npm run db:migrate` / `npm run db:status`).
- [x] **Cloud SQL TLS / Pooling Configuration (`src/db/index.ts`, `src/db/drizzle.config.ts`)**:
  - Added configurable `SQL_SSL`, `SQL_SSL_REJECT_UNAUTHORIZED`, and `PG_POOL_MAX`.
- [x] **Seed Data Populated (`src/db/seed.ts`)**:
  - 5 canonical RBAC roles (`tenant_owner`, `tenant_manager`, `branch_manager`, `outlet_staff`, `kitchen_staff`).
  - All 7 Ethiopian hospitality industry presets (`traditional_ethiopian`, `coffee_house`, `restaurant`, `hotel`, `juice_bar`, `fast_food`, `bakery`), 27 products, and 15 QR stations.
  - Seeded operator accounts (`demo@amal.hospitality` and `admin@amal.hospitality`).

### Remaining Database & Environment Configuration Tasks
- [ ] **Create `.env` for Non-Default Credentials**: `SQL_*`, `QR_ENCRYPTION_KEY_HEX`, and `INTERNAL_WORKER_SECRET` currently fall back to local dev defaults when `.env` is absent. Populate a private `.env` (excluded from Git via `.gitignore`) and generate a 32-byte hex `QR_ENCRYPTION_KEY_HEX` before deploying with `NODE_ENV=production` (strictly required in production).
- [ ] **Production `amal_prod` Provisioning**: Provision Cloud SQL PostgreSQL instance (after explicit approval), run `npm run db:migrate` + `npm run db:seed` (`CANONICAL_ROLES`), enable automated backups + PITR, and store secrets in Google Cloud Secret Manager. See `docs/DATABASE_AND_CLOUD_SQL.md`.

---

## 2. Milestone Implementation Checklist

### Milestone 1 — Core Foundation, Multi-Tenant DB & Auth Security
- [x] PostgreSQL schema with composite tenant/branch/outlet foreign keys (`src/db/schema.ts`)
- [x] `FORCE ROW LEVEL SECURITY` + transaction-scoped `withTenantTransaction()` (`server/db/tenantTx.ts`)
- [x] Argon2id password hashing (`@node-rs/argon2`)
- [x] Rotating HTTP-only session cookies with token-family theft revocation (`server/services/authService.ts`)
- [x] Double-submit / memory-bound `X-CSRF-Token` + `Origin` verification (`server/middleware/auth.ts`)
- [x] Password reset request & confirm flow (`POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`, plus `?resetToken=` modal UX)
- [x] Multi-tenant switching (`POST /auth/switch-tenant`)

### Milestone 2 — Catalog, Variations, Modifiers, Branches & QR Security
- [x] Multi-outlet & multi-category catalog with `en` / `am` / `om` localized JSONB fields
- [x] Product variations, modifier groups/options, and midnight-crossing IANA timezone schedule evaluation
- [x] Multi-branch creation (`POST /tenants/current/branches`) enforcing `maxBranches` plan limits and 7-day `branch_operating_hours`
- [x] Outlet creation (`POST /tenants/current/outlets`) enforcing `maxOutlets` and branch ownership
- [x] AES-256-GCM encrypted QR station tokens with immediate invalidation on rotation (`POST /tenants/current/qr-stations/:stationId/rotate`)
- [ ] **Remaining**: UI/API editing & archiving of existing products, modifier groups, and custom branch operating hours post-onboarding

### Milestone 3 — Server-Authoritative Ordering, Inventory Concurrency & Special Requests
- [x] Fixed-point `BigInt` *santim* pricing & half-up VAT calculation ignoring tampered client prices
- [x] `SELECT ... FOR UPDATE` row-locked inventory reservations + restock movement ledger
- [x] Secured reservation expiry worker (`POST /api/v1/internal/workers/expire-reservations`) using `FOR UPDATE SKIP LOCKED`
- [x] Public special requests submission (`POST /public/storefronts/:slug/special-requests`) & authenticated merchant status management (`PATCH /tenants/current/special-requests/:requestId`)
- [ ] **Remaining**: Merchant KDS/checkout loyalty stamp crediting & redemption endpoint/UI; deploy Cloud Scheduler job targeting `/api/v1/internal/workers/expire-reservations`

### Milestone 4 — Scoped RBAC, Payments (ADR-001) & Storefront/Dashboard Wiring
- [x] Scoped RBAC (`tenant`, `branch`, `outlet`) with normalized `staff_invitation_branch_scopes` / `staff_invitation_outlet_scopes`
- [x] Staff list (`workspace.staff` hydration + `GET /api/v1/staff`), scoped invite UI (`MerchantDashboard`), and `?inviteToken=` acceptance banner (`App.tsx`)
- [x] Payment adapter guardrails (`PAYMENT_MODE=disabled` default for `chapa`, `telebirr`, `cbe_birr`; offline `cash` and `room_charge` active; signed idempotent webhook verification in `sandbox` test mode)
- [x] Safe non-PII legacy `localStorage` blueprint import (`POST /tenants/current/import-local-blueprint`)
- [ ] **Remaining**: Official KYB registration, sandbox/live credentials, and verified webhook signature schemes for Chapa, Telebirr, and CBE Birr (before switching `PAYMENT_MODE` away from `disabled`)
- [ ] **Remaining**: Production transactional email provider (SMTP / Resend / SES) implementing `NotificationAdapter` (`server/services/notificationAdapter.ts`)

### Milestone 5 — Platform Governance & Production Hardening
- [x] Platform admin governance endpoints (`GET /platform/tenants`, `POST /platform/impersonate` with read-only audit log)
- [x] Express + Vite unified server entrypoint (`server.ts`) with `helmet`, rate limiting, `/api/v1/health`, and raw-body webhook middleware
- [ ] **Remaining**: Frontend UI console for `platform_admin` / `platform_support_ro` accounts (`GET /platform/tenants`, audited read-only impersonation)
- [ ] **Remaining**: Automated CI pipeline running `tsc --noEmit`, `vite build`, and Vitest integration suite against isolated Postgres

---

## 3. Verified Automated Test Suites (`npm test`)

- `tests/migration-and-rls-baseline.test.ts` — Fresh empty-DB Drizzle migration, existing-schema idempotency, `amal_app` RLS/role restrictions, `SECURITY DEFINER` `search_path`, and `max: 1` pool reset
- `tests/tenant-isolation.test.ts` — RLS isolation across `amal_app` & `max: 1` pool reuse
- `tests/branch-outlet-consistency.test.ts` — Composite `(tenant_id, branch_id, outlet_id)` FK enforcement
- `tests/auth-security.test.ts` — Argon2id, CSRF enforcement, rotating cookie theft detection, password reset
- `tests/rbac-scoping.test.ts` — Normalized outlet-scoped staff invitation, filtered reads, `403` cross-outlet writes
- `tests/branches-and-requests.test.ts` — Multi-branch plan limits, `workspace.staff` hydration, outlet-scoped special-request updates
- `tests/qr-security.test.ts` — AES-256-GCM encryption & rotation invalidation
- `tests/modifiers-and-scheduling.test.ts` — Server-side modifier pricing & midnight-crossing schedules
- `tests/pricing-precision.test.ts` — Tampered client total rejection & BigInt VAT precision
- `tests/inventory-concurrency.test.ts` — Concurrent checkout oversell protection & expiry worker
- `tests/payment-webhooks.test.ts` — ADR-001 `disabled` mode guardrails & idempotent signed sandbox webhooks
