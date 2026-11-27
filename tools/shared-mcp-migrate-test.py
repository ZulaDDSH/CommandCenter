import contextlib
import copy
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("shared-mcp-migrate.py")
SPEC = importlib.util.spec_from_file_location("shared_mcp_migrate_under_test", SCRIPT)
MIGRATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATE)


@unittest.skipUnless(os.name == "nt", "Windows DPAPI and ReplaceFileW behavior")
class SharedMcpMigrateTests(unittest.TestCase):
    keys = ("codex", "opencode", "registry", "adapter")

    def make_paths(self, root, absent=()):
        state = root / "private-state"
        state.mkdir()
        codex = root / "codex-config.toml"
        opencode = root / "opencode-config.json"
        registry = state / "registry.json"
        adapter = state / "shared-mcp-adapter.py"
        source_adapter = root / "source-adapter.py"
        originals = {
            "codex": (
                '[mcp_servers.prisma-mcp]\n'
                'enabled = false\n'
                'command = "node"\n'
                'args = ["prisma-mcp-old-sentinel"]\n\n'
                '[mcp_servers.reevesagents]\n'
                'enabled = false\n'
                'command = "node"\n'
                'args = ["reevesagents-old-sentinel"]\n'
            ).encode(),
            "opencode": json.dumps(
                {
                    "mcp": {
                        "prisma-mcp": {
                            "type": "local",
                            "enabled": False,
                            "command": ["node", "prisma-mcp-old-sentinel"],
                        },
                        "reevesagents": {
                            "type": "local",
                            "enabled": False,
                            "command": ["node", "reevesagents-old-sentinel"],
                        },
                    }
                },
                indent=2,
            ).encode(),
            "registry": json.dumps(
                {"version": 1, "servers": {"legacy": {"command": "old-registry-sentinel", "args": []}}},
                indent=2,
            ).encode(),
            "adapter": b"old-adapter-sentinel\n",
        }
        codex.write_bytes(originals["codex"])
        opencode.write_bytes(originals["opencode"])
        MIGRATE.secure_private_file(codex)
        MIGRATE.secure_private_file(opencode)
        if "registry" not in absent:
            registry.write_bytes(originals["registry"])
        if "adapter" not in absent:
            adapter.write_bytes(originals["adapter"])
        source_adapter.write_bytes(b"new-shared-adapter-payload\n")
        paths = {
            "codex": codex,
            "opencode": opencode,
            "registry": registry,
            "adapter": adapter,
            "journal": state / "transactions.jsonl",
            "source_adapter": source_adapter,
        }
        return paths, originals

    def run_migration(self, paths):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return MIGRATE.migrate(paths)

    def journal(self, path):
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def transaction_id(self, paths):
        return next(record["id"] for record in self.journal(paths["journal"]) if record["event"] == "prepared")

    def assert_originals(self, paths, originals, absent=()):
        for key in self.keys:
            if key in absent:
                self.assertFalse(paths[key].exists(), key)
            else:
                self.assertEqual(paths[key].read_bytes(), originals[key], key)

    def test_migration_updates_both_clients_and_registry(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = self.make_paths(Path(directory))
            txid = self.run_migration(paths)
            codex = MIGRATE.tomllib.loads(paths["codex"].read_text(encoding="utf-8"))
            opencode = json.loads(paths["opencode"].read_text(encoding="utf-8"))
            registry = json.loads(paths["registry"].read_text(encoding="utf-8"))
            for name in MIGRATE.NAME_IDS:
                with self.subTest(name=name):
                    self.assertEqual(codex["mcp_servers"][name]["command"], sys.executable)
                    self.assertEqual(codex["mcp_servers"][name]["args"], [str(paths["adapter"]), name])
                    self.assertEqual(
                        opencode["mcp"][name]["command"],
                        [sys.executable, str(paths["adapter"]), name],
                    )
                    self.assertEqual(registry["servers"][name]["command"], "node")
            self.assertEqual(paths["adapter"].read_bytes(), paths["source_adapter"].read_bytes())
            self.assertIn({"id": txid, "event": "committed"}, self.journal(paths["journal"]))

    def test_encrypted_journal_snapshots_and_displaced_bytes_support_rollback(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory))
            apply_step = MIGRATE.apply_step

            def interrupt_before_commit(*args):
                result = apply_step(*args)
                if args[2] == "opencode":
                    raise OSError("simulated interruption before commit")
                return result

            with mock.patch.object(MIGRATE, "apply_step", side_effect=interrupt_before_commit):
                with self.assertRaisesRegex(OSError, "before commit"):
                    self.run_migration(paths)
            txid = self.transaction_id(paths)
            records = self.journal(paths["journal"])
            prepared = next(record for record in records if record["id"] == txid and record["event"] == "prepared")
            for key in self.keys:
                with self.subTest(snapshot=key):
                    self.assertEqual(MIGRATE.unprotect(prepared["steps"][key]["snapshot"]), originals[key])
            displaced = {
                record["key"]: record
                for record in records
                if record["id"] == txid and record["event"] == "displaced"
            }
            self.assertEqual(set(displaced), set(self.keys))
            for key in self.keys:
                with self.subTest(displaced=key):
                    self.assertEqual(MIGRATE.unprotect(displaced[key]["encrypted"]), originals[key])
            raw_journal = paths["journal"].read_bytes()
            for marker in (b"old-sentinel", b"old-registry-sentinel", b"old-adapter-sentinel"):
                self.assertNotIn(marker, raw_journal)
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assert_originals(paths, originals)
            self.assertIn({"id": txid, "event": "rolled-back"}, self.journal(paths["journal"]))

    def test_committed_transaction_can_be_rolled_back(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory))
            txid = self.run_migration(paths)
            self.assertIn({"id": txid, "event": "committed"}, self.journal(paths["journal"]))
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assert_originals(paths, originals)
            self.assertIn({"id": txid, "event": "rolled-back"}, self.journal(paths["journal"]))

    def test_rollback_removes_registry_and_adapter_that_were_absent(self):
        absent = {"registry", "adapter"}
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory), absent=absent)
            apply_step = MIGRATE.apply_step

            def interrupt_after_registry(*args):
                result = apply_step(*args)
                if args[2] == "registry":
                    raise OSError("simulated interruption after creation")
                return result

            with mock.patch.object(MIGRATE, "apply_step", side_effect=interrupt_after_registry):
                with self.assertRaisesRegex(OSError, "after creation"):
                    self.run_migration(paths)
            txid = self.transaction_id(paths)
            self.assertTrue(paths["registry"].exists())
            self.assertTrue(paths["adapter"].exists())
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assert_originals(paths, originals, absent)

    def test_committed_rollback_removes_registry_and_adapter_that_were_absent(self):
        absent = {"registry", "adapter"}
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory), absent=absent)
            txid = self.run_migration(paths)
            self.assertIn({"id": txid, "event": "committed"}, self.journal(paths["journal"]))
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assert_originals(paths, originals, absent)

    def test_recovery_rolls_back_after_interruption_at_each_write(self):
        for stop_after in self.keys:
            with self.subTest(stop_after=stop_after), tempfile.TemporaryDirectory() as directory:
                paths, originals = self.make_paths(Path(directory))
                apply_step = MIGRATE.apply_step

                def interrupt_after_write(*args):
                    result = apply_step(*args)
                    if args[2] == stop_after:
                        raise OSError("simulated interruption after replacement")
                    return result

                with mock.patch.object(MIGRATE, "apply_step", side_effect=interrupt_after_write):
                    with self.assertRaisesRegex(OSError, "simulated interruption"):
                        self.run_migration(paths)
                txid = self.transaction_id(paths)
                self.assertIsNone(MIGRATE.recover(paths, txid))
                self.assertIsNone(MIGRATE.recover(paths, txid))
                for key in self.keys:
                    self.assertEqual(paths[key].read_bytes(), originals[key])

    def test_unresolved_transaction_blocks_another_migration_without_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = self.make_paths(Path(directory))
            apply_step = MIGRATE.apply_step

            def interrupt_after_registry(*args):
                result = apply_step(*args)
                if args[2] == "registry":
                    raise OSError("simulated interruption")
                return result

            with mock.patch.object(MIGRATE, "apply_step", side_effect=interrupt_after_registry):
                with self.assertRaisesRegex(OSError, "simulated interruption"):
                    self.run_migration(paths)
            before = {key: paths[key].read_bytes() if paths[key].exists() else None for key in (*self.keys, "journal")}
            with self.assertRaisesRegex(RuntimeError, "unresolved transaction"):
                self.run_migration(paths)
            after = {key: paths[key].read_bytes() if paths[key].exists() else None for key in (*self.keys, "journal")}
            self.assertEqual(after, before)

    def test_old_transaction_cannot_rollback_over_newer_committed_state(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = self.make_paths(Path(directory))
            old_txid = self.run_migration(paths)
            records = self.journal(paths["journal"])
            old_prepared = next(row for row in records if row.get("id") == old_txid and row.get("event") == "prepared")
            new_txid = str(uuid.uuid4())
            new_steps = copy.deepcopy(old_prepared["steps"])
            for key, step in new_steps.items():
                current = paths[key].read_bytes()
                step["before"] = MIGRATE.sha(current)
                step["after"] = MIGRATE.sha(current)
                step["backup"] = str(MIGRATE.displaced_for(paths, paths[key], new_txid, key))
                step["snapshot"] = MIGRATE.protect(current)
            MIGRATE.journal(paths["journal"], {"id": new_txid, "event": "prepared", "steps": new_steps})
            MIGRATE.journal(paths["journal"], {"id": new_txid, "event": "committed"})
            before = {key: paths[key].read_bytes() for key in self.keys}
            with self.assertRaisesRegex(RuntimeError, "latest non-rolled-back transaction"):
                MIGRATE.recover(paths, old_txid)
            self.assertEqual({key: paths[key].read_bytes() for key in self.keys}, before)

    def test_recovery_refuses_unrecognized_concurrent_edit_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = self.make_paths(Path(directory))
            apply_step = MIGRATE.apply_step

            def interrupt_after_registry(*args):
                result = apply_step(*args)
                if args[2] == "registry":
                    raise OSError("simulated interruption after replacement")
                return result

            with mock.patch.object(MIGRATE, "apply_step", side_effect=interrupt_after_registry):
                with self.assertRaisesRegex(OSError, "simulated interruption"):
                    self.run_migration(paths)
            txid = self.transaction_id(paths)
            concurrent = b"concurrent user edit\n"
            paths["codex"].write_bytes(concurrent)
            adapter_after_migration = paths["adapter"].read_bytes()
            with self.assertRaisesRegex((RuntimeError, ValueError), "conflict|changed|unexpected|hash|concurrent|unknown"):
                MIGRATE.recover(paths, txid)
            self.assertEqual(paths["codex"].read_bytes(), concurrent)
            self.assertEqual(paths["adapter"].read_bytes(), adapter_after_migration)

    def test_recovery_encrypts_and_preserves_edit_racing_its_replace(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory))
            apply_step = MIGRATE.apply_step

            def interrupt_after_final_write(*args):
                result = apply_step(*args)
                if args[2] == "opencode":
                    raise OSError("simulated interruption before commit")
                return result

            with mock.patch.object(MIGRATE, "apply_step", side_effect=interrupt_after_final_write):
                with self.assertRaisesRegex(OSError, "before commit"):
                    self.run_migration(paths)
            txid = self.transaction_id(paths)
            concurrent = b"concurrent edit during rollback replacement\n"
            move_replace = MIGRATE.move_replace
            raced = False

            def race_once(target, source, backup):
                nonlocal raced
                if Path(target) == paths["opencode"] and not raced:
                    paths["opencode"].write_bytes(concurrent)
                    raced = True
                return move_replace(target, source, backup)

            with mock.patch.object(MIGRATE, "move_replace", side_effect=race_once):
                with self.assertRaisesRegex(RuntimeError, "Unexpected displaced opencode content"):
                    MIGRATE.recover(paths, txid)
            self.assertTrue(raced)
            record = next(
                row for row in self.journal(paths["journal"])
                if row.get("id") == txid and row.get("event") == "rollback-displaced" and row.get("key") == "opencode"
            )
            self.assertEqual(MIGRATE.unprotect(record["encrypted"]), concurrent)
            self.assertEqual(Path(record["backup"]).read_bytes(), concurrent)
            self.assertEqual(paths["opencode"].read_bytes(), originals["opencode"])

    def test_migration_refuses_config_with_explicit_everyone_access(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = self.make_paths(Path(directory))
            subprocess.run(
                [str(MIGRATE.system_tool("icacls.exe")), str(paths["codex"]), "/grant", "*S-1-1-0:R"],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
            before = {key: paths[key].read_bytes() if paths[key].exists() else None for key in (*self.keys, "journal")}
            with self.assertRaisesRegex(RuntimeError, "unsupported principal"):
                self.run_migration(paths)
            after = {key: paths[key].read_bytes() if paths[key].exists() else None for key in (*self.keys, "journal")}
            self.assertEqual(after, before)

    def test_private_directory_removes_explicit_everyone_access(self):
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / "private-state"
            private.mkdir()
            MIGRATE.secure_private_dir(private)
            subprocess.run(
                [str(MIGRATE.system_tool("icacls.exe")), str(private), "/grant:r", "*S-1-1-0:(OI)(CI)M"],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
            with self.assertRaisesRegex(RuntimeError, "unsupported principal: S-1-1-0"):
                MIGRATE.validate_config_acl(private)
            MIGRATE.secure_private_dir(private)
            MIGRATE.validate_config_acl(private)


if __name__ == "__main__":
    unittest.main()
