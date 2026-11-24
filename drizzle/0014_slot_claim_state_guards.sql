ALTER TABLE "slot" ADD CONSTRAINT "slot_claim_state_coherent" CHECK (case "slot"."status"
        when 'open' then "slot"."claimed_by" is null and "slot"."claimed_at" is null and "slot"."claim_confirmed_by" is null and "slot"."claim_confirmed_at" is null
        when 'claimed' then "slot"."claimed_by" is not null and "slot"."claimed_at" is not null and "slot"."claim_confirmed_by" is null and "slot"."claim_confirmed_at" is null
        when 'covered' then "slot"."claimed_by" is not null and "slot"."claim_confirmed_at" is not null
        when 'done' then "slot"."claimed_by" is not null and "slot"."claim_confirmed_at" is not null
        when 'draft' then "slot"."claimed_by" is null and "slot"."claimed_at" is null and "slot"."claim_confirmed_by" is null and "slot"."claim_confirmed_at" is null
        when 'expired_unclaimed' then "slot"."claimed_by" is null and "slot"."claimed_at" is null and "slot"."claim_confirmed_by" is null and "slot"."claim_confirmed_at" is null
        when 'cancelled' then true
        else true
      end);
--> statement-breakpoint

-- The claim identity is write-once below the repository as well. The CHECK
-- above proves that every claim-bearing status carries the right columns; this
-- trigger proves that the name on the row and the instant a coordinator
-- confirmed it can never be swapped behind `claimSlot`'s conditional UPDATE.
--
-- Clearing `claimed_by` is not reassigning it: the desk's revoke path returns a
-- claimed place to `open` by emptying the claim columns, and that must keep
-- working. A different non-null claimant on a row that already has one is the
-- silent overwrite this refuses.
CREATE OR REPLACE FUNCTION guard_slot_claim_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.claimed_by IS NOT NULL
     AND NEW.claimed_by IS NOT NULL
     AND NEW.claimed_by IS DISTINCT FROM OLD.claimed_by
     AND OLD.status <> 'open' THEN
    RAISE EXCEPTION 'slot.claimed_by is write-once: slot % already has a claimant and cannot be reassigned (revoke the claim first)', OLD.id;
  END IF;

  IF OLD.claim_confirmed_at IS NOT NULL
     AND NEW.claim_confirmed_at IS DISTINCT FROM OLD.claim_confirmed_at THEN
    RAISE EXCEPTION 'slot.claim_confirmed_at is write-once: the confirmation on slot % cannot be rewritten', OLD.id;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER slot_claim_identity_write_once
  BEFORE UPDATE ON slot
  FOR EACH ROW EXECUTE FUNCTION guard_slot_claim_identity();