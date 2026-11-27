import csv
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


ADAPTER = Path(__file__).with_name("shared-mcp-adapter.py")
SPEC = importlib.util.spec_from_file_location("shared_mcp_adapter_under_test", ADAPTER)
ADAPTER_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADAPTER_MODULE)


class SharedMcpAdapterTests(unittest.TestCase):
    def make_install(self, root, entry):
        tools = root / "tools"
        tools.mkdir()
        adapter = tools / ADAPTER.name
        adapter.write_bytes(ADAPTER.read_bytes())
        registry = {"version": 1, "servers": {"sample": entry}}
        (tools / "registry.json").write_text(json.dumps(registry), encoding="utf-8")
        return adapter, tools / "registry.json"

    def test_stdio_is_forwarded(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            server = root / "stdio_server.py"
            server.write_text(
                "import sys\n"
                "for line in sys.stdin:\n"
                "    print(line.rstrip() + '|reply', flush=True)\n",
                encoding="utf-8",
            )
            adapter, _ = self.make_install(
                root,
                {"command": sys.executable, "args": [str(server)]},
            )
            process = subprocess.Popen(
                [sys.executable, str(adapter), "sample"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            output, error = process.communicate("request|payload\n", timeout=10)
            self.assertEqual(process.returncode, 0, error)
            self.assertEqual(output, "request|payload|reply\n")

    def test_invalid_registry_and_server_id_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            adapter, registry = self.make_install(
                root,
                {"command": sys.executable, "args": []},
            )
            for contents, server_id, expected in (
                ('{"version":2,"servers":{}}', "sample", "invalid registry schema"),
                (json.dumps({"version": 1, "servers": {}}), "missing", "unknown server id"),
            ):
                with self.subTest(expected=expected):
                    registry.write_text(contents, encoding="utf-8")
                    result = subprocess.run(
                        [sys.executable, str(adapter), server_id],
                        capture_output=True,
                        text=True,
                        timeout=10,
                    )
                    self.assertEqual(result.returncode, 2)
                    self.assertIn(expected, result.stderr)

    @unittest.skipUnless(os.name == "nt", "Windows executable search behavior")
    def test_bare_executable_rejects_parent_and_python_directory_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client_dir = root / "client"
            python_dir = root / "python"
            client_dir.mkdir()
            python_dir.mkdir()
            client_exe = client_dir / "sample.exe"
            python_exe = python_dir / "sample.exe"
            client_exe.write_bytes(b"client candidate")
            python_exe.write_bytes(b"python candidate")
            with self.assertRaisesRegex(ValueError, "different executables"):
                ADAPTER_MODULE.resolve_bare_exe("sample", [client_dir], [python_dir])

    @unittest.skipUnless(os.name == "nt", "Windows PATH search behavior")
    def test_bare_executable_accepts_same_path_collision_from_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client_dir = root / "client"
            python_dir = root / "python"
            path_dir = root / "path"
            for path in (client_dir, python_dir, path_dir):
                path.mkdir()
            candidate = path_dir / "sample.exe"
            candidate.write_bytes(Path(sys.executable).read_bytes())
            resolved = ADAPTER_MODULE.resolve_bare_exe("sample", [client_dir, path_dir], [python_dir, path_dir])
            self.assertEqual(os.path.normcase(os.path.abspath(resolved)), os.path.normcase(str(candidate.resolve())))

    @unittest.skipUnless(os.name == "nt", "Windows PATH search behavior")
    def test_bare_executable_rejects_application_directory_path_collision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            client_dir = root / "client"
            python_dir = root / "python"
            path_dir = root / "path"
            for path in (client_dir, python_dir, path_dir):
                path.mkdir()
            (client_dir / "sample.exe").write_bytes(b"client application candidate")
            (path_dir / "sample.exe").write_bytes(b"PATH candidate")
            with self.assertRaisesRegex(ValueError, "different executables"):
                ADAPTER_MODULE.resolve_bare_exe("sample", [client_dir, path_dir], [python_dir, path_dir])

    @unittest.skipUnless(os.name == "nt", "Windows adapter launch behavior")
    def test_bare_launch_inherits_environment_and_cwd_without_shell(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            launch_cwd = root / "launch cwd"
            launch_cwd.mkdir()
            script = (
                "import json, os, sys; "
                "print(json.dumps({'cwd': os.getcwd(), 'env': os.environ['ADAPTER_TEST_MARKER'], 'args': sys.argv[1:]}))"
            )
            argument = "value&echo-shell-spawned"
            adapter, _ = self.make_install(
                root,
                {"command": Path(sys.executable).stem, "args": ["-c", script, argument]},
            )
            env = os.environ.copy()
            env["ADAPTER_TEST_MARKER"] = "inherited-value"
            env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
            result = subprocess.run(
                [sys.executable, str(adapter), "sample"],
                cwd=launch_cwd,
                env=env,
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                json.loads(result.stdout),
                {"cwd": str(launch_cwd), "env": "inherited-value", "args": [argument]},
            )
            self.assertNotIn("shell-spawned", result.stdout)

    @unittest.skipUnless(os.name == "nt", "Windows job object behavior")
    def test_server_and_grandchild_exit_when_client_dies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pid_file = root / "pids.json"
            grandchild = root / "grandchild.py"
            grandchild.write_text("import time\ntime.sleep(120)\n", encoding="utf-8")
            server = root / "server.py"
            server.write_text(
                "import json, subprocess, sys, time\n"
                f"child = subprocess.Popen([sys.executable, {str(grandchild)!r}])\n"
                f"open({str(pid_file)!r}, 'w', encoding='utf-8').write(json.dumps([__import__('os').getpid(), child.pid]))\n"
                "time.sleep(120)\n",
                encoding="utf-8",
            )
            adapter, _ = self.make_install(
                root,
                {"command": sys.executable, "args": [str(server)]},
            )
            client_script = root / "client.py"
            adapter_pid_file = root / "adapter.pid"
            log = root / "adapter.log"
            client_script.write_text(
                "import subprocess, sys, time\n"
                f"log = open({str(log)!r}, 'w', encoding='utf-8')\n"
                f"adapter = subprocess.Popen([sys.executable, {str(adapter)!r}, 'sample'], stdin=subprocess.DEVNULL, stdout=log, stderr=log)\n"
                f"open({str(adapter_pid_file)!r}, 'w', encoding='utf-8').write(str(adapter.pid))\n"
                "adapter.wait()\n",
                encoding="utf-8",
            )
            client = subprocess.Popen([sys.executable, str(client_script)])
            try:
                self.wait_for_file(adapter_pid_file)
                self.wait_for_file(pid_file)
                adapter_pid = int(adapter_pid_file.read_text(encoding="utf-8"))
                server_pid, grandchild_pid = json.loads(pid_file.read_text(encoding="utf-8"))
                client.kill()
                client.wait(timeout=10)
                for pid in (adapter_pid, server_pid, grandchild_pid):
                    self.assert_process_exits(pid)
            finally:
                if client.poll() is None:
                    client.kill()
                    client.wait(timeout=10)
                if adapter_pid_file.exists():
                    self.kill_tree(int(adapter_pid_file.read_text(encoding="utf-8")))

    @unittest.skipUnless(os.name == "nt", "Windows job object behavior")
    def test_server_and_grandchild_exit_when_adapter_dies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pid_file = root / "pids.json"
            grandchild = root / "grandchild.py"
            grandchild.write_text("import time\ntime.sleep(120)\n", encoding="utf-8")
            server = root / "server.py"
            server.write_text(
                "import json, subprocess, sys, time\n"
                f"child = subprocess.Popen([sys.executable, {str(grandchild)!r}])\n"
                f"open({str(pid_file)!r}, 'w', encoding='utf-8').write(json.dumps([__import__('os').getpid(), child.pid]))\n"
                "time.sleep(120)\n",
                encoding="utf-8",
            )
            adapter, _ = self.make_install(
                root,
                {"command": sys.executable, "args": [str(server)]},
            )
            client_script = root / "client.py"
            adapter_pid_file = root / "adapter.pid"
            client_script.write_text(
                "import subprocess, sys\n"
                f"adapter = subprocess.Popen([sys.executable, {str(adapter)!r}, 'sample'], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)\n"
                f"open({str(adapter_pid_file)!r}, 'w', encoding='utf-8').write(str(adapter.pid))\n"
                "adapter.wait()\n",
                encoding="utf-8",
            )
            client = subprocess.Popen([sys.executable, str(client_script)])
            try:
                self.wait_for_file(adapter_pid_file)
                self.wait_for_file(pid_file)
                adapter_pid = int(adapter_pid_file.read_text(encoding="utf-8"))
                server_pid, grandchild_pid = json.loads(pid_file.read_text(encoding="utf-8"))
                subprocess.run(
                    ["taskkill", "/PID", str(adapter_pid), "/F"],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                for pid in (server_pid, grandchild_pid):
                    self.assert_process_exits(pid)
            finally:
                if client.poll() is None:
                    client.kill()
                    client.wait(timeout=10)
                if adapter_pid_file.exists():
                    self.kill_tree(int(adapter_pid_file.read_text(encoding="utf-8")))

    def wait_for_file(self, path):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if path.exists():
                return
            time.sleep(0.05)
        self.fail(f"timed out waiting for {path.name}")

    def assert_process_exits(self, pid):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if not any(len(row) > 1 and row[1].strip() == str(pid) for row in csv.reader(result.stdout.splitlines())):
                return
            time.sleep(0.1)
        self.fail(f"process {pid} did not exit")

    def kill_tree(self, pid):
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            timeout=10,
        )


if __name__ == "__main__":
    unittest.main()
