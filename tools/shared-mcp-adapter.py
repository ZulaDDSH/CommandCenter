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


def windows_search_dirs(application_dir, cwd, env, system_dirs, windows_dir, include_cwd):
    dirs = [application_dir]
    if include_cwd:
        dirs.append(cwd)
    dirs.extend(system_dirs)
    dirs.append(os.path.join(windows_dir, "System"))
    dirs.append(windows_dir)
    path_dirs = [part.strip().strip('"') for part in env.get("PATH", "").split(os.pathsep)]
    dirs.extend(part or cwd for part in path_dirs if part or include_cwd)
    return list(dict.fromkeys(os.path.normcase(os.path.abspath(item)) for item in dirs if item))


def _first_bare_exe(command, directories):
    if not command or any(sep in command for sep in ("/", "\\")) or command.lower().endswith((".cmd", ".bat")):
        raise ValueError("Windows adapter requires a bare executable name; .cmd and .bat commands are unsupported.")
    name = command if Path(command).suffix else command + ".exe"
    if Path(name).suffix.lower() != ".exe":
        raise ValueError("Windows adapter supports only .exe executable names.")
    for directory in directories:
        candidate = os.path.abspath(os.path.join(directory, name))
        if os.path.isfile(candidate):
            if not candidate.lower().endswith(".exe"):
                raise ValueError("Resolved command is not an .exe file.")
            return candidate
    return None


def resolve_bare_exe(command, client_search_dirs, adapter_search_dirs):
    client = _first_bare_exe(command, client_search_dirs)
    adapter = _first_bare_exe(command, adapter_search_dirs)
    if client is None or adapter is None:
        raise ValueError("Bare command did not resolve to an .exe under both client and adapter Windows search paths.")
    try:
        same = os.path.samefile(client, adapter)
    except OSError:
        same = os.path.normcase(os.path.realpath(client)) == os.path.normcase(os.path.realpath(adapter))
    if not same:
        raise ValueError("Bare command resolves to different executables for the client and adapter; refusing ambiguous launch.")
    return client


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
    image_size = wintypes.DWORD(32768)
    image = ctypes.create_unicode_buffer(image_size.value)
    image_query = kernel.QueryFullProcessImageNameW
    image_query.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))
    image_query.restype = wintypes.BOOL
    if not image_query(handle, 0, image, ctypes.byref(image_size)):
        error = ctypes.get_last_error()
        kernel.CloseHandle(handle)
        raise ctypes.WinError(error)
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
    return handle, wait, image.value


def windows_search_paths(kernel, parent_image, parent_handle, command):
    def get_directory(fn_name):
        fn = getattr(kernel, fn_name)
        fn.argtypes = (wintypes.LPWSTR, wintypes.UINT)
        fn.restype = wintypes.UINT
        buffer = ctypes.create_unicode_buffer(32768)
        length = fn(buffer, len(buffer))
        if not length or length >= len(buffer):
            raise ctypes.WinError(ctypes.get_last_error())
        return buffer.value

    if os.path.basename(parent_image).lower() in ("cmd.exe", "powershell.exe", "pwsh.exe"):
        raise RuntimeError("The adapter parent is a command shell, so the original MCP client executable search cannot be verified.")
    machine_query = getattr(kernel, "IsWow64Process2", None)
    if machine_query is None:
        raise RuntimeError("Cannot verify that the MCP client and Python adapter use the same Windows executable search architecture.")
    machine_query.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.USHORT), ctypes.POINTER(wintypes.USHORT))
    machine_query.restype = wintypes.BOOL
    parent_machine, parent_native = wintypes.USHORT(), wintypes.USHORT()
    adapter_machine, adapter_native = wintypes.USHORT(), wintypes.USHORT()
    if not machine_query(kernel.GetCurrentProcess(), ctypes.byref(adapter_machine), ctypes.byref(adapter_native)):
        raise ctypes.WinError(ctypes.get_last_error())
    if not machine_query(parent_handle, ctypes.byref(parent_machine), ctypes.byref(parent_native)):
        raise ctypes.WinError(ctypes.get_last_error())
    if (parent_machine.value or parent_native.value) != (adapter_machine.value or adapter_native.value):
        raise RuntimeError("The MCP client and Python adapter use different Windows architectures; executable search cannot be verified.")
    parent_dir = os.path.dirname(parent_image)
    cwd = os.getcwd()
    windows_dir = get_directory("GetWindowsDirectoryW")
    system_dir = get_directory("GetSystemDirectoryW")
    kernel.NeedCurrentDirectoryForExePathW.argtypes = (wintypes.LPCWSTR,)
    kernel.NeedCurrentDirectoryForExePathW.restype = wintypes.BOOL
    include_cwd = bool(kernel.NeedCurrentDirectoryForExePathW(command))
    client_dirs = windows_search_dirs(parent_dir, cwd, os.environ, [system_dir], windows_dir, include_cwd)
    adapter_dirs = windows_search_dirs(os.path.dirname(sys.executable), cwd, os.environ, [system_dir], windows_dir, include_cwd)
    return client_dirs, adapter_dirs


def main():
    command, args = load_server()
    if os.name != "nt":
        os.execvpe(command, [command, *args], os.environ)
    if command.lower().endswith((".cmd", ".bat")):
        fail("Windows .cmd/.bat commands are not supported")
    try:
        kernel, job, assign = windows_job()
        parent, wait_parent, parent_image = windows_parent(kernel)
        verified = None
        if not any(sep in command for sep in ("/", "\\")):
            client_dirs, adapter_dirs = windows_search_paths(kernel, parent_image, parent, command)
            verified = resolve_bare_exe(command, client_dirs, adapter_dirs)
    except OSError as exc:
        fail(f"cannot create Windows job: {exc}")
    except ValueError as exc:
        fail(str(exc))
    except RuntimeError as exc:
        fail(str(exc))
    try:
        if wait_parent(parent, 0) != 0x102:
            fail("parent process exited before server launch")
        child = subprocess.Popen([command, *args], executable=verified, shell=False, close_fds=True)
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
