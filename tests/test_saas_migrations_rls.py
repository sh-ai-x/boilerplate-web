"""Regression tests for templates/saas/supabase/migrations/*.sql.

Pin the schema-level invariants the security review on PR #30 flagged:

  A01 - admin RLS policies MUST gate on auth.app_role(), never on
        auth.jwt()->>'role'. The latter is the PostgREST role
        ('authenticated' / 'anon' / 'service_role') and would NEVER
        match 'admin', silently breaking every admin write.

  A06 - every table referenced in a CREATE POLICY must exist by the
        time the policy is created. 0002_audit_log.sql installs a
        SELECT policy on public.audit_log, so public.audit_log MUST
        be created in 0001_init.sql (a migration that runs second on
        a fresh DB cannot rely on a sibling migration's CREATE TABLE).

  A06 - auth.app_role() must exist by the time any policy uses it.
        Defined in 0001_init.sql so plans_admin_write (which is also
        in 0001) can resolve it.

  A06 / A09 - 0003_upsert_plan_rpc.sql's actor_id MUST be validated
        server-side (NOT NULL + EXISTS in auth.users). The audit
        trail cannot be attributed to a UUID that does not exist
        (including the zero UUID 00000000-0000-0000-0000-000000000000).

Background: PR #26's gate rubber-stamped 'Verdict: Blocked' (14
findings, 3 critical). These tests pin the schema contracts so the
rubber-stamp regression cannot recur.

The SQL is tested by parsing the migration source as text — the same
language-tool-free technique used in scripts/extract-verdict tests so
the suite runs in the CI pytest env without a Postgres instance.

No mocks. Reads the SQL files as text, parses the create_table /
create_function / create_policy statements with regex, and asserts
on file order + content.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = REPO_ROOT / "templates" / "saas" / "supabase" / "migrations"


def _migration(name: str) -> str:
    return (MIGRATIONS / name).read_text()


class TestSaasMigrationsRLS(unittest.TestCase):
    """A01/A06 regression pins for PR #30.

    Each test asserts ONE invariant on the migration file(s). The
    order tests below assert that a CREATE TABLE / CREATE FUNCTION
    appears before every CREATE POLICY / USING clause that depends
    on it, so a fresh DB applying these migrations in lexicographic
    order never sees an 'undefined relation' or 'function does not
    exist' error.
    """

    # --- A01: no plans_admin_write-style RLS check on auth.jwt()->>'role' ----

    def test_no_jwt_top_level_role_in_rls_usings(self) -> None:
        """No policy in any migration may gate admin access on
        auth.jwt() ->> 'role'. That claim is the PostgREST role,
        NOT the app metadata role.
        """
        offenders = []
        for sql_path in sorted(MIGRATIONS.glob("*.sql")):
            text = sql_path.read_text()
            # Strip line comments before matching so we don't trip
            # on the rationale block in the header.
            stripped = re.sub(r"--.*$", "", text, flags=re.MULTILINE)
            for m in re.finditer(
                r"auth\.jwt\(\)\s*->>\s*'role'",
                stripped,
            ):
                line_no = stripped[: m.start()].count("\n") + 1
                offenders.append((sql_path.name, str(line_no), m.group(0)))
        self.assertEqual(
            offenders,
            [],
            "auth.jwt()->>'role' is the PostgREST role, not the app "
            "role. Use auth.app_role() instead. Offending matches: "
            + ", ".join(f"{f}:{ln}:{tok}" for f, ln, tok in offenders),
        )

    def test_app_role_used_for_admin_write_policies(self) -> None:
        """Every USING clause that compares to 'admin' must call
        auth.app_role(), not auth.jwt() directly. This is the
        fix's positive half - pin that the new helper is in use.
        """
        first = _migration("0001_init.sql")
        n = first.count("auth.app_role() = 'admin'")
        self.assertGreaterEqual(
            n,
            4,
            f"expected >= 4 auth.app_role() = 'admin' usages in 0001, got {n}",
        )
        second = _migration("0002_audit_log.sql")
        n2 = second.count("auth.app_role() = 'admin'")
        self.assertGreaterEqual(
            n2,
            1,
            f"expected >= 1 auth.app_role() usage in 0002, got {n2}",
        )

    # --- A06: tables referenced by policies MUST exist in an earlier file ----

    def test_audit_log_table_created_in_0001(self) -> None:
        """0002 installs a SELECT policy on public.audit_log, so
        0001 (the file that runs first) MUST create the table.
        Otherwise a fresh DB applying these migrations in order
        fails on the policy's table reference.
        """
        first = _migration("0001_init.sql")
        self.assertRegex(
            first,
            r"create table if not exists public\.audit_log",
            "0001_init.sql must CREATE TABLE public.audit_log "
            "before 0002's policy can attach",
        )

    def test_app_role_function_defined_in_0001(self) -> None:
        """plans_admin_write (in 0001) calls auth.app_role(), so
        the function definition must live in 0001 as well.
        """
        first = _migration("0001_init.sql")
        self.assertRegex(
            first,
            r"create or replace function auth\.app_role\(\)",
            "0001_init.sql must define auth.app_role() before "
            "plans_admin_write references it",
        )

    def test_0002_has_no_create_table(self) -> None:
        """0002's header explicitly says 'no CREATE TABLE of
        existing objects (the tables are owned by 0001_init.sql)'.
        Pin that contract.
        """
        second = _migration("0002_audit_log.sql")
        stripped = re.sub(r"--.*$", "", second, flags=re.MULTILINE)
        self.assertNotRegex(
            stripped,
            r"create table\b",
            "0002_audit_log.sql is ADDITIVE only - table CREATE "
            "statements belong in 0001_init.sql",
        )

    def test_0002_no_longer_defines_app_role(self) -> None:
        """auth.app_role() lives in 0001_init.sql (because plans
        admin RLS needs it). 0002 must NOT redefine it - Postgres
        treats 'create or replace' as a no-op on identical bodies,
        but if either file ever drifts the migration set will
        silently bifurcate. Pin single source of truth.
        """
        second = _migration("0002_audit_log.sql")
        self.assertNotRegex(
            second,
            r"create or replace function auth\.app_role",
            "auth.app_role() is owned by 0001_init.sql; 0002 must "
            "only consume it via the audit_log SELECT policy",
        )

    # --- cross-file ordering invariant -------------------------------------

    def test_create_table_before_create_policy_ordering(self) -> None:
        """For every (table, file) pair where file contains a
        CREATE POLICY on public.<table>, at least one EARLIER
        migration file (lex order) must contain a CREATE TABLE
        for public.<table>. This is a static cross-file check
        that catches the original bug class ('policy on table
        that is never created').
        """
        files = sorted(MIGRATIONS.glob("*.sql"))
        table_to_first_create = {}
        for sql_path in files:
            stripped = re.sub(
                r"--.*$", "", sql_path.read_text(), flags=re.MULTILINE
            )
            for m in re.finditer(
                r"create table if not exists public\.(\w+)",
                stripped,
            ):
                tbl = m.group(1)
                table_to_first_create.setdefault(tbl, sql_path.name)
        # Now scan every file's policies and confirm each referenced
        # table has an earlier-or-equal create.
        offenders = []
        for sql_path in files:
            stripped = re.sub(
                r"--.*$", "", sql_path.read_text(), flags=re.MULTILINE
            )
            for m in re.finditer(
                r'create policy\s+"[^"]+"\s+on public\.(\w+)',
                stripped,
            ):
                tbl = m.group(1)
                creator = table_to_first_create.get(tbl)
                if creator is None:
                    offenders.append(
                        f"{sql_path.name}: CREATE POLICY on public.{tbl} "
                        f"but no CREATE TABLE for public.{tbl} in any file"
                    )
                elif creator > sql_path.name:
                    offenders.append(
                        f"{sql_path.name}: CREATE POLICY on public.{tbl} "
                        f"but CREATE TABLE is in {creator} (later file)"
                    )
        self.assertEqual(
            offenders,
            [],
            "policy references table whose CREATE TABLE is missing "
            "or in a later migration file: " + "; ".join(offenders),
        )


class TestSaasUpsertPlanRPC(unittest.TestCase):
    """A09 regression pins for the admin Server Action's RPC.

    page.tsx calls supabase.rpc('upsert_plan_with_audit', ...) for every
    admin plan save. If the function does not exist, every admin write
    throws at runtime and the audit_log row never gets written. Pin:

      - function exists in 0003
      - signature matches page.tsx: (actor_id uuid, plan_id_in uuid,
        payload jsonb) returns uuid
      - SECURITY DEFINER (so service_role can run it without per-table grants)
      - locked down: revoked from public, granted to service_role only
    """

    def test_0003_defines_upsert_plan_with_audit(self) -> None:
        third = _migration("0003_upsert_plan_rpc.sql")
        self.assertRegex(
            third,
            r"create or replace function public\.upsert_plan_with_audit\(",
            "0003_upsert_plan_rpc.sql must CREATE the upsert_plan_with_audit "
            "function that page.tsx invokes",
        )

    def test_rpc_signature_matches_caller(self) -> None:
        """page.tsx calls .rpc('upsert_plan_with_audit', { actor_id,
        plan_id_in, payload }). The function signature MUST accept those
        exact names or the JS-side rpc() will fail.
        """
        third = _migration("0003_upsert_plan_rpc.sql")
        self.assertRegex(
            third,
            r"actor_id\s+uuid",
            "function must accept actor_id uuid",
        )
        self.assertRegex(
            third,
            r"plan_id_in\s+uuid",
            "function must accept plan_id_in uuid",
        )
        self.assertRegex(
            third,
            r"payload\s+jsonb",
            "function must accept payload jsonb",
        )
        self.assertRegex(
            third,
            r"returns uuid",
            "function must return uuid (the audit_log.id)",
        )

    def test_rpc_security_definer(self) -> None:
        """Service-role caller has no per-table INSERT/UPDATE grants on
        plans / audit_log. SECURITY DEFINER is the only way the call
        resolves without separate grant-on-table work.
        """
        third = _migration("0003_upsert_plan_rpc.sql")
        self.assertRegex(
            third,
            r"security\s+definer",
            "function must be SECURITY DEFINER so service_role can run it",
        )

    def test_rpc_locked_down(self) -> None:
        """The RPC is privileged (plan write + audit append). Lock it to
        service_role only — anon and authenticated must not be able to
        invoke it directly via PostgREST.
        """
        third = _migration("0003_upsert_plan_rpc.sql")
        self.assertRegex(
            third,
            r"revoke\s+all\s+on\s+function\s+public\.upsert_plan_with_audit",
            "function must be revoked from PUBLIC",
        )
        self.assertRegex(
            third,
            r"grant\s+execute\s+on\s+function\s+public\.upsert_plan_with_audit.*\s+to\s+service_role",
            "function must grant execute to service_role",
        )

    # --- A06 / A09: actor_id validation (audit-trail-spoof defense) ---
    #
    # The function takes actor_id as an argument and writes it into
    # audit_log.actor_id without a server-side check. Any future caller
    # could attribute the audit row to a UUID that does not correspond
    # to a real user (including 00000000-0000-0000-0000-000000000000),
    # destroying the forensic value of the audit trail. The fix is a
    # NOT NULL guard + an EXISTS check against auth.users. These tests
    # pin that contract.

    def test_actor_id_is_validated_as_not_null(self) -> None:
        third = _migration("0003_upsert_plan_rpc.sql")
        # Must have a NOT NULL check before any INSERT into audit_log
        # runs. The validator must mention actor_id by name (not just
        # a generic null guard) so an attacker cannot accidentally
        # bypass it by renaming the parameter.
        self.assertRegex(
            third,
            r"if\s+actor_id\s+is\s+null\s+then",
            "actor_id NOT NULL guard missing — the audit trail could be spoofed",
        )

    def test_actor_id_is_validated_against_auth_users(self) -> None:
        third = _migration("0003_upsert_plan_rpc.sql")
        # Must verify the actor_id corresponds to a real auth.users row.
        # Plain UUID format checks (regex) are insufficient — the database
        # is the source of truth for "is this a real user".
        self.assertRegex(
            third,
            r"from\s+auth\.users\s+where\s+id\s*=\s*actor_id",
            "actor_id must be checked against auth.users — the audit trail "
            "must not accept UUIDs that have no corresponding user row",
        )


class TestSaasAuditLogAppendOnly(unittest.TestCase):
    """A09: audit_log is append-only.

    RLS + REVOKE are not enough on their own: service_role bypasses
    RLS, and a permissive GRANT or future migration could silently
    re-grant UPDATE/DELETE. A trigger enforces append-only-ness
    INSIDE the same transaction as the mutating statement, so even
    a privileged caller cannot rewrite or scrub forensic rows.
    """

    def test_audit_log_has_block_mutations_trigger_function(self) -> None:
        second = _migration("0002_audit_log.sql")
        self.assertRegex(
            second,
            r"create\s+or\s+replace\s+function\s+public\.audit_log_block_mutations\s*\(\s*\)\s*returns\s+trigger",
            "audit_log must have a block-mutations trigger function "
            "that raises exception on UPDATE/DELETE",
        )

    def test_audit_log_has_no_update_trigger(self) -> None:
        second = _migration("0002_audit_log.sql")
        self.assertRegex(
            second,
            r"create\s+trigger\s+audit_log_no_update\s+before\s+update\s+on\s+public\.audit_log",
            "audit_log must have a BEFORE UPDATE trigger that fires the "
            "block-mutations function — UPDATE is the primary tampering vector",
        )

    def test_audit_log_has_no_delete_trigger(self) -> None:
        second = _migration("0002_audit_log.sql")
        self.assertRegex(
            second,
            r"create\s+trigger\s+audit_log_no_delete\s+before\s+delete\s+on\s+public\.audit_log",
            "audit_log must have a BEFORE DELETE trigger — DELETE is "
            "the mass-scrub vector and must be blocked at the SQL layer",
        )

    def test_audit_log_has_revoke_update_delete_defense_in_depth(self) -> None:
        second = _migration("0002_audit_log.sql")
        # Defense in depth: even with the trigger, REVOKE narrows the
        # attack surface so only service_role could attempt a
        # mutation. Service_role cannot actually mutate either
        # (the trigger fires for any role) but the REVOKE is the
        # first line of defense.
        self.assertRegex(
            second,
            r"revoke\s+update,\s*delete\s+on\s+public\.audit_log\s+from\s+public",
            "audit_log must revoke UPDATE/DELETE from PUBLIC as the first "
            "line of defense in addition to the trigger",
        )


if __name__ == "__main__":
    unittest.main()
