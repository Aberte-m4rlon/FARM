-- Extend farmer-facing audit coverage and keep the activity page current.
BEGIN;

CREATE OR REPLACE FUNCTION public.normalize_activity_log_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  source_table text := NEW.details->>'table';
  gate_status text;
BEGIN
  CASE source_table
    WHEN 'camera_health_screenings' THEN
      NEW.module := 'Health';
      IF NEW.entity_name IS NULL OR NEW.entity_name = 'camera_health_screenings' THEN
        NEW.entity_name := 'AI health screening';
      END IF;
      IF NEW.action = 'created' THEN
        NEW.action := 'health_screened';
      END IF;
      IF NEW.animal_id IS NULL THEN
        SELECT screening.animal_id
          INTO NEW.animal_id
        FROM public.camera_health_screenings AS screening
        WHERE screening.id::text = NEW.entity_id
        LIMIT 1;
      END IF;
    WHEN 'gate_sessions' THEN
      NEW.module := 'Camera';
      IF NEW.entity_name IS NULL OR NEW.entity_name = 'gate_sessions' THEN
        NEW.entity_name := 'Camera monitoring session';
      END IF;
      IF NEW.action = 'created' THEN
        NEW.action := 'monitoring_started';
      ELSIF NEW.action = 'updated' THEN
        SELECT session.status
          INTO gate_status
        FROM public.gate_sessions AS session
        WHERE session.id::text = NEW.entity_id
        LIMIT 1;
        IF gate_status = 'reconciled' THEN
          NEW.action := 'monitoring_finished';
        ELSIF gate_status = 'cancelled' THEN
          NEW.action := 'monitoring_cancelled';
        END IF;
      END IF;
    WHEN 'gate_devices' THEN
      NEW.module := 'Camera';
      IF NEW.entity_name IS NULL OR NEW.entity_name = 'gate_devices' THEN
        NEW.entity_name := 'Camera gate';
      END IF;
      IF NEW.action = 'created' THEN
        NEW.action := 'gate_added';
      ELSIF NEW.action = 'updated' THEN
        NEW.action := 'gate_updated';
      END IF;
    WHEN 'notification_preferences' THEN
      NEW.module := 'Settings';
      IF NEW.entity_name IS NULL OR NEW.entity_name = 'notification_preferences' THEN
        NEW.entity_name := 'Notification settings';
      END IF;
      IF NEW.action = 'updated' THEN
        NEW.action := 'notification_settings_updated';
      END IF;
    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_activity_log_context() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS activity_logs_audit_context ON public.activity_logs;
CREATE TRIGGER activity_logs_audit_context
  BEFORE INSERT ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.normalize_activity_log_context();

-- These tables represent meaningful farmer actions. High-frequency transient
-- gate_live_tracks updates are intentionally excluded from the audit trail.
DO $$
DECLARE
  table_name text;
  audited_tables text[] := ARRAY['camera_health_screenings', 'notification_preferences'];
BEGIN
  FOREACH table_name IN ARRAY audited_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS activity_audit ON public.%I', table_name);
      EXECUTE format(
        'CREATE TRIGGER activity_audit AFTER INSERT OR UPDATE OR DELETE ON public.%I '
        'FOR EACH ROW EXECUTE FUNCTION public.capture_activity_log()',
        table_name
      );
    END IF;
  END LOOP;

  IF to_regclass('public.gate_sessions') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS activity_audit ON public.gate_sessions';
    EXECUTE 'CREATE TRIGGER activity_audit
      AFTER INSERT OR DELETE OR UPDATE OF status, gate_id, expected_animal_ids,
        reconciliation_window_minutes, gate_line_y, entry_flow
      ON public.gate_sessions
      FOR EACH ROW EXECUTE FUNCTION public.capture_activity_log()';
  END IF;

  IF to_regclass('public.gate_devices') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS activity_audit ON public.gate_devices';
    EXECUTE 'CREATE TRIGGER activity_audit
      AFTER INSERT OR DELETE OR UPDATE OF name, location, is_active
      ON public.gate_devices
      FOR EACH ROW EXECUTE FUNCTION public.capture_activity_log()';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'activity_logs'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
