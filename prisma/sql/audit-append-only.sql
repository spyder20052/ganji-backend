-- Journal d'audit en ajout seul : toute modification ou suppression est refusée par la base,
-- même si l'application est compromise. Idempotent.
CREATE OR REPLACE FUNCTION alafia_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent est en ajout seul (% refusé)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_append_only ON "AuditEvent";
CREATE TRIGGER audit_append_only
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION alafia_audit_append_only();

-- TRUNCATE est aussi bloqué (sauf reset de démo qui désactive explicitement les triggers utilisateur).
DROP TRIGGER IF EXISTS audit_no_truncate ON "AuditEvent";
CREATE TRIGGER audit_no_truncate
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION alafia_audit_append_only();
