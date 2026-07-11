-- Custom SQL migration file, put your code below! --

-- Make the audit table append-only at the database level: any UPDATE or
-- DELETE on audit raises, no matter which client issues it. Authored via
-- `drizzle-kit generate --custom` (custom migrations are the sanctioned way
-- to ship SQL drizzle can't express; never hand-edit GENERATED files).
-- The vitest suite `audit-immutable` asserts this trigger fires.
CREATE FUNCTION audit_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit table is append-only'; END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit
FOR EACH ROW EXECUTE FUNCTION audit_immutable();
