CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"metadata_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_operating_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"day_of_week" smallint NOT NULL,
	"period_index" smallint DEFAULT 0 NOT NULL,
	"open_time" time NOT NULL,
	"close_time" time NOT NULL,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "uq_boh_branch_day_period" UNIQUE("tenant_id","branch_id","day_of_week","period_index"),
	CONSTRAINT "chk_boh_day" CHECK ("branch_operating_hours"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "chk_boh_period" CHECK ("branch_operating_hours"."period_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "branch_schedule_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"open_time" time,
	"close_time" time,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	CONSTRAINT "chk_bso_date_range" CHECK ("branch_schedule_overrides"."end_date" >= "branch_schedule_overrides"."start_date")
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"neighborhood" text NOT NULL,
	"phone" text NOT NULL,
	"whatsapp_number" text NOT NULL,
	"timezone" text DEFAULT 'Africa/Addis_Ababa' NOT NULL,
	"display_hours" text DEFAULT '08:00 – 22:00 Daily' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_branches_tenant_id" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"preferred_language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_customers_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "chk_customers_lang" CHECK ("customers"."preferred_language" IN ('en', 'am', 'om'))
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variation_id" uuid,
	"available_qty" integer DEFAULT 0 NOT NULL,
	"reserved_qty" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 5 NOT NULL,
	"track_stock" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_inv_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "chk_inv_qty_nonneg" CHECK ("inventory_items"."available_qty" >= 0 AND "inventory_items"."reserved_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"order_id" uuid,
	"movement_type" text NOT NULL,
	"available_delta" integer NOT NULL,
	"reserved_delta" integer NOT NULL,
	"available_after" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"actor_user_id" uuid,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_im_type" CHECK ("inventory_movements"."movement_type" IN ('restock','reserve','deduct_reserved','deduct_direct','release','expire','adjustment'))
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "chk_ir_qty_pos" CHECK ("inventory_reservations"."quantity" > 0),
	CONSTRAINT "chk_ir_status" CHECK ("inventory_reservations"."status" IN ('active','consumed','released','expired'))
);
--> statement-breakpoint
CREATE TABLE "loyalty_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"stamps_balance" integer DEFAULT 0 NOT NULL,
	"target_stamps" integer DEFAULT 8 NOT NULL,
	"favorite_product_id" uuid,
	"lifetime_spent_minor" bigint DEFAULT 0 NOT NULL,
	"currency_code" char(3) DEFAULT 'ETB' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_la_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_la_tenant_customer" UNIQUE("tenant_id","customer_id"),
	CONSTRAINT "chk_la_stamps_nonneg" CHECK ("loyalty_accounts"."stamps_balance" >= 0 AND "loyalty_accounts"."target_stamps" > 0)
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"loyalty_account_id" uuid NOT NULL,
	"order_id" uuid,
	"stamps_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name_json" jsonb NOT NULL,
	"description_json" jsonb,
	"regional_origin" text,
	"is_fasting_friendly" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_mc_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_mc_tenant_outlet_id" UNIQUE("tenant_id","outlet_id","id")
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name_json" jsonb NOT NULL,
	"active_start_time" time,
	"active_end_time" time,
	"crosses_midnight" boolean DEFAULT false NOT NULL,
	"active_days" smallint[],
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_menus_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_menus_tenant_outlet_id" UNIQUE("tenant_id","outlet_id","id")
);
--> statement-breakpoint
CREATE TABLE "modifier_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_json" jsonb NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_mg_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "chk_mg_select_bounds" CHECK ("modifier_groups"."min_select" >= 0 AND "modifier_groups"."max_select" >= "modifier_groups"."min_select")
);
--> statement-breakpoint
CREATE TABLE "modifier_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"name_json" jsonb NOT NULL,
	"price_delta_minor" bigint DEFAULT 0 NOT NULL,
	"currency_code" char(3) DEFAULT 'ETB' NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_mo_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_mo_tenant_group_id" UNIQUE("tenant_id","modifier_group_id","id")
);
--> statement-breakpoint
CREATE TABLE "order_item_modifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"modifier_option_id" uuid NOT NULL,
	"group_name_snapshot" text NOT NULL,
	"option_name_snapshot" text NOT NULL,
	"price_delta_minor" bigint NOT NULL,
	"currency_code" char(3) DEFAULT 'ETB' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variation_id" uuid,
	"product_name_snapshot" text NOT NULL,
	"variation_name_snapshot" text,
	"quantity" integer NOT NULL,
	"unit_base_minor" bigint NOT NULL,
	"variation_delta_minor" bigint DEFAULT 0 NOT NULL,
	"modifiers_total_minor" bigint DEFAULT 0 NOT NULL,
	"unit_total_minor" bigint NOT NULL,
	"line_total_minor" bigint NOT NULL,
	"currency_code" char(3) DEFAULT 'ETB' NOT NULL,
	"notes" text,
	CONSTRAINT "uq_oi_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "chk_oi_qty_pos" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"qr_station_id" uuid,
	"customer_id" uuid,
	"order_number" text NOT NULL,
	"workflow" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"payment_provider" text NOT NULL,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"currency_code" char(3) DEFAULT 'ETB' NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"customer_name_snapshot" text NOT NULL,
	"customer_phone_snapshot" text NOT NULL,
	"station_label_snapshot" text,
	"pickup_scheduled_for" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_orders_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_orders_tenant_number" UNIQUE("tenant_id","order_number"),
	CONSTRAINT "chk_orders_workflow" CHECK ("orders"."workflow" IN ('dine_in','takeaway','delivery','room_service','pre_order')),
	CONSTRAINT "chk_orders_status" CHECK ("orders"."status" IN ('new','preparing','ready','completed','cancelled')),
	CONSTRAINT "chk_orders_payment_provider" CHECK ("orders"."payment_provider" IN ('telebirr','cbe_birr','chapa','cash','room_charge')),
	CONSTRAINT "chk_orders_payment_status" CHECK ("orders"."payment_status" IN ('pending','paid','failed','refunded','charge_to_room')),
	CONSTRAINT "chk_orders_amounts_nonneg" CHECK ("orders"."subtotal_minor" >= 0 AND "orders"."tax_minor" >= 0 AND "orders"."discount_minor" >= 0 AND "orders"."total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"name_json" jsonb NOT NULL,
	"outlet_kind" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"supports_tables" boolean DEFAULT true NOT NULL,
	"supports_room_service" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_outlets_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_outlets_tenant_branch_id" UNIQUE("tenant_id","branch_id","id"),
	CONSTRAINT "chk_outlets_kind" CHECK ("outlets"."outlet_kind" IN ('dining_room','cafe_counter','room_service','bar_lounge','bakery_pickup','juice_bar','kitchen_express','cultural_hall'))
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"mode" text DEFAULT 'disabled' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency_code" char(3) DEFAULT 'ETB' NOT NULL,
	"provider_reference" text,
	"checkout_url" text,
	"idempotency_key" text NOT NULL,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "uq_pt_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_pt_tenant_idemp" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "chk_pt_mode" CHECK ("payment_transactions"."mode" IN ('disabled','sandbox','live')),
	CONSTRAINT "chk_pt_status" CHECK ("payment_transactions"."status" IN ('pending','authorized','paid','failed','refunded','disabled'))
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_transaction_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"signature_verified" boolean NOT NULL,
	"payload_jsonb" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admin_impersonation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"target_tenant_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"mode" text DEFAULT 'read_only' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_impersonation_mode" CHECK ("platform_admin_impersonation_logs"."mode" IN ('read_only', 'support_write'))
);
--> statement-breakpoint
CREATE TABLE "product_modifier_groups" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"modifier_group_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_modifier_groups_tenant_id_product_id_modifier_group_id_pk" PRIMARY KEY("tenant_id","product_id","modifier_group_id")
);
--> statement-breakpoint
CREATE TABLE "product_variations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name_json" jsonb NOT NULL,
	"price_delta_minor" bigint DEFAULT 0 NOT NULL,
	"currency_code" char(3) DEFAULT 'ETB' NOT NULL,
	"sku" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_pv_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_pv_tenant_product_id" UNIQUE("tenant_id","product_id","id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name_json" jsonb NOT NULL,
	"description_json" jsonb NOT NULL,
	"base_price_minor" bigint NOT NULL,
	"currency_code" char(3) DEFAULT 'ETB' NOT NULL,
	"dietary_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"prep_time_minutes" integer DEFAULT 10 NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_combo" boolean DEFAULT false NOT NULL,
	"fasting_day_eligible" boolean DEFAULT false NOT NULL,
	"fasting_only" boolean DEFAULT false NOT NULL,
	"time_window" text,
	"lead_time_hours" integer,
	"availability_status" text DEFAULT 'in_stock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_products_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "uq_products_tenant_outlet_id" UNIQUE("tenant_id","outlet_id","id"),
	CONSTRAINT "chk_products_base_price" CHECK ("products"."base_price_minor" >= 0),
	CONSTRAINT "chk_products_avail" CHECK ("products"."availability_status" IN ('in_stock','low_stock','sold_out','pre_order_only'))
);
--> statement-breakpoint
CREATE TABLE "qr_stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"label" text NOT NULL,
	"station_type" text NOT NULL,
	"capacity_or_zone" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" "bytea" NOT NULL,
	"token_iv" "bytea" NOT NULL,
	"token_auth_tag" "bytea" NOT NULL,
	"token_version" smallint DEFAULT 1 NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_qr_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "chk_qr_station_type" CHECK ("qr_stations"."station_type" IN ('table','room','counter','pickup_zone','mesob_table')),
	CONSTRAINT "chk_qr_status" CHECK ("qr_stations"."status" IN ('available','occupied','reserved'))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"scope_level" text NOT NULL,
	"permissions" text[] NOT NULL,
	CONSTRAINT "chk_roles_scope_level" CHECK ("roles"."scope_level" IN ('tenant', 'branch', 'outlet'))
);
--> statement-breakpoint
CREATE TABLE "special_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"customer_id" uuid,
	"kind" text NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"requested_datetime" text NOT NULL,
	"party_or_size" text NOT NULL,
	"details" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"estimated_minor" bigint,
	"currency_code" char(3) DEFAULT 'ETB' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_sr_kind" CHECK ("special_requests"."kind" IN ('table_reservation','custom_cake','coffee_ceremony','room_amenity')),
	CONSTRAINT "chk_sr_status" CHECK ("special_requests"."status" IN ('confirmed','pending','in_production','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "staff_invitation_branch_scopes" (
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	CONSTRAINT "staff_invitation_branch_scopes_tenant_id_invitation_id_branch_id_pk" PRIMARY KEY("tenant_id","invitation_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "staff_invitation_outlet_scopes" (
	"tenant_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	CONSTRAINT "staff_invitation_outlet_scopes_tenant_id_invitation_id_outlet_id_pk" PRIMARY KEY("tenant_id","invitation_id","outlet_id")
);
--> statement-breakpoint
CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invited_by_user_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"role_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_si_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "chk_si_scope_type" CHECK ("staff_invitations"."scope_type" IN ('tenant', 'branch', 'outlet'))
);
--> statement-breakpoint
CREATE TABLE "tenant_membership_branches" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_membership_branches_tenant_id_membership_id_branch_id_pk" PRIMARY KEY("tenant_id","membership_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_membership_outlets" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_membership_outlets_tenant_id_membership_id_outlet_id_pk" PRIMARY KEY("tenant_id","membership_id","outlet_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_tm_tenant_id" UNIQUE("tenant_id","id"),
	CONSTRAINT "chk_tm_scope_type" CHECK ("tenant_memberships"."scope_type" IN ('tenant', 'branch', 'outlet')),
	CONSTRAINT "chk_tm_status" CHECK ("tenant_memberships"."status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"business_name" text NOT NULL,
	"tagline" text DEFAULT '' NOT NULL,
	"operating_currency" char(3) DEFAULT 'ETB' NOT NULL,
	"primary_business_type" text NOT NULL,
	"business_types" text[] NOT NULL,
	"enabled_capabilities" text[] NOT NULL,
	"allowed_workflows" text[] NOT NULL,
	"plan_tier" text DEFAULT 'starter' NOT NULL,
	"subscription_status" text DEFAULT 'trial' NOT NULL,
	"max_branches" integer DEFAULT 1 NOT NULL,
	"max_outlets" integer DEFAULT 1 NOT NULL,
	"vat_registered" boolean DEFAULT false NOT NULL,
	"tin_number" text,
	"default_tax_rate_bps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_tenants_id_currency" UNIQUE("id","operating_currency"),
	CONSTRAINT "chk_tenants_currency" CHECK ("tenants"."operating_currency" IN ('ETB', 'USD', 'KES', 'EUR')),
	CONSTRAINT "chk_tenants_plan_tier" CHECK ("tenants"."plan_tier" IN ('starter', 'growth', 'pro', 'enterprise')),
	CONSTRAINT "chk_tenants_sub_status" CHECK ("tenants"."subscription_status" IN ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
	CONSTRAINT "chk_tenants_primary_type" CHECK ("tenants"."primary_business_type" IN ('restaurant','coffee_house','hotel','juice_bar','fast_food','bakery','traditional_ethiopian')),
	CONSTRAINT "chk_tenants_business_types_valid" CHECK (cardinality("tenants"."business_types") >= 1 AND "tenants"."business_types" <@ ARRAY['restaurant','coffee_house','hotel','juice_bar','fast_food','bakery','traditional_ethiopian']::text[]),
	CONSTRAINT "chk_tenants_tax_bps" CHECK ("tenants"."default_tax_rate_bps" >= 0 AND "tenants"."default_tax_rate_bps" <= 5000)
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"active_tenant_id" uuid,
	"token_hash" text NOT NULL,
	"csrf_token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"replaced_by_session_id" uuid,
	"ip_address" "inet",
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_normalized" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"phone_e164" text,
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"platform_role" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_users_status" CHECK ("users"."status" IN ('active', 'locked', 'disabled')),
	CONSTRAINT "chk_users_platform_role" CHECK ("users"."platform_role" IS NULL OR "users"."platform_role" IN ('platform_admin', 'platform_support_ro'))
);
--> statement-breakpoint
CREATE TABLE "website_configs" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"accent_hex" char(7) NOT NULL,
	"typography_style" text NOT NULL,
	"hero_headline_json" jsonb NOT NULL,
	"hero_subheadline_json" jsonb NOT NULL,
	"hero_image_url" text NOT NULL,
	"visible_sections" text[] NOT NULL,
	"low_bandwidth_default" boolean DEFAULT false NOT NULL,
	"default_language" text DEFAULT 'en' NOT NULL,
	"supported_languages" text[] NOT NULL,
	"accepted_payments" text[] NOT NULL,
	"whatsapp_ordering_enabled" boolean DEFAULT true NOT NULL,
	"fasting_mode_active" boolean DEFAULT false NOT NULL,
	"pms_config_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_wc_typo" CHECK ("website_configs"."typography_style" IN ('editorial','geometric','athletic')),
	CONSTRAINT "chk_wc_lang" CHECK ("website_configs"."default_language" IN ('en','am','om'))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_operating_hours" ADD CONSTRAINT "fk_boh_tenant_branch" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_schedule_overrides" ADD CONSTRAINT "fk_bso_tenant_branch" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inv_tenant_branch_outlet" FOREIGN KEY ("tenant_id","branch_id","outlet_id") REFERENCES "public"."outlets"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inv_tenant_outlet_product" FOREIGN KEY ("tenant_id","outlet_id","product_id") REFERENCES "public"."products"("tenant_id","outlet_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "fk_inv_tenant_product_var" FOREIGN KEY ("tenant_id","product_id","variation_id") REFERENCES "public"."product_variations"("tenant_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_im_tenant_inv_item" FOREIGN KEY ("tenant_id","inventory_item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "fk_im_tenant_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "fk_ir_tenant_inv_item" FOREIGN KEY ("tenant_id","inventory_item_id") REFERENCES "public"."inventory_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "fk_ir_tenant_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "fk_la_tenant_customer" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "fk_la_tenant_fav_product" FOREIGN KEY ("tenant_id","favorite_product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "fk_la_tenant_currency" FOREIGN KEY ("tenant_id","currency_code") REFERENCES "public"."tenants"("id","operating_currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "fk_ll_tenant_account" FOREIGN KEY ("tenant_id","loyalty_account_id") REFERENCES "public"."loyalty_accounts"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "fk_ll_tenant_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_categories" ADD CONSTRAINT "fk_mc_tenant_outlet_menu" FOREIGN KEY ("tenant_id","outlet_id","menu_id") REFERENCES "public"."menus"("tenant_id","outlet_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "fk_menus_outlet" FOREIGN KEY ("tenant_id","outlet_id") REFERENCES "public"."outlets"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_groups" ADD CONSTRAINT "modifier_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_options" ADD CONSTRAINT "fk_mo_tenant_group" FOREIGN KEY ("tenant_id","modifier_group_id") REFERENCES "public"."modifier_groups"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modifier_options" ADD CONSTRAINT "fk_mo_tenant_currency" FOREIGN KEY ("tenant_id","currency_code") REFERENCES "public"."tenants"("id","operating_currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "fk_oim_tenant_order_item" FOREIGN KEY ("tenant_id","order_item_id") REFERENCES "public"."order_items"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "fk_oim_tenant_group_opt" FOREIGN KEY ("tenant_id","modifier_group_id","modifier_option_id") REFERENCES "public"."modifier_options"("tenant_id","modifier_group_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_modifiers" ADD CONSTRAINT "fk_oim_tenant_currency" FOREIGN KEY ("tenant_id","currency_code") REFERENCES "public"."tenants"("id","operating_currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "fk_oi_tenant_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "fk_oi_tenant_product" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "fk_oi_tenant_product_var" FOREIGN KEY ("tenant_id","product_id","variation_id") REFERENCES "public"."product_variations"("tenant_id","product_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "fk_oi_tenant_currency" FOREIGN KEY ("tenant_id","currency_code") REFERENCES "public"."tenants"("id","operating_currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_tenant_branch_outlet" FOREIGN KEY ("tenant_id","branch_id","outlet_id") REFERENCES "public"."outlets"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_tenant_qr" FOREIGN KEY ("tenant_id","qr_station_id") REFERENCES "public"."qr_stations"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_tenant_customer" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "fk_orders_tenant_currency" FOREIGN KEY ("tenant_id","currency_code") REFERENCES "public"."tenants"("id","operating_currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "fk_outlets_tenant_branch" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "fk_pt_tenant_order" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "fk_pt_tenant_currency" FOREIGN KEY ("tenant_id","currency_code") REFERENCES "public"."tenants"("id","operating_currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "fk_pwe_tenant_tx" FOREIGN KEY ("tenant_id","payment_transaction_id") REFERENCES "public"."payment_transactions"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_impersonation_logs" ADD CONSTRAINT "platform_admin_impersonation_logs_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_impersonation_logs" ADD CONSTRAINT "platform_admin_impersonation_logs_target_tenant_id_tenants_id_fk" FOREIGN KEY ("target_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "fk_pmg_tenant_product" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_modifier_groups" ADD CONSTRAINT "fk_pmg_tenant_group" FOREIGN KEY ("tenant_id","modifier_group_id") REFERENCES "public"."modifier_groups"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variations" ADD CONSTRAINT "fk_pv_tenant_product" FOREIGN KEY ("tenant_id","product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variations" ADD CONSTRAINT "fk_pv_tenant_currency" FOREIGN KEY ("tenant_id","currency_code") REFERENCES "public"."tenants"("id","operating_currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "fk_products_tenant_outlet_cat" FOREIGN KEY ("tenant_id","outlet_id","category_id") REFERENCES "public"."menu_categories"("tenant_id","outlet_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "fk_products_tenant_currency" FOREIGN KEY ("tenant_id","currency_code") REFERENCES "public"."tenants"("id","operating_currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_stations" ADD CONSTRAINT "fk_qr_tenant_branch_outlet" FOREIGN KEY ("tenant_id","branch_id","outlet_id") REFERENCES "public"."outlets"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_requests" ADD CONSTRAINT "fk_sr_tenant_branch_outlet" FOREIGN KEY ("tenant_id","branch_id","outlet_id") REFERENCES "public"."outlets"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_requests" ADD CONSTRAINT "fk_sr_tenant_customer" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "public"."customers"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_requests" ADD CONSTRAINT "fk_sr_tenant_currency" FOREIGN KEY ("tenant_id","currency_code") REFERENCES "public"."tenants"("id","operating_currency") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation_branch_scopes" ADD CONSTRAINT "fk_sibs_invitation" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."staff_invitations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation_branch_scopes" ADD CONSTRAINT "fk_sibs_branch" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation_outlet_scopes" ADD CONSTRAINT "fk_sios_invitation" FOREIGN KEY ("tenant_id","invitation_id") REFERENCES "public"."staff_invitations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation_outlet_scopes" ADD CONSTRAINT "fk_sios_branch_outlet" FOREIGN KEY ("tenant_id","branch_id","outlet_id") REFERENCES "public"."outlets"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_membership_branches" ADD CONSTRAINT "fk_tmb_membership" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."tenant_memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_membership_branches" ADD CONSTRAINT "fk_tmb_branch" FOREIGN KEY ("tenant_id","branch_id") REFERENCES "public"."branches"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_membership_outlets" ADD CONSTRAINT "fk_tmo_membership" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."tenant_memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_membership_outlets" ADD CONSTRAINT "fk_tmo_branch_outlet" FOREIGN KEY ("tenant_id","branch_id","outlet_id") REFERENCES "public"."outlets"("tenant_id","branch_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_active_tenant_id_tenants_id_fk" FOREIGN KEY ("active_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "website_configs" ADD CONSTRAINT "website_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_tenant_created" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_bso_lookup" ON "branch_schedule_overrides" USING btree ("tenant_id","branch_id","start_date","end_date");--> statement-breakpoint
CREATE INDEX "idx_branches_tenant_active" ON "branches" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customers_tenant_phone" ON "customers" USING btree ("tenant_id","phone_e164") WHERE "customers"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inv_product_base" ON "inventory_items" USING btree ("tenant_id","outlet_id","product_id") WHERE "inventory_items"."variation_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_inv_product_var" ON "inventory_items" USING btree ("tenant_id","outlet_id","product_id","variation_id") WHERE "inventory_items"."variation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_im_item_created" ON "inventory_movements" USING btree ("tenant_id","inventory_item_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_ir_active_expiry" ON "inventory_reservations" USING btree ("status","expires_at") WHERE "inventory_reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_ll_account_created" ON "loyalty_ledger" USING btree ("tenant_id","loyalty_account_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_mc_tenant_outlet_sort" ON "menu_categories" USING btree ("tenant_id","outlet_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_orders_tenant_idemp" ON "orders" USING btree ("tenant_id","idempotency_key") WHERE "orders"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_orders_tenant_outlet_status" ON "orders" USING btree ("tenant_id","outlet_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pwd_reset_token_hash" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_pwd_reset_user" ON "password_reset_tokens" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_pt_provider_ref" ON "payment_transactions" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pwe_provider_event" ON "payment_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "idx_impersonation_tenant" ON "platform_admin_impersonation_logs" USING btree ("target_tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_products_dietary_gin" ON "products" USING gin ("dietary_tags");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_qr_token_hash" ON "qr_stations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_qr_tenant_outlet" ON "qr_stations" USING btree ("tenant_id","outlet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_si_token_hash" ON "staff_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_si_tenant_email" ON "staff_invitations" USING btree ("tenant_id","email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tm_tenant_user" ON "tenant_memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenants_active_slug" ON "tenants" USING btree ("slug") WHERE "tenants"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_tenants_business_types_gin" ON "tenants" USING gin ("business_types");--> statement-breakpoint
CREATE INDEX "idx_tenants_capabilities_gin" ON "tenants" USING gin ("enabled_capabilities");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_sessions_token_hash" ON "user_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_user_exp" ON "user_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_user_sessions_family" ON "user_sessions" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email_norm" ON "users" USING btree ("email_normalized");