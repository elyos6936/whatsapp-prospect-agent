-- Permet le claim atomique send_queue (pending → processing) entre workers API.
ALTER TABLE send_queue DROP CONSTRAINT IF EXISTS send_queue_status_check;
ALTER TABLE send_queue
  ADD CONSTRAINT send_queue_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled'));

ALTER TABLE send_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
