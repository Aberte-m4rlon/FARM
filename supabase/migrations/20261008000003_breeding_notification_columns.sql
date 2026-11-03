BEGIN;

-- Match the deployed notifications table to the columns used by breeding RPCs.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS related_type text,
  ADD COLUMN IF NOT EXISTS related_id text,
  ADD COLUMN IF NOT EXISTS severity text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS animal_id uuid REFERENCES public.animals(id) ON DELETE SET NULL;

UPDATE public.notifications
SET message = COALESCE(message, description),
    is_read = COALESCE(read, is_read, false),
    updated_at = COALESCE(updated_at, created_at, now())
WHERE message IS NULL
   OR is_read IS DISTINCT FROM read
   OR updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_event_key
  ON public.notifications (user_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_related
  ON public.notifications (related_type, related_id);

NOTIFY pgrst, 'reload schema';
COMMIT;
