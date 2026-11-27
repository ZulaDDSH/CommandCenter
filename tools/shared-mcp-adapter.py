import ctypes
import json
import os
import re
import subprocess
import sys
from ctypes import wintypes
from pathlib import Path


def fail(message):
    print(message, file=sys.stderr)
    raise SystemExit(2)


def load_server():
    if len(sys.argv) != 2 or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", sys.argv[1]):
        fail("usage: shared-mcp-adapter.py <server-id>")
    try:
        data = json.loads(Path(__file__).with_name("registry.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        fail(f"cannot read registry.json: {exc}")
    if not isinstance(data, dict) or set(data) != {"version", "servers"} or type(data["version"]) is not int or data["version"] != 1 or not isinstance(data["servers"], dict):
        fail("invalid registry schema")
    entry = data["servers"].get(sys.argv[1])
    if not isinstance(entry, dict) or set(entry) != {"command", "args"} or not isinstance(entry["command"], str) or not entry["command"] or "\0" in entry["command"] or not isinstance(entry["args"], list) or any(not isinstance(arg, str) or "\0" in arg for arg in entry["args"]):
        fail("unknown server id or invalid server entry")
    return entry["command"], entry["args"]


def windows_job():
    class BasicLimit(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_longlong), ("PerJobUserTimeLimit", ctypes.c_longlong), ("LimitFlags", ctypes.c_ulong), ("MinimumWorkingSetSize", ctypes.c_size_t), ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", ctypes.c_ulong), ("Affinity", ctypes.c_size_t), ("PriorityClass", ctypes.c_ulong), ("SchedulingClass", ctypes.c_ulong)]

    class IoCounters(ctypes.Structure):
        _fields_ = [("ReadOperationCount", ctypes.c_ulonglong), ("WriteOperationCount", ctypes.c_ulonglong), ("OtherOperationCount", ctypes.c_ulonglong), ("ReadTransferCount", ctypes.c_ulonglong), ("WriteTransferCount", ctypes.c_ulonglong), ("OtherTransferCount", ctypes.c_ulonglong)]

    class ExtendedLimit(ctypes.Structure):
        _fields_ = [("BasicLimitInformation", BasicLimit), ("IoInfo", IoCounters), ("ProcessMemoryLimit", ctypes.c_size_t), ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t), ("PeakJobMemoryUsed", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateJobObjectW
    create.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
    create.restype = wintypes.HANDLE
    set_info = kernel.SetInformationJobObject
    set_info.argtypes = (wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
    set_info.restype = wintypes.BOOL
    assign = kernel.AssignProcessToJobObject
    assign.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    assign.restype = wintypes.BOOL
    current = kernel.GetCurrentProcess
    current.argtypes = ()
    current.restype = wintypes.HANDLE
    close = kernel.CloseHandle
    close.argtypes = (wintypes.HANDLE,)
    close.restype = wintypes.BOOL
    terminate_job = kernel.TerminateJobObject
    terminate_job.argtypes = (wintypes.HANDLE, wintypes.UINT)
    terminate_job.restype = wintypes.BOOL
    exit_process = kernel.ExitProcess
    exit_process.argtypes = (wintypes.UINT,)
    exit_process.restype = None
    job = create(None, None)
    if not job:
        raise OSError(ctypes.get_last_error(), "CreateJobObjectW failed")
    limits = ExtendedLimit()
    limits.BasicLimitInformation.LimitFlags = 0x00002000
    if not set_info(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise OSError(error, "SetInformationJobObject failed")
    if not assign(job, current()):
        error = ctypes.get_last_error()
        kernel.CloseHandle(job)
        raise OSError(error, "cannot assign adapter to Windows job")
    return kernel, job, assign


def windows_parent(kernel):
    class FileTime(ctypes.Structure):
        _fields_ = [("low", wintypes.DWORD), ("high", wintypes.DWORD)]

    query = kernel.OpenProcess
    query.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    query.restype = wintypes.HANDLE
    times = kernel.GetProcessTimes
    times.argtypes = (wintypes.HANDLE, ctypes.POINTER(FileTime), ctypes.POINTER(FileTime), ctypes.POINTER(FileTime), ctypes.POINTER(FileTime))
    times.restype = wintypes.BOOL
    wait = kernel.WaitForSingleObject
    wait.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    wait.restype = wintypes.DWORD
    parent_pid = os.getppid()
    if not parent_pid:
        raise OSError("cannot identify parent process")
    handle = query(0x00100000 | 0x001000, False, parent_pid)
    if not handle:
        raise OSError(ctypes.get_last_error(), "cannot open parent process")
    own_created, parent_created = FileTime(), FileTime()
    own_exit, own_kernel, own_user = FileTime(), FileTime(), FileTime()
    parent_exit, parent_kernel, parent_user = FileTime(), FileTime(), FileTime()
    if not times(kernel.GetCurrentProcess(), ctypes.byref(own_created), ctypes.byref(own_exit), ctypes.byref(own_kernel), ctypes.byref(own_user)) or not times(handle, ctypes.byref(parent_created), ctypes.byref(parent_exit), ctypes.byref(parent_kernel), ctypes.byref(parent_user)):
        error = ctypes.get_last_error()
        kernel.CloseHandle(handle)
        raise OSError(error, "cannot read process creation times")
    own_stamp = (own_created.high << 32) | own_created.low
    parent_stamp = (parent_created.high << 32) | parent_created.low
    if parent_stamp >= own_stamp or wait(handle, 0) != 0x102:
        kernel.CloseHandle(handle)
        raise OSError("parent process is not the adapter's live creator")
    return handle, wait


def main():
    command, args = load_server()
    if os.name != "nt":
        os.execvpe(command, [command, *args], os.environ)
    if command.lower().endswith((".cmd", ".bat")):
        fail("Windows .cmd/.bat commands are not supported")
    try:
        kernel, job, assign = windows_job()
        parent, wait_parent = windows_parent(kernel)
    except OSError as exc:
        fail(f"cannot create Windows job: {exc}")
    try:
        if wait_parent(parent, 0) != 0x102:
            fail("parent process exited before server launch")
        child = subprocess.Popen([command, *args], shell=False, close_fds=True)
        while child.poll() is None:
            if wait_parent(parent, 100) != 0x102:
                kernel.TerminateJobObject(job, 1)
                os._exit(1)
        code = child.returncode
    except OSError as exc:
        fail(f"cannot start server: {exc}")
    finally:
        kernel.CloseHandle(parent)
    kernel.ExitProcess(code)


if __name__ == "__main__":
    main()
