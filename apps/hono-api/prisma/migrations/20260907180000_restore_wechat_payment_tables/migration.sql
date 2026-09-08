-- 恢复支付域六张表并加回 subscriptions.source_order_id。
-- 这些表曾在 20260831143000_remove_payment_and_sms 中随社区版硬切换删除；
-- 现按历史设计重建（微信 Native 扫码第一期），发货记录（order_entitlements）
-- 与订阅溯源（source_order_id）支撑会员开通的幂等与审计。

ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "source_order_id" TEXT;

CREATE TABLE IF NOT EXISTS "orders" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "order_no" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_payment',
  "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "total_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "paid_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "refund_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "refund_status" TEXT,
  "refund_reason" TEXT,
  "buyer_note" TEXT,
  "paid_at" TEXT,
  "canceled_at" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,

  CONSTRAINT "orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orders_order_no_key" UNIQUE ("order_no"),
  CONSTRAINT "orders_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "orders_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_orders_merchant_created" ON "orders"("merchant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_orders_owner_created" ON "orders"("owner_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_orders_owner_payment_status" ON "orders"("owner_id", "payment_status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_orders_owner_status" ON "orders"("owner_id", "status", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "order_items" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "sku_id" TEXT,
  "title_snapshot" TEXT NOT NULL,
  "sku_name_snapshot" TEXT,
  "unit_price_cents" INTEGER NOT NULL DEFAULT 0,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "total_price_cents" INTEGER NOT NULL DEFAULT 0,
  "cover_image_url_snapshot" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,

  CONSTRAINT "order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_items_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "order_items_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "order_items_sku_id_fkey"
    FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_order_items_order" ON "order_items"("order_id");
CREATE INDEX IF NOT EXISTS "idx_order_items_product" ON "order_items"("product_id");

CREATE TABLE IF NOT EXISTS "order_entitlements" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "order_item_id" TEXT NOT NULL,
  "product_id" TEXT NOT NULL,
  "entitlement_type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "result_json" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,

  CONSTRAINT "order_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uk_order_entitlements_item_type" UNIQUE ("order_item_id", "entitlement_type"),
  CONSTRAINT "order_entitlements_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "order_entitlements_order_item_id_fkey"
    FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "order_entitlements_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "order_entitlements_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_order_entitlements_owner_created" ON "order_entitlements"("owner_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "order_status_events" (
  "id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "from_status" TEXT,
  "to_status" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "reason" TEXT,
  "payload_json" TEXT,
  "created_at" TEXT NOT NULL,

  CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_status_events_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "order_status_events_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_order_status_events_order_created" ON "order_status_events"("order_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_order_status_events_owner_created" ON "order_status_events"("owner_id", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "payments" (
  "id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "trade_type" TEXT NOT NULL,
  "out_trade_no" TEXT NOT NULL,
  "prepay_id" TEXT,
  "transaction_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'created',
  "total_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'CNY',
  "refund_amount_cents" INTEGER NOT NULL DEFAULT 0,
  "refund_status" TEXT,
  "refund_reason" TEXT,
  "raw_request_json" TEXT,
  "raw_response_json" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "succeeded_at" TEXT,
  "closed_at" TEXT,

  CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payments_out_trade_no_key" UNIQUE ("out_trade_no"),
  CONSTRAINT "payments_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "payments_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_payments_order_created" ON "payments"("order_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_payments_owner_status_created" ON "payments"("owner_id", "status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_payments_transaction_id" ON "payments"("transaction_id");

CREATE TABLE IF NOT EXISTS "payment_callbacks" (
  "id" TEXT NOT NULL,
  "payment_id" TEXT,
  "provider" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "out_trade_no" TEXT,
  "transaction_id" TEXT,
  "signature_valid" INTEGER NOT NULL DEFAULT 0,
  "payload_json" TEXT NOT NULL,
  "headers_json" TEXT,
  "error_message" TEXT,
  "created_at" TEXT NOT NULL,

  CONSTRAINT "payment_callbacks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_callbacks_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_payment_callbacks_out_trade_created" ON "payment_callbacks"("out_trade_no", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_payment_callbacks_payment_created" ON "payment_callbacks"("payment_id", "created_at" DESC);

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_source_order_id_fkey"
  FOREIGN KEY ("source_order_id") REFERENCES "orders"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
  NOT VALID;
