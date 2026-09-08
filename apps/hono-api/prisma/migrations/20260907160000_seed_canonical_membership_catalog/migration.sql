-- Re-seed the canonical personal membership catalog (PLUS/PRO/MAX/ULTRA).
--
-- The original seed (20260723133000) silently skipped on deployments without a
-- configured platform account, leaving production with an empty catalog: the
-- admin membership picker has no options and no user-facing purchase surface
-- can ever render. Editing an applied migration does not re-run it, so this
-- follow-up migration performs the same seeding with an explicit owner
-- resolution chain:
--   1. the platform account dictionary row (exactly one owner required), then
--   2. the oldest active admin user — mirroring how ensureCatalogMerchant
--      adopts the acting admin as merchant owner at runtime.
-- The platform merchant is created when missing. All inserts are idempotent
-- upserts on the deterministic canonical IDs, so re-running is a no-op.
-- ULTRA concurrencyLimit is seeded at 1000, keeping the value installed by
-- 20260723134500_raise_ultra_membership_concurrency (also the schema maximum).
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
    RAISE EXCEPTION 'Cannot seed membership catalog: platform account settings must identify exactly one owner (found %)', v_dict_owner_count;
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
    RAISE NOTICE 'Skipping membership catalog seed: no platform account and no active admin user yet (run again after setup)';
    RETURN;
  END IF;

  -- 3. Guard: canonical IDs must not already belong to a different owner.
  IF EXISTS (
    SELECT 1
    FROM "products"
    WHERE "id" IN (
      'sys_membership_plus',
      'sys_membership_pro',
      'sys_membership_max',
      'sys_membership_ultra'
    )
      AND "owner_id" <> v_owner_id
  ) THEN
    RAISE EXCEPTION 'Cannot seed membership catalog: a canonical product ID belongs to another owner';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "product_entitlements"
    WHERE "product_id" IN (
      'sys_membership_plus',
      'sys_membership_pro',
      'sys_membership_max',
      'sys_membership_ultra'
    )
      AND ("owner_id" <> v_owner_id OR "entitlement_type" <> 'membership')
  ) THEN
    RAISE EXCEPTION 'Cannot seed membership catalog: a canonical product has conflicting entitlement data';
  END IF;

  -- 4. Ensure the platform merchant exists (merchants.owner_id is unique).
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
    RAISE EXCEPTION 'Cannot seed membership catalog: platform merchant is missing and could not be created';
  END IF;

  -- 5. Canonical products.
  WITH tiers(id, tier, title, subtitle, price_cents, description) AS (
    VALUES
      ('sys_membership_plus', 'plus', 'PLUS', '每月 9,900 积分 + 每日赠送 350', 8900, '购买后立即获得本月积分；会员期内每日赠送积分，当日有效；包含全部创作功能。'),
      ('sys_membership_pro', 'pro', 'PRO', '动态算力 6.4w-14.3w', 26900, '购买后立即获得本月积分；会员期内每日赠送积分，当日有效；包含全部创作功能。'),
      ('sys_membership_max', 'max', 'MAX', '每月 89,000 积分 + 每日赠送 2,800', 62900, '购买后立即获得本月积分；会员期内每日赠送积分，当日有效；包含全部创作功能。'),
      ('sys_membership_ultra', 'ultra', 'ULTRA', '每月 155,500 积分 + 每日赠送 4,900', 109900, '购买后立即获得本月积分；会员期内每日赠送积分，当日有效；包含全部创作功能。')
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

  -- 6. Canonical SKUs.
  WITH variants(
    tier, rank, suffix, name, spec, price_cents, billing_cycle, duration_days,
    monthly_credits, daily_gift_credits, concurrency_limit, capacity_label
  ) AS (
    VALUES
      ('plus', 1, 'monthly', '月付', 'monthly', 8900, 'monthly', 30, 9900, 350, 6, ''),
      ('plus', 2, 'annual', '年付', 'annual', 94900, 'annual', 365, 10900, 500, 6, ''),
      ('pro', 1, 'monthly-64k', '月付 6.4w', 'monthly:6.4w', 26900, 'monthly', 30, 30900, 1100, 10, '6.4w'),
      ('pro', 2, 'monthly-91k', '月付 9.1w', 'monthly:9.1w', 37900, 'monthly', 30, 43500, 1570, 10, '9.1w'),
      ('pro', 3, 'monthly-117k', '月付 11.7w', 'monthly:11.7w', 48900, 'monthly', 30, 56200, 2030, 10, '11.7w'),
      ('pro', 4, 'monthly-143k', '月付 14.3w', 'monthly:14.3w', 59900, 'monthly', 30, 68800, 2490, 10, '14.3w'),
      ('pro', 5, 'annual-84k', '年付 8.4w', 'annual:8.4w', 290900, 'annual', 365, 36000, 1600, 10, '8.4w'),
      ('pro', 6, 'annual-118k', '年付 11.8w', 'annual:11.8w', 409900, 'annual', 365, 50700, 2250, 10, '11.8w'),
      ('pro', 7, 'annual-153k', '年付 15.3w', 'annual:15.3w', 529900, 'annual', 365, 65600, 2920, 10, '15.3w'),
      ('pro', 8, 'annual-188k', '年付 18.8w', 'annual:18.8w', 649900, 'annual', 365, 80400, 3580, 10, '18.8w'),
      ('max', 1, 'monthly', '月付', 'monthly', 62900, 'monthly', 30, 89000, 2800, 20, ''),
      ('max', 2, 'annual', '年付', 'annual', 679900, 'annual', 365, 108000, 4000, 20, ''),
      ('ultra', 1, 'monthly', '月付', 'monthly', 109900, 'monthly', 30, 155500, 4900, 1000, ''),
      ('ultra', 2, 'annual', '年付', 'annual', 1189900, 'annual', 365, 189000, 7300, 1000, '')
  ), canonical_products(id, tier) AS (
    VALUES
      ('sys_membership_plus', 'plus'),
      ('sys_membership_pro', 'pro'),
      ('sys_membership_max', 'max'),
      ('sys_membership_ultra', 'ultra')
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
    CASE WHEN variant.rank = 1 THEN 1 ELSE 0 END,
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

  -- 7. Canonical membership entitlements (config consumed by admin assignment
  --    and the plan view model). ULTRA keeps concurrencyLimit = 1000.
  WITH variants(
    tier, rank, suffix, billing_cycle, duration_days, monthly_credits,
    daily_gift_credits, concurrency_limit, capacity_label
  ) AS (
    VALUES
      ('plus', 1, 'monthly', 'monthly', 30, 9900, 350, 6, ''),
      ('plus', 2, 'annual', 'annual', 365, 10900, 500, 6, ''),
      ('pro', 1, 'monthly-64k', 'monthly', 30, 30900, 1100, 10, '6.4w'),
      ('pro', 2, 'monthly-91k', 'monthly', 30, 43500, 1570, 10, '9.1w'),
      ('pro', 3, 'monthly-117k', 'monthly', 30, 56200, 2030, 10, '11.7w'),
      ('pro', 4, 'monthly-143k', 'monthly', 30, 68800, 2490, 10, '14.3w'),
      ('pro', 5, 'annual-84k', 'annual', 365, 36000, 1600, 10, '8.4w'),
      ('pro', 6, 'annual-118k', 'annual', 365, 50700, 2250, 10, '11.8w'),
      ('pro', 7, 'annual-153k', 'annual', 365, 65600, 2920, 10, '15.3w'),
      ('pro', 8, 'annual-188k', 'annual', 365, 80400, 3580, 10, '18.8w'),
      ('max', 1, 'monthly', 'monthly', 30, 89000, 2800, 20, ''),
      ('max', 2, 'annual', 'annual', 365, 108000, 4000, 20, ''),
      ('ultra', 1, 'monthly', 'monthly', 30, 155500, 4900, 1000, ''),
      ('ultra', 2, 'annual', 'annual', 365, 189000, 7300, 1000, '')
  ), canonical_products(id, tier, accent, featured, sort_order) AS (
    VALUES
      ('sys_membership_plus', 'plus', 'graphite', FALSE, 10),
      ('sys_membership_pro', 'pro', 'violet', TRUE, 20),
      ('sys_membership_max', 'max', 'blue', FALSE, 30),
      ('sys_membership_ultra', 'ultra', 'cyan', FALSE, 40)
  ), configs AS (
    SELECT
      product.id AS product_id,
      product.tier,
      product.accent,
      product.featured,
      product.sort_order,
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
        ) ORDER BY variant.rank
      ) AS sku_configs
    FROM canonical_products product
    JOIN variants variant ON variant.tier = product.tier
    GROUP BY product.id, product.tier, product.accent, product.featured, product.sort_order
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
      'billingCycle', first_variant.billing_cycle,
      'durationDays', first_variant.duration_days,
      'monthlyCredits', first_variant.monthly_credits,
      'dailyGiftCredits', first_variant.daily_gift_credits,
      'concurrencyLimit', first_variant.concurrency_limit,
      'capacityLabel', first_variant.capacity_label,
      'timezone', 'Asia/Shanghai',
      'skuConfigs', config.sku_configs,
      'presentation', jsonb_build_object(
        'accent', config.accent,
        'featured', config.featured,
        'sortOrder', config.sort_order,
        'campaignBenefits', jsonb_build_array(
          '购买后立即获得本月积分',
          '每日赠送积分，当日有效',
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
  JOIN variants first_variant
    ON first_variant.tier = config.tier
    AND first_variant.rank = 1
  ON CONFLICT ("id") DO UPDATE SET
    "product_id" = EXCLUDED."product_id",
    "owner_id" = EXCLUDED."owner_id",
    "entitlement_type" = EXCLUDED."entitlement_type",
    "config_json" = EXCLUDED."config_json",
    "updated_at" = EXCLUDED."updated_at";
END $seed$;

COMMIT;
