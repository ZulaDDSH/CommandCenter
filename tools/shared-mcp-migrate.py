import argparse
import base64
import ctypes
import copy
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
import tomllib
import uuid
from ctypes import wintypes
from pathlib import Path


NAME_IDS = ("prisma-mcp", "reevesagents")
ABSENT = b"\0CC-ABSENT\0"
SECRET = re.compile(r"(?:^|[^a-z])(?:api[_-]?key|access[_-]?token|token|password|passwd|secret|authorization|bearer|key)(?:$|[^a-z])", re.I)
ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def snap(data):
    return ABSENT if data is None else data


def read(path):
    try:
        return path.read_bytes()
    except FileNotFoundError:
        return None


def reject_links(path):
    for item in (path, *path.parents):
        try:
            meta = item.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(meta.st_mode) or getattr(meta, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
            raise ValueError(f"Reparse points are not supported in migration paths: {item}")


def safe_command(command, args):
    if not isinstance(command, str) or not command or "\0" in command:
        raise ValueError("Unsupported empty or invalid command.")
    if not isinstance(args, list) or not all(isinstance(arg, str) and "\0" not in arg for arg in args):
        raise ValueError("Command arguments must be strings without NUL characters.")
    if SECRET.search(command) or any(SECRET.search(arg) or ASSIGNMENT.match(arg) for arg in args):
        raise ValueError("Credential-bearing command lines are not eligible for migration.")
    return {"command": command, "args": args}


def safe_fields(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if SECRET.search(str(key)) or str(key).lower() in ("env", "environment", "headers", "url"):
                raise ValueError("Credential, environment, or remote configuration is not eligible for migration.")
            safe_fields(child)
    elif isinstance(value, list):
        for child in value:
            safe_fields(child)


def strict_json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs)


def protect(data):
    if os.name != "nt":
        raise RuntimeError("Windows DPAPI is required.")

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    raw = ctypes.create_string_buffer(data)
    src, dst = Blob(len(data), ctypes.cast(raw, ctypes.POINTER(ctypes.c_byte))), Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    crypt = crypt32.CryptProtectData
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    crypt.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.restype = wintypes.BOOL
    free = kernel.LocalFree
    free.argtypes = [ctypes.c_void_p]
    free.restype = ctypes.c_void_p
    if not crypt(ctypes.byref(src), "Command Center MCP transaction", None, None, None, 0x1, ctypes.byref(dst)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        encrypted = ctypes.string_at(dst.pbData, dst.cbData)
        return base64.b64encode(encrypted).decode("ascii")
    finally:
        free(ctypes.cast(dst.pbData, ctypes.c_void_p))


def unprotect(value):
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]

    encrypted = base64.b64decode(value, validate=True)
    raw = ctypes.create_string_buffer(encrypted)
    src, dst = Blob(len(encrypted), ctypes.cast(raw, ctypes.POINTER(ctypes.c_byte))), Blob()
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    crypt = crypt32.CryptUnprotectData
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    crypt.argtypes = [ctypes.POINTER(Blob), ctypes.POINTER(wintypes.LPWSTR), ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.restype = wintypes.BOOL
    free = kernel.LocalFree
    free.argtypes = [ctypes.c_void_p]
    free.restype = ctypes.c_void_p
    if not crypt(ctypes.byref(src), None, None, None, None, 0, ctypes.byref(dst)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(dst.pbData, dst.cbData)
    finally:
        free(ctypes.cast(dst.pbData, ctypes.c_void_p))


def _skip(text, i):
    while i < len(text) and text[i] in " \t\r\n":
        i += 1
    return i


def _json_spans(text, i=0):
    i = _skip(text, i)
    if text[i] == "{":
        out, i = {}, i + 1
        i = _skip(text, i)
        while text[i] != "}":
            key, j = json.JSONDecoder().raw_decode(text, i)
            if key in out:
                raise ValueError(f"Duplicate JSON key: {key}")
            i = _skip(text, j)
            if text[i] != ":":
                raise ValueError("Invalid JSON object.")
            start = _skip(text, i + 1)
            _, end, child = _json_spans(text, start)
            out[key] = (start, end, child)
            i = _skip(text, end)
            if text[i] == ",":
                i = _skip(text, i + 1)
            elif text[i] != "}":
                raise ValueError("Invalid JSON object separator.")
        return out, i + 1, out
    if text[i] == "[":
        out, i = [], i + 1
        i = _skip(text, i)
        while text[i] != "]":
            _, end, child = _json_spans(text, i)
            out.append((i, end, child))
            i = _skip(text, end)
            if text[i] == ",":
                i = _skip(text, i + 1)
            elif text[i] != "]":
                raise ValueError("Invalid JSON array separator.")
        return out, i + 1, out
    _, end = json.JSONDecoder().raw_decode(text, i)
    return None, end, None


def update_json(data, ids, adapter, python):
    text = data.decode("utf-8")
    obj = strict_json(text)
    if not isinstance(obj, dict) or not isinstance(obj.get("mcp"), dict):
        raise ValueError("OpenCode config has no plain mcp object.")
    _, _, root = _json_spans(text)
    mcp_span = root.get("mcp")
    if not mcp_span or not isinstance(mcp_span[2], dict):
        raise ValueError("OpenCode mcp object is ambiguous.")
    mcp_tree = mcp_span[2]
    expected = copy.deepcopy(obj)
    updated, replacements = {}, []
    for name in ids:
        cfg = obj["mcp"].get(name)
        entry_span = mcp_tree.get(name)
        if not isinstance(cfg, dict) or cfg.get("enabled") is not False or cfg.get("type") != "local":
            raise ValueError(f"OpenCode {name} must be an explicitly disabled local server.")
        safe_fields(cfg)
        command = cfg.get("command")
        if not isinstance(command, list) or not command:
            raise ValueError(f"OpenCode {name} command must be a nonempty array.")
        normalized = safe_command(command[0], command[1:])
        updated[name] = normalized
        if not entry_span or not isinstance(entry_span[2], dict):
            raise ValueError(f"OpenCode {name} entry position is ambiguous.")
        cmd_span = entry_span[2].get("command")
        if not cmd_span:
            raise ValueError(f"OpenCode {name} command position is ambiguous.")
        replacement = json.dumps([python, str(adapter), name], ensure_ascii=False)
        replacements.append((cmd_span[0], cmd_span[1], replacement))
        expected["mcp"][name]["command"] = [python, str(adapter), name]
    for start, end, replacement in sorted(replacements, reverse=True):
        text = text[:start] + replacement + text[end:]
    reparsed = strict_json(text)
    if reparsed != expected:
        raise ValueError("OpenCode semantic round-trip validation failed.")
    return updated, text.encode("utf-8")


def update_toml(data, ids, adapter, python):
    text = data.decode("utf-8-sig")
    obj = tomllib.loads(text)
    servers = obj.get("mcp_servers")
    if not isinstance(servers, dict):
        raise ValueError("Codex config has no mcp_servers table.")
    lines = text.splitlines(keepends=True)
    hdr = re.compile(r'^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|\'([^\']+)\'|([A-Za-z0-9_-]+))\s*\]\s*(?:#.*)?(?:\r?\n)?$')
    starts = [i for i, line in enumerate(lines) if hdr.match(line)]
    locations = {}
    for idx, line in enumerate(lines):
        match = hdr.match(line)
        if match:
            name = next((g for g in match.groups() if g is not None), None)
            locations[name] = idx
    if len([n for n in starts if next((g for g in hdr.match(lines[n]).groups() if g is not None), None) in ids]) != len(ids):
        raise ValueError("Codex server table is missing or duplicated.")
    expected = copy.deepcopy(obj)
    commands = {}
    for name in ids:
        cfg = servers.get(name)
        if not isinstance(cfg, dict) or cfg.get("enabled") is not False:
            raise ValueError(f"Codex {name} must be explicitly disabled.")
        safe_fields(cfg)
        commands[name] = safe_command(cfg.get("command"), cfg.get("args"))
        start = locations[name]
        end = next((i for i in range(start + 1, len(lines)) if re.match(r"^\s*\[", lines[i])), len(lines))
        if any(re.match(r"^\s*\[\[", line) for line in lines[start + 1:end]):
            raise ValueError(f"Codex {name} contains unsupported nested tables.")
        seen = set()
        for i in range(start + 1, end):
            m = re.match(r"^(\s*)(command|args)(\s*=\s*)(.*?)(\r?\n)?$", lines[i])
            if not m:
                continue
            key = m.group(2)
            if key in seen:
                raise ValueError(f"Codex {name} has duplicate {key} keys.")
            seen.add(key)
            value = json.dumps(python if key == "command" else [python, str(adapter), name], ensure_ascii=False) if key == "command" else json.dumps([python, str(adapter), name])
            comment = ""
            raw = m.group(4)
            if "#" in raw:
                raw, comment = raw.split("#", 1)
                comment = " #" + comment
            if "\n" in raw or "\r" in raw:
                raise ValueError(f"Codex {name} {key} value is multiline.")
            lines[i] = m.group(1) + key + m.group(3) + value + comment + (m.group(5) or "")
        if seen != {"command", "args"}:
            raise ValueError(f"Codex {name} must have one direct command and args assignment.")
        parsed = tomllib.loads("".join(lines))
        now = parsed["mcp_servers"][name]
        if now.get("command") != python or now.get("args") != [str(adapter), name]:
            raise ValueError(f"Codex {name} semantic validation failed.")
        expected["mcp_servers"][name]["command"] = python
        expected["mcp_servers"][name]["args"] = [str(adapter), name]
    if tomllib.loads("".join(lines)) != expected:
        raise ValueError("Codex semantic round-trip validation failed.")
    return commands, "".join(lines).encode("utf-8")


def paths(args):
    home = Path.home()
    local = Path(os.environ.get("LOCALAPPDATA", home / "AppData/Local")) / "CommandCenter" / "shared-mcp"
    return {
        "codex": args.codex or home / ".codex/config.toml",
        "opencode": args.opencode or home / ".config/opencode/opencode.json",
        "adapter": local / "shared-mcp-adapter.py",
        "registry": local / "registry.json",
        "journal": local / "transactions.jsonl",
        "lock": local / "migration.lock",
        "source_adapter": Path(__file__).with_name("shared-mcp-adapter.py"),
    }


def windows_lock(path):
    import msvcrt
    reject_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    secure_private_dir(path.parent)
    f = path.open("a+b")
    f.seek(0)
    if not f.read(1):
        f.write(b"\0")
        f.flush()
    f.seek(0)
    try:
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        f.close()
        raise RuntimeError("Another migration transaction is active.")
    return f


def secure_private_dir(directory):
    if os.name != "nt":
        raise RuntimeError("Private transaction storage requires Windows ACLs.")
    import subprocess
    reject_links(directory)
    sid = current_sid()
    grants = [f"*{sid}:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]
    icacls = str(system_tool("icacls.exe"))
    subprocess.run([icacls, str(directory), "/reset"], capture_output=True, text=True, check=True)
    subprocess.run([icacls, str(directory), "/inheritance:r", "/grant:r", *grants], capture_output=True, text=True, check=True)
    subprocess.run([icacls, str(directory), "/verify"], capture_output=True, text=True, check=True)
    fd, probe = tempfile.mkstemp(prefix=".acl-check-", dir=directory)
    os.close(fd)
    Path(probe).unlink()
    candidates = [directory / name for name in ("registry.json", "shared-mcp-adapter.py", "transactions.jsonl", "migration.lock")]
    candidates.extend(directory.glob("*.displaced"))
    candidates.extend(directory.glob("*.cc-*"))
    for candidate in candidates:
        reject_links(candidate)
        if candidate.exists():
            secure_private_file(candidate, grants)


def secure_private_file(file, grants=None):
    import subprocess
    if grants is None:
        sid = current_sid()
        grants = [f"*{sid}:(OI)(CI)F", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"]
    icacls = str(system_tool("icacls.exe"))
    file_grants = [f"{grant.split(':', 1)[0]}:F" for grant in grants]
    subprocess.run([icacls, str(file), "/reset"], capture_output=True, text=True, check=True)
    subprocess.run([icacls, str(file), "/inheritance:r", "/grant:r", *file_grants], capture_output=True, text=True, check=True)
    subprocess.run([icacls, str(file), "/verify"], capture_output=True, text=True, check=True)
    with file.open("r+b"):
        pass


def system_tool(name):
    root = os.environ.get("SystemRoot")
    if not root:
        raise RuntimeError("SystemRoot is unavailable; Windows ACL tools cannot be resolved safely.")
    tool = Path(root) / "System32" / name
    if not tool.is_file():
        raise RuntimeError(f"Required Windows ACL tool is missing: {tool}")
    return tool


def current_sid():
    import csv
    import subprocess
    who = subprocess.run([str(system_tool("whoami.exe")), "/user", "/fo", "csv", "/nh"], capture_output=True, text=True, check=True)
    row = next(csv.reader([line for line in who.stdout.splitlines() if line.strip()]))
    sid = row[-1]
    if not re.fullmatch(r"S-1-(?:\d+-){1,14}\d+", sid):
        raise RuntimeError("Could not determine the current Windows user SID.")
    return sid


def validate_config_acl(file):
    if os.name != "nt":
        raise RuntimeError("Windows ACL validation is required before config replacement.")
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    owner, dacl, descriptor = ctypes.c_void_p(), ctypes.c_void_p(), ctypes.c_void_p()
    get_info = advapi.GetNamedSecurityInfoW
    get_info.argtypes = [wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_void_p)]
    get_info.restype = wintypes.DWORD
    code = get_info(str(file), 1, 0x1 | 0x4, ctypes.byref(owner), None, ctypes.byref(dacl), None, ctypes.byref(descriptor))
    if code:
        raise OSError(code, "Could not inspect the MCP config ACL.")
    try:
        allowed = {current_sid(), "S-1-5-18", "S-1-5-32-544"}
        control, revision = wintypes.WORD(), wintypes.DWORD()
        get_control = advapi.GetSecurityDescriptorControl
        get_control.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.WORD), ctypes.POINTER(wintypes.DWORD)]
        get_control.restype = wintypes.BOOL
        if not get_control(descriptor, ctypes.byref(control), ctypes.byref(revision)) or not control.value & 0x4:
            raise RuntimeError(f"{file} has no inspectable DACL.")
        if owner.value:
            owner_sid = sid_text(owner.value, advapi, kernel)
            if owner_sid not in allowed:
                raise RuntimeError(f"{file} has an unsupported ACL owner.")
        class AclInfo(ctypes.Structure):
            _fields_ = [("AceCount", wintypes.DWORD), ("AclBytesInUse", wintypes.DWORD), ("AclBytesFree", wintypes.DWORD)]
        info = AclInfo()
        get_acl = advapi.GetAclInformation
        get_acl.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.c_int]
        get_acl.restype = wintypes.BOOL
        if not dacl.value or not get_acl(dacl, ctypes.byref(info), ctypes.sizeof(info), 2):
            raise RuntimeError(f"{file} has an empty or unreadable DACL.")
        get_ace = advapi.GetAce
        get_ace.argtypes = [ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p)]
        get_ace.restype = wintypes.BOOL
        for index in range(info.AceCount):
            ace = ctypes.c_void_p()
            if not get_ace(dacl, index, ctypes.byref(ace)):
                raise ctypes.WinError(ctypes.get_last_error())
            ace_type = ctypes.c_ubyte.from_address(ace.value).value
            if ace_type != 0:
                raise RuntimeError(f"{file} has a non-allow ACL entry; refusing migration.")
            sid = sid_text(ace.value + 8, advapi, kernel)
            if sid not in allowed:
                raise RuntimeError(f"{file} grants access to an unsupported principal: {sid}.")
        if not owner.value or sid_text(owner.value, advapi, kernel) not in allowed:
            raise RuntimeError(f"{file} owner is not in the allowed principal set.")
    finally:
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        kernel.LocalFree(descriptor)


def sid_text(pointer, advapi, kernel):
    out = wintypes.LPWSTR()
    convert = advapi.ConvertSidToStringSidW
    convert.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.LPWSTR)]
    convert.restype = wintypes.BOOL
    if not convert(ctypes.c_void_p(pointer), ctypes.byref(out)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return out.value
    finally:
        kernel.LocalFree.argtypes = [ctypes.c_void_p]
        kernel.LocalFree.restype = ctypes.c_void_p
        kernel.LocalFree(ctypes.cast(out, ctypes.c_void_p))


def journal(path, event):
    if path.exists():
        secure_private_file(path)
    line = (json.dumps(event, separators=(",", ":")) + "\n").encode()
    with path.open("ab") as out:
        out.write(line)
        out.flush()
        os.fsync(out.fileno())


def read_journal(path):
    raw = path.read_bytes()
    lines = raw.splitlines(keepends=True)
    if lines and not lines[-1].endswith(b"\n"):
        lines.pop()
    return [strict_json(line.decode("utf-8")) for line in lines if line.strip()]


def repair_journal_tail(path):
    if not path.exists():
        return
    raw = path.read_bytes()
    if raw and not raw.endswith(b"\n"):
        end = raw.rfind(b"\n") + 1
        with path.open("r+b") as out:
            out.truncate(end)
            out.flush()
            os.fsync(out.fileno())


def transaction_states(records):
    order, states = [], {}
    for row in records:
        txid, event = row.get("id"), row.get("event")
        if not isinstance(txid, str):
            continue
        if event == "prepared":
            if txid in states:
                raise ValueError("Duplicate transaction preparation record in journal.")
            order.append(txid)
            states[txid] = "prepared"
        elif txid in states and event in ("committed", "rolled-back"):
            states[txid] = event
    return order, states


def journal_displaced(path, txid, key, backup, expected, event):
    if not backup.exists():
        return
    secure_private_file(backup)
    displaced = backup.read_bytes()
    encrypted = protect(displaced)
    journal(path, {"id": txid, "event": event, "key": key, "hash": sha(displaced), "encrypted": encrypted, "backup": str(backup)})
    if sha(displaced) != expected:
        raise RuntimeError(f"Unexpected displaced {key} content is encrypted and preserved at {backup}.")
    backup.unlink()


def move_replace(target, source, backup):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    replace = kernel.ReplaceFileW
    replace.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p]
    replace.restype = wintypes.BOOL
    if not replace(str(target), str(source), str(backup), 0x1, None, None):
        raise ctypes.WinError(ctypes.get_last_error())


def atomic_new(target, source):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    move = kernel.MoveFileExW
    move.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
    move.restype = wintypes.BOOL
    if not move(str(source), str(target), 0x8):
        raise ctypes.WinError(ctypes.get_last_error())


def move_no_replace(source, target):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    move = kernel.MoveFileExW
    move.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
    move.restype = wintypes.BOOL
    if not move(str(source), str(target), 0x8):
        raise ctypes.WinError(ctypes.get_last_error())


def temp_for(target, data, private_dir):
    if target.parent.stat().st_dev != private_dir.stat().st_dev:
        raise RuntimeError(f"{target} is on another volume from private transaction storage; refusing replacement.")
    fd, name = tempfile.mkstemp(prefix=target.name + ".cc-", dir=private_dir)
    with os.fdopen(fd, "wb") as out:
        out.write(data)
        out.flush()
        os.fsync(out.fileno())
    return Path(name)


def displaced_for(paths, target, txid, key, phase="apply"):
    return paths["journal"].parent / f"{txid}-{key}-{phase}.displaced"


def secure_record(path, record):
    journal(path, record)


def apply_step(paths, txid, key, intended, expected_before):
    target = paths[key]
    reject_links(target)
    prior = read(target)
    if sha(snap(prior)) != expected_before:
        raise RuntimeError(f"Concurrent change detected before replacing {target}.")
    temp = temp_for(target, intended, paths["journal"].parent)
    backup = displaced_for(paths, target, txid, key)
    step = {"id": txid, "event": "step-planned", "key": key, "target": str(target), "temp": str(temp), "backup": str(backup), "before": expected_before, "after": sha(intended)}
    secure_record(paths["journal"], step)
    try:
        if prior is None:
            atomic_new(target, temp)
            displaced = None
        else:
            move_replace(target, temp, backup)
            secure_private_file(backup)
            displaced = read(backup)
        live = read(target)
        if displaced is not None:
            encrypted = protect(displaced)
            secure_record(paths["journal"], {"id": txid, "event": "displaced", "key": key, "hash": sha(displaced), "encrypted": encrypted, "backup": str(backup)})
            if sha(displaced) != expected_before:
                secure_record(paths["journal"], {"id": txid, "event": "conflict", "key": key, "live": sha(snap(live)), "displaced": sha(displaced), "backup": str(backup)})
                raise RuntimeError(f"Displaced version differed from the expected {key} hash; both versions were retained for recovery.")
            backup.unlink()
        if sha(snap(live)) != sha(intended):
            secure_record(paths["journal"], {"id": txid, "event": "conflict", "key": key, "live": sha(snap(live)), "expected": sha(intended), "backup": str(backup)})
            raise RuntimeError(f"Live {key} version differed after replacement; displaced content is retained for recovery.")
        secure_record(paths["journal"], {"id": txid, "event": "step-done", "key": key, "hash": sha(intended)})
        return True
    finally:
        if temp.exists():
            temp.unlink()


def load_current_registry(path):
    data = read(path)
    if data is None:
        return {"version": 1, "servers": {}}, data
    obj = strict_json(data.decode("utf-8"))
    if not isinstance(obj, dict) or set(obj) != {"version", "servers"} or type(obj["version"]) is not int or obj["version"] != 1 or not isinstance(obj["servers"], dict):
        raise ValueError("Existing shared registry has an unsupported schema.")
    for name, entry in obj["servers"].items():
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", name) or not isinstance(entry, dict) or set(entry) != {"command", "args"}:
            raise ValueError("Existing registry server entry is unsupported.")
        safe_command(entry["command"], entry["args"])
    return obj, data


def migrate(paths):
    for key in ("codex", "opencode", "adapter", "registry", "journal"):
        reject_links(paths[key])
    for key in ("codex", "opencode", "adapter", "registry"):
        if paths[key].parent.stat().st_dev != paths["journal"].parent.stat().st_dev:
            raise RuntimeError(f"{paths[key]} is on a different volume from private transaction storage.")
    repair_journal_tail(paths["journal"])
    records = read_journal(paths["journal"]) if paths["journal"].exists() else []
    _, states = transaction_states(records)
    pending = [txid for txid, state in states.items() if state == "prepared"]
    if pending:
        raise RuntimeError(f"An unresolved transaction must be recovered first: {pending[-1]}")
    for key in ("codex", "opencode"):
        if read(paths[key]) is None:
            raise ValueError(f"Missing config: {paths[key]}")
        validate_config_acl(paths[key])
    if not paths["source_adapter"].is_file():
        raise ValueError("The shared adapter source is missing from this installation.")
    codex_original, open_original = read(paths["codex"]), read(paths["opencode"])
    codex_entries, codex_new = update_toml(codex_original, NAME_IDS, paths["adapter"], sys.executable)
    open_entries, open_new = update_json(open_original, NAME_IDS, paths["adapter"], sys.executable)
    if codex_entries != open_entries:
        raise ValueError("Codex and OpenCode registrations are not semantically identical.")
    registry, registry_original = load_current_registry(paths["registry"])
    for name, entry in codex_entries.items():
        if name in registry["servers"] and registry["servers"][name] != entry:
            raise ValueError(f"Existing registry entry {name} conflicts with the client config.")
        registry["servers"][name] = entry
    registry_new = (json.dumps(registry, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    adapter_original = read(paths["adapter"])
    adapter_new = paths["source_adapter"].read_bytes()
    participants = {
        "codex": (codex_original, codex_new),
        "opencode": (open_original, open_new),
        "registry": (registry_original, registry_new),
        "adapter": (adapter_original, adapter_new),
    }
    txid = str(uuid.uuid4())
    steps = {key: {"path": str(paths[key]), "before": sha(snap(old)), "after": sha(new), "backup": str(displaced_for(paths, paths[key], txid, key)), "snapshot": protect(snap(old))} for key, (old, new) in participants.items()}
    journal(paths["journal"], {"id": txid, "event": "prepared", "steps": steps})
    for key in ("adapter", "registry", "codex", "opencode"):
        apply_step(paths, txid, key, participants[key][1], steps[key]["before"])
    journal(paths["journal"], {"id": txid, "event": "committed"})
    print(f"Migrated prisma-mcp and reevesagents. Transaction: {txid}")
    return txid


def recover(paths, txid):
    try:
        uuid.UUID(txid)
    except ValueError as error:
        raise ValueError("Invalid transaction id.") from error
    records = read_journal(paths["journal"])
    order, states = transaction_states(records)
    if states.get(txid) == "rolled-back":
        print(f"Transaction {txid} was already rolled back.")
        return
    latest = next((candidate for candidate in reversed(order) if states[candidate] != "rolled-back"), None)
    if latest != txid:
        raise RuntimeError(f"Only the latest non-rolled-back transaction can be recovered: {latest}")
    prepared = next((r for r in reversed(records) if r.get("id") == txid and r.get("event") == "prepared"), None)
    if not prepared or not isinstance(prepared.get("steps"), dict) or set(prepared["steps"]) != {"codex", "opencode", "registry", "adapter"}:
        raise ValueError("Prepared transaction was not found or has an unsupported journal schema.")
    allowed_paths = {key: paths[key].resolve() for key in prepared["steps"]}
    originals = {}
    states = {}
    for key, step in prepared["steps"].items():
        reject_links(paths[key])
        if Path(step.get("path", "")).resolve() != allowed_paths[key]:
            raise ValueError("Journal participant path does not match the configured fixed path.")
        backup = Path(step.get("backup", ""))
        reject_links(backup)
        if backup.resolve() != displaced_for(paths, paths[key], txid, key).resolve():
            raise ValueError("Journal backup path is outside the private transaction directory.")
        original = unprotect(step["snapshot"])
        if sha(original) != step["before"]:
            raise ValueError(f"Encrypted {key} snapshot failed its hash check.")
        originals[key] = original
        journal_displaced(paths["journal"], txid, key, backup, step["before"], "recovered-displaced")
        rb = displaced_for(paths, paths[key], txid, key, "rollback")
        if rb.exists():
            journal_displaced(paths["journal"], txid, key, rb, step["after"], "recovered-rollback-displaced")
        current = sha(snap(read(paths[key])))
        if current not in (step["before"], step["after"]):
            raise RuntimeError(f"Recovery stopped before changes: {key} has an unknown concurrent version ({current}).")
        states[key] = current
    for key in ("opencode", "codex", "registry", "adapter"):
        if states[key] == prepared["steps"][key]["before"]:
            continue
        target = paths[key]
        recovery_backup = displaced_for(paths, target, txid, key, "rollback")
        if recovery_backup.exists():
            raise RuntimeError(f"Recovery backup already exists for {key}; inspect it manually.")
        original = originals[key]
        if original == ABSENT:
            move_no_replace(target, recovery_backup)
            journal_displaced(paths["journal"], txid, key, recovery_backup, prepared["steps"][key]["after"], "rollback-displaced")
        else:
            temp = temp_for(target, original, paths["journal"].parent)
            try:
                move_replace(target, temp, recovery_backup)
            finally:
                if temp.exists():
                    temp.unlink()
            journal_displaced(paths["journal"], txid, key, recovery_backup, prepared["steps"][key]["after"], "rollback-displaced")
        if sha(snap(read(target))) != prepared["steps"][key]["before"]:
            raise RuntimeError(f"Restored {key} failed its hash check.")
        journal(paths["journal"], {"id": txid, "event": "rollback-step-done", "key": key})
    journal(paths["journal"], {"id": txid, "event": "rolled-back"})
    print(f"Rolled back interrupted transaction {txid}.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex", type=Path)
    parser.add_argument("--opencode", type=Path)
    parser.add_argument("--recover", metavar="TRANSACTION_ID")
    args = parser.parse_args()
    p = paths(args)
    if os.name != "nt":
        raise RuntimeError("This migration is Windows-only.")
    reject_links(p["journal"])
    reject_links(p["lock"])
    lock = windows_lock(p["lock"])
    try:
        repair_journal_tail(p["journal"])
        if args.recover:
            recover(p, args.recover)
        else:
            migrate(p)
    finally:
        import msvcrt
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        lock.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Migration refused: {error}", file=sys.stderr)
        sys.exit(1)
