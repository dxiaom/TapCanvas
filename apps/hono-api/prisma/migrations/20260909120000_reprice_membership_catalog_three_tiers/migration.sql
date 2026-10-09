-- Hard cutover of the purchasable personal membership catalog to three monthly
-- tiers (user-approved pricing, 100 credits/CNY):
--   体验版  ¥39  -> 3,900 credits/month, concurrency 5
--   标准版  ¥69  -> 6,900 credits/month, concurrency 8
--   专业版  ¥99  -> 9,900 credits/month, concurrency 10
--
-- The previous canonical tiers (PLUS/PRO/MAX/ULTRA, incl. every annual SKU) are
-- deactivated: inactive products can never be listed, purchased, or fulfilled.
-- Daily gift credits collapse to the schema-minimum placeholder (1/day) — the
-- three tiers grant their monthly credits up front with no daily top-up, so
-- campaign copy no longer advertises daily gifts.
--
-- Existing active subscriptions on retired tiers are untouched and keep their
-- grants until natural expiry; only the purchasable catalog changes.
--
-- Owner resolution mirrors 20260907160000_seed_canonical_membership_catalog:
--   1. the platform account dictionary row (exactly one owner required), then
--   2. the oldest active admin user.
-- The platform merchant is created when missing. All upserts target the
-- deterministic canonical IDs, so re-running is a no-op.

BEGIN;

DO $seed$
DECLARE
  v_dict_owner_count INTEGER;
  v_owner_id TEXT;
  v_merchant_id TEXT;
BEGIN
  -- 1. Resolve the catalog owner. Explicit dictionary config wins; ambiguity
  --    stays a hard error instead of silently picking one owner.
  SELECT COUNT(DISTINCT "owner_id")
  INTO v_dict_owner_count
  FROM "commerce_dictionaries"
  WHERE "dict_type" = 'platform_account'
    AND "code" = 'member_center';

  IF v_dict_owner_count > 1 THEN
    RAISE EXCEPTION 'Cannot reprice membership catalog: platform account settings must identify exactly one owner (found %)', v_dict_owner_count;
  END IF;

  v_owner_id := (
    SELECT "owner_id"
    FROM "commerce_dictionaries"
    WHERE "dict_type" = 'platform_account'
      AND "code" = 'member_center'
    LIMIT 1
  );

  -- 2. Fallback: the oldest active admin user is the platform operator.
  IF v_owner_id IS NULL THEN
    SELECT "id"
    INTO v_owner_id
    FROM "users"
    WHERE "role" = 'admin'
      AND ("deleted_at" IS NULL OR "deleted_at" = '')
      AND "disabled" = 0
    ORDER BY "created_at" ASC, "id" ASC
    LIMIT 1;
  END IF;

  IF v_owner_id IS NULL THEN
    RAISE NOTICE 'Skipping membership catalog reprice: no platform account and no active admin user yet (run again after setup)';
    RETURN;
  END IF;

  -- 3. Guard: new canonical IDs must not already belong to a different owner.
  IF EXISTS (
    SELECT 1
    FROM "products"
    WHERE "id" IN (
      'sys_membership_starter',
      'sys_membership_standard',
      'sys_membership_premium'
    )
      AND "owner_id" <> v_owner_id
  ) THEN
    RAISE EXCEPTION 'Cannot reprice membership catalog: a new canonical product ID belongs to another owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "product_entitlements"
    WHERE "product_id" IN (
      'sys_membership_starter',
      'sys_membership_standard',
      'sys_membership_premium'
    )
      AND ("owner_id" <> v_owner_id OR "entitlement_type" <> 'membership')
  ) THEN
    RAISE EXCEPTION 'Cannot reprice membership catalog: a new canonical product has conflicting entitlement data';
  END IF;

  -- 4. Deactivate the retired canonical tiers and all of their SKUs.
  --    Entitlement rows are left in place: an inactive product can never be
  --    listed, purchased, or fulfilled, so keeping its config is inert history.
  UPDATE "products"
  SET "status" = 'inactive', "updated_at" = NOW()::text
  WHERE "owner_id" = v_owner_id
    AND "id" IN (
      'sys_membership_plus',
      'sys_membership_pro',
      'sys_membership_max',
      'sys_membership_ultra'
    );

  UPDATE "product_skus"
  SET "status" = 'inactive', "updated_at" = NOW()::text
  WHERE "owner_id" = v_owner_id
    AND "product_id" IN (
      'sys_membership_plus',
      'sys_membership_pro',
      'sys_membership_max',
      'sys_membership_ultra'
    );

  -- 5. Ensure the platform merchant exists (merchants.owner_id is unique).
  v_merchant_id := (
    SELECT "id"
    FROM "merchants"
    WHERE "owner_id" = v_owner_id
    LIMIT 1
  );
  IF v_merchant_id IS NULL THEN
    INSERT INTO "merchants" ("id", "owner_id", "name", "status", "created_at", "updated_at")
    VALUES ('sys_platform_merchant', v_owner_id, 'default_merchant', 'active', NOW()::TEXT, NOW()::TEXT)
    ON CONFLICT ("id") DO NOTHING;
    v_merchant_id := (
      SELECT "id"
      FROM "merchants"
      WHERE "owner_id" = v_owner_id
      LIMIT 1
    );
  END IF;
  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Cannot reprice membership catalog: platform merchant is missing and could not be created';
  END IF;

  -- 6. New canonical products (monthly tiers only).
  WITH tiers(id, tier, title, subtitle, price_cents, description) AS (
    VALUES
      ('sys_membership_starter', 'starter', '体验版', '每月 3,900 积分', 3900, '购买后立即获得本月积分；包含全部创作功能。'),
      ('sys_membership_standard', 'standard', '标准版', '每月 6,900 积分', 6900, '购买后立即获得本月积分；包含全部创作功能。'),
      ('sys_membership_premium', 'premium', '专业版', '每月 9,900 积分', 9900, '购买后立即获得本月积分；包含全部创作功能。')
  )
  INSERT INTO "products" (
    "id", "owner_id", "merchant_id", "title", "subtitle", "description",
    "currency", "price_cents", "stock", "status", "created_at", "updated_at"
  )
  SELECT
    tiers.id, v_owner_id, v_merchant_id, tiers.title, tiers.subtitle,
    tiers.description, 'CNY', tiers.price_cents, 999999, 'active', NOW()::text, NOW()::text
  FROM tiers
  ON CONFLICT ("id") DO UPDATE SET
    "owner_id" = EXCLUDED."owner_id",
    "merchant_id" = EXCLUDED."merchant_id",
    "title" = EXCLUDED."title",
    "subtitle" = EXCLUDED."subtitle",
    "description" = EXCLUDED."description",
    "currency" = EXCLUDED."currency",
    "price_cents" = EXCLUDED."price_cents",
    "stock" = EXCLUDED."stock",
    "status" = EXCLUDED."status",
    "updated_at" = EXCLUDED."updated_at";

  -- 7. One monthly SKU per tier (the only purchasable variant).
  WITH variants(
    tier, suffix, name, spec, price_cents,
    billing_cycle, duration_days, monthly_credits, daily_gift_credits,
    concurrency_limit, capacity_label
  ) AS (
    VALUES
      ('starter', 'monthly', '月付', 'monthly', 3900, 'monthly', 30, 3900, 1, 5, ''),
      ('standard', 'monthly', '月付', 'monthly', 6900, 'monthly', 30, 6900, 1, 8, ''),
      ('premium', 'monthly', '月付', 'monthly', 9900, 'monthly', 30, 9900, 1, 10, '')
  ), canonical_products(id, tier) AS (
    VALUES
      ('sys_membership_starter', 'starter'),
      ('sys_membership_standard', 'standard'),
      ('sys_membership_premium', 'premium')
  )
  INSERT INTO "product_skus" (
    "id", "product_id", "owner_id", "merchant_id", "name", "spec",
    "price_cents", "stock", "is_default", "status", "created_at", "updated_at"
  )
  SELECT
    product.id || '-membership-' || variant.suffix,
    product.id,
    v_owner_id,
    v_merchant_id,
    variant.name,
    variant.spec,
    variant.price_cents,
    999999,
    1,
    'active',
    NOW()::text,
    NOW()::text
  FROM canonical_products product
  JOIN variants variant ON variant.tier = product.tier
  ON CONFLICT ("id") DO UPDATE SET
    "product_id" = EXCLUDED."product_id",
    "owner_id" = EXCLUDED."owner_id",
    "merchant_id" = EXCLUDED."merchant_id",
    "name" = EXCLUDED."name",
    "spec" = EXCLUDED."spec",
    "price_cents" = EXCLUDED."price_cents",
    "stock" = EXCLUDED."stock",
    "is_default" = EXCLUDED."is_default",
    "status" = EXCLUDED."status",
    "updated_at" = EXCLUDED."updated_at";

  -- 8. Membership entitlements (fulfillment config + pricing presentation).
  --    Top-level config and the single skuConfigs entry carry identical values;
  --    order fulfillment reads skuConfigs[<sku id>] when the order item has a SKU.
  WITH variants(
    tier, suffix, billing_cycle, duration_days, monthly_credits,
    daily_gift_credits, concurrency_limit, capacity_label
  ) AS (
    VALUES
      ('starter', 'monthly', 'monthly', 30, 3900, 1, 5, ''),
      ('standard', 'monthly', 'monthly', 30, 6900, 1, 8, ''),
      ('premium', 'monthly', 'monthly', 30, 9900, 1, 10, '')
  ), canonical_products(id, tier, accent, featured, sort_order) AS (
    VALUES
      ('sys_membership_starter', 'starter', 'graphite', FALSE, 10),
      ('sys_membership_standard', 'standard', 'violet', TRUE, 20),
      ('sys_membership_premium', 'premium', 'cyan', FALSE, 30)
  ), configs AS (
    SELECT
      product.id AS product_id,
      jsonb_object_agg(
        product.id || '-membership-' || variant.suffix,
        jsonb_build_object(
          'billingCycle', variant.billing_cycle,
          'durationDays', variant.duration_days,
          'monthlyCredits', variant.monthly_credits,
          'dailyGiftCredits', variant.daily_gift_credits,
          'concurrencyLimit', variant.concurrency_limit,
          'capacityLabel', variant.capacity_label,
          'timezone', 'Asia/Shanghai'
        )
      ) AS sku_configs,
      min(variant.billing_cycle) AS billing_cycle,
      min(variant.duration_days) AS duration_days,
      min(variant.monthly_credits) AS monthly_credits,
      min(variant.daily_gift_credits) AS daily_gift_credits,
      min(variant.concurrency_limit) AS concurrency_limit,
      min(variant.capacity_label) AS capacity_label
    FROM canonical_products product
    JOIN variants variant ON variant.tier = product.tier
    GROUP BY product.id
  )
  INSERT INTO "product_entitlements" (
    "id", "product_id", "owner_id", "entitlement_type", "config_json", "created_at", "updated_at"
  )
  SELECT
    config.product_id || '_ent',
    config.product_id,
    v_owner_id,
    'membership',
    jsonb_build_object(
      'billingCycle', config.billing_cycle,
      'durationDays', config.duration_days,
      'monthlyCredits', config.monthly_credits,
      'dailyGiftCredits', config.daily_gift_credits,
      'concurrencyLimit', config.concurrency_limit,
      'capacityLabel', config.capacity_label,
      'timezone', 'Asia/Shanghai',
      'skuConfigs', config.sku_configs,
      'presentation', jsonb_build_object(
        'accent', product.accent,
        'featured', product.featured,
        'sortOrder', product.sort_order,
        'campaignBenefits', jsonb_build_array(
          '购买后立即获得本月积分',
          '全部创作功能'
        ),
        'features', jsonb_build_array(
          '全部图片、视频与音频模型',
          '无限画布与 Agents 协作',
          '角色、分镜与项目资产管理',
          'Neo TV 发布与创作过程展示'
        )
      )
    )::text,
    NOW()::text,
    NOW()::text
  FROM configs config
  JOIN canonical_products product ON product.id = config.product_id
  ON CONFLICT ("id") DO UPDATE SET
    "product_id" = EXCLUDED."product_id",
    "owner_id" = EXCLUDED."owner_id",
    "entitlement_type" = EXCLUDED."entitlement_type",
    "config_json" = EXCLUDED."config_json",
    "updated_at" = EXCLUDED."updated_at";
END $seed$;

COMMIT;
