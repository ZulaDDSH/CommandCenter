import csv
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


ADAPTER = Path(__file__).with_name("shared-mcp-adapter.py")


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
