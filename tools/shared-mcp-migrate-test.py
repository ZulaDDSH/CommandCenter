import contextlib
import ctypes
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

    def make_paths(self, root, absent=(), inherited_read=False, inherited_write=False):
        state = root / "private-state"
        state.mkdir()
        MIGRATE.secure_private_dir(state)
        clients = root
        if inherited_read or inherited_write:
            clients = root / "client-configs"
            clients.mkdir()
            MIGRATE.secure_private_dir(clients)
            subprocess.run(
                [
                    str(MIGRATE.system_tool("icacls.exe")),
                    str(clients),
                    "/grant:r",
                    f"*S-1-1-0:(OI)(CI){'M' if inherited_write else 'RX'}",
                ],
                check=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
        codex = clients / "codex-config.toml"
        opencode = clients / "opencode-config.json"
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
        if not inherited_read and not inherited_write:
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

    def assert_no_plaintext_backups(self, paths, journal, markers):
        data = journal.read_bytes()
        for marker in markers:
            self.assertNotIn(marker, data)
        self.assertFalse(list(journal.parent.glob("*.displaced")))
        self.assertFalse(list(journal.parent.glob("*.cc-*")))

    def make_stash_paths(self, root, stash_permissions="M", validate_stash=True):
        paths, originals = self.make_paths(root)
        codex_text = originals["codex"].decode()
        codex_text += (
            "\n[mcp_servers.gimp]\n"
            "enabled = false\n"
            'command = "node"\n'
            'args = ["gimp-original"]\n'
        )
        originals["codex"] = codex_text.encode()
        paths["codex"].write_bytes(originals["codex"])
        MIGRATE.secure_private_file(paths["codex"])
        stash_dir = root / "claude-stash"
        stash_dir.mkdir()
        MIGRATE.secure_private_dir(stash_dir)
        permissions = f"({stash_permissions})" if stash_permissions in ("WDAC", "WO") else stash_permissions
        subprocess.run(
            [str(MIGRATE.system_tool("icacls.exe")), str(stash_dir), "/grant:r", f"*S-1-5-11:(OI)(CI){permissions}"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        stash = stash_dir / "claude-stash.json"
        claude = root / ".claude.json"
        stash_data = {
            "version": 1,
            "entries": [
                {
                    "id": "stash-gimp-01",
                    "idx": 2,
                    "kind": "mcp",
                    "app": "Claude Code",
                    "file": str(claude),
                    "scope": ["mcpServers"],
                    "name": "gimp",
                    "cfg": {"type": "stdio", "command": "node", "args": ["gimp-original"], "env": {}},
                    "other": {"preserve": True},
                },
                {
                    "id": "stash-reeves-02",
                    "idx": 4,
                    "kind": "mcp",
                    "app": "Claude Code",
                    "file": str(claude),
                    "scope": ["mcpServers"],
                    "name": "reevesagents",
                    "cfg": {"type": "stdio", "command": "node", "args": ["reevesagents-old-sentinel"], "env": {}},
                    "other": {"preserve": "reeves"},
                },
                {"id": "unrelated-03", "idx": 6, "kind": "mcp", "app": "Claude Code", "file": str(claude), "scope": ["mcpServers"], "name": "unrelated", "cfg": {"type": "stdio", "command": "node", "args": ["unchanged"], "env": {}}, "metadata": [1, 2, 3]},
            ],
            "settings": {"preserve": "all"},
        }
        stash_bytes = b"\xef\xbb\xbf" + json.dumps(stash_data, indent=2).encode("utf-8")
        stash.write_bytes(stash_bytes)
        claude_bytes = json.dumps({"mcpServers": {}, "metadata": {"untouched": True}}, indent=2).encode()
        claude.write_bytes(claude_bytes)
        if validate_stash:
            self.assertTrue(MIGRATE.validate_config_acl(stash, allow_inherited_read=True, stash=True))
        MIGRATE.secure_private_file(claude)
        originals["stash"] = stash_bytes
        originals["claude"] = claude_bytes
        paths["stash"] = stash
        paths["claude"] = claude
        return paths, originals, stash_data, claude_bytes

    def make_incremental_paths(self, root):
        paths, originals, stash_data, claude_bytes = self.make_stash_paths(root)
        codex_text = originals["codex"].decode()
        for name, args, env in (
            ("f4-re-mcp", ["f4-original"], {"API_TOKEN": "codex-secret-f4"}),
            ("rea", ["rea-original"], {"API_KEY": "codex-secret-rea"}),
        ):
            env_table = "{ " + ", ".join(f"{json.dumps(key)} = {json.dumps(value)}" for key, value in env.items()) + " }"
            codex_text += (
                f"\n[mcp_servers.{name}]\n"
                "enabled = false\n"
                'command = "node"\n'
                f"args = {json.dumps(args)}\n"
                f"env = {env_table}\n"
            )
            stash_row = {
                "id": f"stash-{name}",
                "idx": len(stash_data["entries"]) + 2,
                "kind": "mcp",
                "app": "Claude Code",
                "file": str(paths["claude"]),
                "scope": ["mcpServers"],
                "name": name,
                "cfg": {"command": "node", "args": args, "env": {f"CLAUDE_{name.upper()}_TOKEN": f"claude-secret-{name}"}},
                "metadata": {"preserve": name},
            }
            if name == "f4-re-mcp":
                stash_row["cfg"]["type"] = "stdio"
            stash_data["entries"].append(stash_row)
        originals["codex_env"] = {
            "f4-re-mcp": {"API_TOKEN": "codex-secret-f4"},
            "rea": {"API_KEY": "codex-secret-rea"},
        }
        originals["codex"] = codex_text.encode()
        paths["codex"].write_bytes(originals["codex"])
        MIGRATE.secure_private_file(paths["codex"])
        stash_bytes = b"\xef\xbb\xbf" + json.dumps(stash_data, indent=2).encode("utf-8")
        paths["stash"].write_bytes(stash_bytes)
        originals["stash"] = stash_bytes
        return paths, originals, copy.deepcopy(stash_data), claude_bytes

    def test_inherited_broad_read_uses_txf_encryption_and_rolls_back(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory), inherited_read=True)
            for key in ("codex", "opencode"):
                self.assertTrue(MIGRATE.validate_config_acl(paths[key], allow_inherited_read=True))
            txid = self.run_migration(paths)
            records = self.journal(paths["journal"])
            prepared = next(row for row in records if row.get("id") == txid and row.get("event") == "prepared")
            self.assertEqual(prepared["backend"], "txf")
            for key in self.keys:
                with self.subTest(snapshot=key):
                    step = prepared["steps"][key]
                    self.assertEqual(MIGRATE.unprotect(step["snapshot"]), originals[key])
                    intended = MIGRATE.unprotect(step["intended"])
                    self.assertEqual(MIGRATE.sha(intended), step["after"])
            for key in ("codex", "opencode"):
                self.assertTrue(MIGRATE.validate_config_acl(paths[key], allow_inherited_read=True))
            self.assert_no_plaintext_backups(
                paths,
                paths["journal"],
                (b"old-sentinel", b"old-registry-sentinel", b"old-adapter-sentinel"),
            )
            self.assertFalse(any(row.get("id") == txid and row.get("event") == "displaced" for row in records))
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assert_originals(paths, originals)
            for key in ("codex", "opencode"):
                self.assertTrue(MIGRATE.validate_config_acl(paths[key], allow_inherited_read=True))
            self.assert_no_plaintext_backups(
                paths,
                paths["journal"],
                (b"old-sentinel", b"old-registry-sentinel", b"old-adapter-sentinel"),
            )

    def test_txf_rollback_removes_private_files_that_were_absent(self):
        absent = {"registry", "adapter"}
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory), absent=absent, inherited_read=True)
            txid = self.run_migration(paths)
            prepared = next(row for row in self.journal(paths["journal"]) if row.get("id") == txid and row.get("event") == "prepared")
            self.assertEqual(prepared["backend"], "txf")
            self.assertEqual(MIGRATE.unprotect(prepared["steps"]["registry"]["snapshot"]), MIGRATE.ABSENT)
            self.assertEqual(MIGRATE.unprotect(prepared["steps"]["adapter"]["snapshot"]), MIGRATE.ABSENT)
            self.assertTrue(paths["registry"].exists())
            self.assertTrue(paths["adapter"].exists())
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assert_originals(paths, originals, absent)
            self.assertFalse(list(paths["journal"].parent.glob("*.displaced")))
            self.assertFalse(list(paths["journal"].parent.glob("*.cc-*")))

    def test_migrates_claude_stash_entries_and_rollback_preserves_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals, stash_before, claude_before = self.make_stash_paths(Path(directory))
            txid = self.run_migration(paths)
            codex = MIGRATE.tomllib.loads(paths["codex"].read_text(encoding="utf-8"))
            stash_bytes = paths["stash"].read_bytes()
            self.assertTrue(stash_bytes.startswith(b"\xef\xbb\xbf"))
            stash_after = json.loads(stash_bytes.decode("utf-8-sig"))
            expected_stash = copy.deepcopy(stash_before)
            for row in expected_stash["entries"]:
                if row.get("name") in ("gimp", "reevesagents"):
                    row["cfg"]["command"] = sys.executable
                    row["cfg"]["args"] = [str(paths["adapter"]), row["name"]]
                    self.assertEqual(codex["mcp_servers"][row["name"]]["command"], sys.executable)
                    self.assertEqual(codex["mcp_servers"][row["name"]]["args"], row["cfg"]["args"])
            self.assertEqual(stash_after, expected_stash)
            self.assertEqual(paths["claude"].read_bytes(), claude_before)
            self.assertTrue(MIGRATE.validate_config_acl(paths["stash"], allow_inherited_read=True, stash=True))
            self.assertEqual(paths["adapter"].read_bytes(), paths["source_adapter"].read_bytes())
            self.assertIn({"id": txid, "event": "committed"}, self.journal(paths["journal"]))
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assert_originals(paths, originals)
            self.assertEqual(paths["stash"].read_bytes(), originals["stash"])
            self.assertEqual(paths["claude"].read_bytes(), originals["claude"])
            self.assertTrue(MIGRATE.validate_config_acl(paths["stash"], allow_inherited_read=True, stash=True))

    def test_stash_rejects_inherited_authenticated_users_write_dac_and_owner(self):
        for permission in ("WDAC", "WO"):
            with self.subTest(permission=permission), tempfile.TemporaryDirectory() as directory:
                paths, _, _, _ = self.make_stash_paths(
                    Path(directory), stash_permissions=permission, validate_stash=False
                )
                before = {key: paths[key].read_bytes() for key in (*self.keys, "stash", "claude")}
                with self.assertRaisesRegex(RuntimeError, "unsupported principal: S-1-5-11"):
                    self.run_migration(paths)
                after = {key: paths[key].read_bytes() for key in (*self.keys, "stash", "claude")}
                self.assertEqual(after, before)
                self.assertFalse(paths["journal"].exists())

    def test_incremental_claude_bindings_preserve_env_and_registry_excludes_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals, stash_before, claude_before = self.make_incremental_paths(Path(directory))
            txid = self.run_migration(paths)
            codex = MIGRATE.tomllib.loads(paths["codex"].read_text(encoding="utf-8"))
            stash_bytes = paths["stash"].read_bytes()
            stash_after = json.loads(stash_bytes.decode("utf-8-sig"))
            expected_stash = copy.deepcopy(stash_before)
            for name in ("gimp", "reevesagents", "f4-re-mcp", "rea"):
                codex_entry = codex["mcp_servers"][name]
                self.assertEqual(codex_entry["command"], sys.executable)
                self.assertEqual(codex_entry["args"], [str(paths["adapter"]), name])
                row = next(item for item in expected_stash["entries"] if item.get("name") == name)
                row["cfg"]["command"] = sys.executable
                row["cfg"]["args"] = [str(paths["adapter"]), name]
                if name in ("f4-re-mcp", "rea"):
                    self.assertEqual(codex_entry["env"], originals["codex_env"][name])
            self.assertEqual(stash_after, expected_stash)
            registry_bytes = paths["registry"].read_bytes()
            registry_text = registry_bytes.decode("utf-8")
            self.assertNotIn(b"codex-secret-f4", registry_bytes)
            self.assertNotIn(b"codex-secret-rea", registry_bytes)
            self.assertNotIn(b"claude-secret", registry_bytes)
            registry = json.loads(registry_text)
            for name in ("f4-re-mcp", "rea"):
                original_arg = "f4-original" if name == "f4-re-mcp" else "rea-original"
                self.assertEqual(registry["servers"][name], {"command": "node", "args": [original_arg]})
                self.assertNotIn("env", registry["servers"][name])
            opencode = json.loads(paths["opencode"].read_text(encoding="utf-8"))
            self.assertNotIn("f4-re-mcp", opencode["mcp"])
            self.assertNotIn("rea", opencode["mcp"])
            self.assertEqual(paths["claude"].read_bytes(), claude_before)
            self.assertEqual(paths["adapter"].read_bytes(), paths["source_adapter"].read_bytes())
            committed = self.journal(paths["journal"])
            self.assertIn({"id": txid, "event": "committed"}, committed)
            journal_before_repeat = paths["journal"].read_bytes()
            self.assertIsNone(self.run_migration(paths))
            self.assertEqual(paths["journal"].read_bytes(), journal_before_repeat)
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assert_originals(paths, originals)
            self.assertEqual(paths["stash"].read_bytes(), originals["stash"])
            self.assertEqual(paths["claude"].read_bytes(), originals["claude"])

    def test_incremental_binding_resolves_already_migrated_adapter_entry(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals, _, _ = self.make_incremental_paths(Path(directory))
            codex = originals["codex"].decode()
            codex = codex.replace(
                '[mcp_servers.f4-re-mcp]\nenabled = false\ncommand = "node"\nargs = ["f4-original"]',
                f'[mcp_servers.f4-re-mcp]\nenabled = false\ncommand = {json.dumps(sys.executable)}\nargs = {json.dumps([str(paths["adapter"]), "f4-re-mcp"])}',
            )
            self.assertNotEqual(codex, originals["codex"].decode())
            paths["codex"].write_text(codex, encoding="utf-8")
            registry = json.loads(paths["registry"].read_text(encoding="utf-8"))
            registry["servers"]["f4-re-mcp"] = {"command": "node", "args": ["f4-original"]}
            paths["registry"].write_text(json.dumps(registry), encoding="utf-8")
            self.assertIsNotNone(self.run_migration(paths))
            migrated = MIGRATE.tomllib.loads(paths["codex"].read_text(encoding="utf-8"))
            self.assertEqual(migrated["mcp_servers"]["f4-re-mcp"]["args"], [str(paths["adapter"]), "f4-re-mcp"])

    def test_incremental_unmatched_stash_launch_fails_without_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, _, stash_data, _ = self.make_incremental_paths(Path(directory))
            for row in stash_data["entries"]:
                if row.get("name") == "f4-re-mcp":
                    row["cfg"]["args"] = ["mismatched-launch"]
            paths["stash"].write_bytes(b"\xef\xbb\xbf" + json.dumps(stash_data, indent=2).encode("utf-8"))
            participant_keys = (*self.keys, "stash", "claude")
            before = {key: paths[key].read_bytes() for key in participant_keys}
            with self.assertRaises((ValueError, RuntimeError)):
                self.run_migration(paths)
            after = {key: paths[key].read_bytes() for key in participant_keys}
            self.assertEqual(after, before)
            self.assertFalse(paths["journal"].exists())

    def test_txf_refuses_inherited_broad_write_access(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, _ = self.make_paths(Path(directory), inherited_write=True)
            before = {key: paths[key].read_bytes() if paths[key].exists() else None for key in (*self.keys, "journal")}
            with self.assertRaisesRegex(RuntimeError, "unsupported principal: S-1-1-0"):
                self.run_migration(paths)
            after = {key: paths[key].read_bytes() if paths[key].exists() else None for key in (*self.keys, "journal")}
            self.assertEqual(after, before)

    def test_txf_stale_snapshot_conflict_preserves_competing_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory), inherited_read=True)
            concurrent = b"competing writer config\n"
            txf_step = MIGRATE.txf_step
            wrote = False

            def inject_writer(transaction, target, before, after, **options):
                nonlocal wrote
                if Path(target) == paths["codex"] and not wrote:
                    paths["codex"].write_bytes(concurrent)
                    wrote = True
                return txf_step(transaction, target, before, after, **options)

            with mock.patch.object(MIGRATE, "txf_step", side_effect=inject_writer):
                with self.assertRaisesRegex(RuntimeError, "concurrent change"):
                    self.run_migration(paths)
            self.assertTrue(wrote)
            self.assertEqual(paths["codex"].read_bytes(), concurrent)
            for key in ("opencode", "registry", "adapter"):
                self.assertEqual(paths[key].read_bytes(), originals[key])
            self.assertFalse(paths["journal"].exists())
            self.assertFalse(list(paths["journal"].parent.glob("*.displaced")))
            self.assertFalse(list(paths["journal"].parent.glob("*.cc-*")))

    def test_txf_accepts_short_path_with_case_variation(self):
        with tempfile.TemporaryDirectory() as directory:
            long_root = Path(directory) / "Long Path Fixture"
            long_root.mkdir()
            paths, _ = self.make_paths(long_root, inherited_read=True)
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            get_short = kernel32.GetShortPathNameW
            get_short.argtypes = (ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint32)
            get_short.restype = ctypes.c_uint32
            short_buffer = ctypes.create_unicode_buffer(32768)
            length = get_short(str(paths["codex"]), short_buffer, len(short_buffer))
            self.assertGreater(length, 0)
            short_target = Path(short_buffer.value.swapcase())
            if os.path.normcase(str(short_target)) == os.path.normcase(str(paths["codex"])):
                self.skipTest("The runner volume does not provide a distinct 8.3 path for this fixture")
            txf_step = MIGRATE.txf_step

            def use_short_target(transaction, target, before, after, **options):
                if Path(target) == paths["codex"]:
                    target = short_target
                return txf_step(transaction, target, before, after, **options)

            with mock.patch.object(MIGRATE, "txf_step", side_effect=use_short_target):
                self.run_migration(paths)
            codex = MIGRATE.tomllib.loads(paths["codex"].read_text(encoding="utf-8"))
            self.assertEqual(codex["mcp_servers"]["prisma-mcp"]["args"], [str(paths["adapter"]), "prisma-mcp"])

    @unittest.skipUnless(os.name == "nt", "TxF writer locking is Windows-specific")
    def test_txf_open_nontransactional_writer_blocks_transactional_write(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory), inherited_read=True)
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            create_file = kernel32.CreateFileW
            create_file.argtypes = (ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p)
            create_file.restype = ctypes.c_void_p
            close_handle = kernel32.CloseHandle
            close_handle.argtypes = (ctypes.c_void_p,)
            close_handle.restype = ctypes.c_int
            handle = create_file(str(paths["codex"]), 0x40000000, 0x00000001, None, 3, 0x00000080, None)
            self.assertNotEqual(handle, ctypes.c_void_p(-1).value)
            try:
                with self.assertRaises(OSError) as caught:
                    self.run_migration(paths)
                self.assertIn(getattr(caught.exception, "winerror", None), (32, 6800))
            finally:
                close_handle(handle)
            self.assert_originals(paths, originals)
            self.assertFalse(paths["journal"].exists())
            self.assertFalse(list(paths["journal"].parent.glob("*.displaced")))
            self.assertFalse(list(paths["journal"].parent.glob("*.cc-*")))

    def test_txf_failure_aborts_all_participants_without_plaintext_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            paths, originals = self.make_paths(Path(directory), inherited_read=True)
            txf_transaction = MIGRATE.txf_transaction

            @contextlib.contextmanager
            def fail_before_commit():
                with txf_transaction() as transaction:
                    yield transaction
                    raise OSError("simulated TxF commit failure")

            with mock.patch.object(MIGRATE, "txf_transaction", side_effect=fail_before_commit):
                with self.assertRaisesRegex(OSError, "simulated TxF commit failure"):
                    self.run_migration(paths)
            self.assert_originals(paths, originals)
            records = self.journal(paths["journal"])
            txid = self.transaction_id(paths)
            self.assertTrue(any(row.get("id") == txid and row.get("event") == "prepared" for row in records))
            self.assertFalse(any(row.get("id") == txid and row.get("event") == "committed" for row in records))
            self.assert_no_plaintext_backups(
                paths,
                paths["journal"],
                (b"old-sentinel", b"old-registry-sentinel", b"old-adapter-sentinel"),
            )
            self.assertIsNone(MIGRATE.recover(paths, txid))
            self.assert_originals(paths, originals)

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
