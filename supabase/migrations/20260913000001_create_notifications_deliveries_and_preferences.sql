-- ============================================================================
-- ALPASFARM NOTIFICATION DELIVERIES AND PREFERENCES MIGRATION
-- ============================================================================

-- 1. Extend existing notifications table with required fields
ALTER TABLE IF EXISTS notifications
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS related_type text,
  ADD COLUMN IF NOT EXISTS related_id text,
  ADD COLUMN IF NOT EXISTS severity text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Sync existing read column with is_read if needed
UPDATE notifications SET is_read = read WHERE is_read IS NULL AND read IS NOT NULL;
UPDATE notifications SET message = description WHERE message IS NULL AND description IS NOT NULL;

-- Unique event_key index to prevent duplicate notifications / anti-spam
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_event_key
  ON notifications(user_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_related
  ON notifications(related_type, related_id);

-- 2. Create notification_deliveries table for multi-channel tracking (In-App, SMS, Email)
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_id uuid REFERENCES notifications(id) ON DELETE CASCADE,
  channel text NOT NULL, -- 'in_app' | 'sms' | 'email'
  recipient text, -- Phone number (+63...) or email address
  status text NOT NULL DEFAULT 'pending', -- 'pending' | 'sent' | 'delivered' | 'failed'
  provider_message_id text,
  error_message text,
  attempt_count int NOT NULL DEFAULT 1,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notification_deliveries" ON notification_deliveries;
CREATE POLICY "select_own_notification_deliveries" ON notification_deliveries FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notification_deliveries" ON notification_deliveries;
CREATE POLICY "insert_own_notification_deliveries" ON notification_deliveries FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notification_deliveries" ON notification_deliveries;
CREATE POLICY "update_own_notification_deliveries" ON notification_deliveries FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notification_deliveries" ON notification_deliveries;
CREATE POLICY "delete_own_notification_deliveries" ON notification_deliveries FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user_id ON notification_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notif_id ON notification_deliveries(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_channel_status ON notification_deliveries(channel, status);

-- 3. Create notification_preferences table for user-controlled channels
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Health Alerts
  health_in_app boolean NOT NULL DEFAULT true,
  health_sms boolean NOT NULL DEFAULT true,
  health_email boolean NOT NULL DEFAULT true,

  -- Inventory Alerts
  inventory_in_app boolean NOT NULL DEFAULT true,
  inventory_sms boolean NOT NULL DEFAULT false,
  inventory_email boolean NOT NULL DEFAULT true,

  -- Breeding Alerts
  breeding_in_app boolean NOT NULL DEFAULT true,
  breeding_sms boolean NOT NULL DEFAULT false,
  breeding_email boolean NOT NULL DEFAULT true,

  -- Vaccination Reminders
  vaccination_in_app boolean NOT NULL DEFAULT true,
  vaccination_sms boolean NOT NULL DEFAULT true,
  vaccination_email boolean NOT NULL DEFAULT true,

  -- Medication Reminders
  medication_in_app boolean NOT NULL DEFAULT true,
  medication_sms boolean NOT NULL DEFAULT true,
  medication_email boolean NOT NULL DEFAULT true,

  -- Sales Notifications
  sales_in_app boolean NOT NULL DEFAULT true,
  sales_sms boolean NOT NULL DEFAULT false,
  sales_email boolean NOT NULL DEFAULT true,

  -- System Notifications
  system_in_app boolean NOT NULL DEFAULT true,
  system_sms boolean NOT NULL DEFAULT false,
  system_email boolean NOT NULL DEFAULT false,

  -- Emergency override for critical health/safety alerts
  critical_bypass boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_notification_preferences" ON notification_preferences;
CREATE POLICY "select_own_notification_preferences" ON notification_preferences FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notification_preferences" ON notification_preferences;
CREATE POLICY "insert_own_notification_preferences" ON notification_preferences FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notification_preferences" ON notification_preferences;
CREATE POLICY "update_own_notification_preferences" ON notification_preferences FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notification_preferences" ON notification_preferences;
CREATE POLICY "delete_own_notification_preferences" ON notification_preferences FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user_id ON notification_preferences(user_id);
