-- Invariants that must never drift, enforced by the database itself.

-- Append-only tables: no UPDATE, no DELETE, for any reason.
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table: % cannot be %', TG_TABLE_NAME, TG_OP;
END;
$$;
--> statement-breakpoint

-- The ask row may change state (draft -> waiting_coordinator -> approved ...),
-- but the caregiver's own words may never change and the row may never vanish.
-- An edit creates a superseding ask_revision row instead.
CREATE OR REPLACE FUNCTION reject_verbatim_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only table: ask cannot be DELETE';
  END IF;

  IF NEW.verbatim_text IS DISTINCT FROM OLD.verbatim_text THEN
    RAISE EXCEPTION 'ask.verbatim_text is immutable: create a superseding ask_revision instead';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER ask_verbatim_immutable
  BEFORE UPDATE OR DELETE ON ask
  FOR EACH ROW EXECUTE FUNCTION reject_verbatim_change();
--> statement-breakpoint

CREATE TRIGGER ask_revision_immutable
  BEFORE UPDATE OR DELETE ON ask_revision
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

CREATE TRIGGER decision_immutable
  BEFORE UPDATE OR DELETE ON decision
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

CREATE TRIGGER audit_event_immutable
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

CREATE TRIGGER absence_proof_immutable
  BEFORE UPDATE OR DELETE ON absence_proof
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

-- A caregiver notification may only exist for a covered slot. An unclaimed
-- slot sends nothing, and that absence is the product's auditable guarantee.
CREATE OR REPLACE FUNCTION require_covered_slot_for_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  slot_status slot_status;
BEGIN
  SELECT status INTO slot_status FROM slot WHERE id = NEW.slot_id;

  IF slot_status IS NULL THEN
    RAISE EXCEPTION 'notification requires an existing slot (slot_id %)', NEW.slot_id;
  END IF;

  IF slot_status <> 'covered' THEN
    RAISE EXCEPTION 'notification requires a covered slot: slot % is %, so the caregiver is sent nothing',
      NEW.slot_id, slot_status;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER notification_requires_covered_slot
  BEFORE INSERT ON notification
  FOR EACH ROW EXECUTE FUNCTION require_covered_slot_for_notification();
