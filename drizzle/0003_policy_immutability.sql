-- A policy version is a promise a family was given; it never changes under
-- them. Every edit inserts version + 1 through
-- src/server/repositories/policy.ts, and this trigger is the backstop that
-- makes "no policy row is ever mutated" true at the database level.
--
-- TRUNCATE is deliberately unaffected: the demo reset wipes the tables and
-- reseeds rather than rewriting a version in place.
CREATE OR REPLACE FUNCTION reject_policy_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'policy is append-only: cannot % version %; create a new version instead',
    TG_OP, OLD.version;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER policy_immutable
  BEFORE UPDATE OR DELETE ON policy
  FOR EACH ROW EXECUTE FUNCTION reject_policy_mutation();
