# DeckHQ — what Windows says an app window and a shortcut are called.
#
# A taskbar button is grouped, and a pin is resolved, by an AppUserModelID. The
# browser gives DeckHQ's app window one; a pin of that window is drawn from the
# Start Menu shortcut carrying the SAME id, and from the browser's own
# executable — the browser's icon — when no shortcut carries it. Neither the id
# on a window nor the id in a `.lnk` is reachable from `WScript.Shell`, so this
# is the second and last place in the package that has to ask Windows itself.
#
# THIS SCRIPT IS FIXED TEXT AND NOTHING IS EVER INTERPOLATED INTO IT. Node runs
# it with `-File`, never `-Command`, for the reason `shortcut.ps1` gives. Every
# value that is not a bare number or a fixed word arrives in `-SpecFile`, a JSON
# document DeckHQ wrote under its own state directory.
#
#   -Action windows -ProcessId N   every visible top-level window of that one
#                                  process, as a JSON array: pid, title, class,
#                                  aumid, and the relaunch command, icon and
#                                  name. The measuring form.
#   -Action look -SpecFile F       F is {"profileDir":..., "waitMs":N,
#                                  "paths":[...]}. Print {"windows":[...],
#                                  "links":[...]}: the windows of the browser
#                                  that was started with THAT
#                                  `--user-data-dir` (waiting up to waitMs for
#                                  one to exist), and what each `.lnk` in paths
#                                  says — id, target, arguments, description,
#                                  icon. Changes nothing.
#   -Action stamp -SpecFile F      F is {"paths":[...], "aumid":..., "tag":...}.
#                                  Set that ONE property on those shortcuts,
#                                  and only on one whose description carries
#                                  the tag. Everything else in the file is left
#                                  as it was. Prints the links as read back.
#
# `stamp` refuses a shortcut that is not tagged as ours, here as well as in the
# caller, so the rule holds even if the caller is wrong.
#
# Exit code is 0 on success and 1 on any failure, with the reason on stderr.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('windows', 'look', 'stamp')]
  [string]$Action,

  [int]$ProcessId = 0,
  [string]$SpecFile
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace DeckHQ {
  [StructLayout(LayoutKind.Sequential, Pack = 4)]
  public struct PropertyKey {
    public Guid fmtid;
    public uint pid;
    public PropertyKey(Guid f, uint p) { fmtid = f; pid = p; }
  }

  // A PROPVARIANT, as far as this file needs one: a type and one pointer.
  [StructLayout(LayoutKind.Explicit, Size = 24)]
  public struct PropVariant {
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointer;
  }

  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out PropertyKey key);
    [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
    [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
    [PreserveSig] int Commit();
  }

  [ComImport, Guid("000214F9-0000-0000-C000-000000000046"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellLinkW {
    [PreserveSig] int GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int cch, IntPtr findData, uint flags);
    [PreserveSig] int GetIDList(out IntPtr pidl);
    [PreserveSig] int SetIDList(IntPtr pidl);
    [PreserveSig] int GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int cch);
    [PreserveSig] int SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
    [PreserveSig] int GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int cch);
    [PreserveSig] int SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
    [PreserveSig] int GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int cch);
    [PreserveSig] int SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
    [PreserveSig] int GetHotkey(out ushort hotkey);
    [PreserveSig] int SetHotkey(ushort hotkey);
    [PreserveSig] int GetShowCmd(out int showCmd);
    [PreserveSig] int SetShowCmd(int showCmd);
    [PreserveSig] int GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int cch, out int index);
    [PreserveSig] int SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
    [PreserveSig] int SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string path, uint reserved);
    [PreserveSig] int Resolve(IntPtr hwnd, uint flags);
    [PreserveSig] int SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
  }

  [ComImport, Guid("0000010B-0000-0000-C000-000000000046"),
   InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPersistFile {
    [PreserveSig] int GetClassID(out Guid classId);
    [PreserveSig] int IsDirty();
    [PreserveSig] int Load([MarshalAs(UnmanagedType.LPWStr)] string file, uint mode);
    [PreserveSig] int Save([MarshalAs(UnmanagedType.LPWStr)] string file, [MarshalAs(UnmanagedType.Bool)] bool remember);
    [PreserveSig] int SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string file);
    [PreserveSig] int GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string file);
  }

  [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
  public class ShellLink { }

  public class WindowInfo {
    public int pid;
    public string title;
    public string windowClass;
    public string aumid;
    public string relaunchCommand;
    public string relaunchIcon;
    public string relaunchName;
  }

  public class LinkInfo {
    public string path;
    public string aumid;
    public string target;
    public string arguments;
    public string description;
    public string iconLocation;
  }

  public static class Taskbar {
    static readonly Guid AppUserModel = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    const ushort VT_LPWSTR = 31;

    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out IPropertyStore store);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);

    static string Read(IPropertyStore store, uint pid) {
      PropertyKey key = new PropertyKey(AppUserModel, pid);
      PropVariant value = new PropVariant();
      if (store.GetValue(ref key, out value) != 0) return null;
      try {
        return value.vt == VT_LPWSTR ? Marshal.PtrToStringUni(value.pointer) : null;
      } finally {
        PropVariantClear(ref value);
      }
    }

    public static WindowInfo[] Windows(int onlyPid) {
      List<WindowInfo> found = new List<WindowInfo>();
      Guid iid = typeof(IPropertyStore).GUID;
      EnumWindows(delegate(IntPtr hwnd, IntPtr lParam) {
        if (!IsWindowVisible(hwnd)) return true;
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        if (onlyPid != 0 && pid != (uint)onlyPid) return true;
        IPropertyStore store;
        if (SHGetPropertyStoreForWindow(hwnd, ref iid, out store) != 0 || store == null) return true;
        try {
          string aumid = Read(store, 5);
          if (String.IsNullOrEmpty(aumid) && onlyPid == 0) return true;
          StringBuilder title = new StringBuilder(512);
          GetWindowText(hwnd, title, title.Capacity);
          StringBuilder cls = new StringBuilder(256);
          GetClassName(hwnd, cls, cls.Capacity);
          WindowInfo info = new WindowInfo();
          info.pid = (int)pid;
          info.title = title.ToString();
          info.windowClass = cls.ToString();
          info.aumid = aumid;
          info.relaunchCommand = Read(store, 2);
          info.relaunchIcon = Read(store, 3);
          info.relaunchName = Read(store, 4);
          found.Add(info);
        } finally {
          Marshal.ReleaseComObject(store);
        }
        return true;
      }, IntPtr.Zero);
      return found.ToArray();
    }

    static void Check(int hr, string what) {
      if (hr != 0) throw new InvalidOperationException(what + " failed: 0x" + hr.ToString("X8"));
    }

    public static LinkInfo ReadLink(string path) {
      object link = new ShellLink();
      try {
        Check(((IPersistFile)link).Load(path, 0), "reading the shortcut");
        IShellLinkW shell = (IShellLinkW)link;
        LinkInfo info = new LinkInfo();
        info.path = path;
        info.aumid = Read((IPropertyStore)link, 5);
        StringBuilder text = new StringBuilder(1024);
        if (shell.GetPath(text, text.Capacity, IntPtr.Zero, 0) == 0) info.target = text.ToString();
        text = new StringBuilder(2048);
        if (shell.GetArguments(text, text.Capacity) == 0) info.arguments = text.ToString();
        text = new StringBuilder(1024);
        if (shell.GetDescription(text, text.Capacity) == 0) info.description = text.ToString();
        text = new StringBuilder(1024);
        int index;
        if (shell.GetIconLocation(text, text.Capacity, out index) == 0) info.iconLocation = text.ToString() + "," + index;
        return info;
      } finally {
        Marshal.ReleaseComObject(link);
      }
    }

    // One property on one shortcut. The file is opened read-write, the id is
    // set, and it is saved back to the path it came from.
    public static void Stamp(string path, string aumid, string tag) {
      object link = new ShellLink();
      try {
        Check(((IPersistFile)link).Load(path, 2), "opening the shortcut");
        StringBuilder text = new StringBuilder(1024);
        ((IShellLinkW)link).GetDescription(text, text.Capacity);
        if (String.IsNullOrEmpty(tag) || text.ToString().IndexOf(tag, StringComparison.Ordinal) < 0) {
          throw new InvalidOperationException("not a shortcut DeckHQ wrote, so it was left alone: " + path);
        }
        IPropertyStore store = (IPropertyStore)link;
        PropertyKey key = new PropertyKey(AppUserModel, 5);
        PropVariant value = new PropVariant();
        value.vt = VT_LPWSTR;
        value.pointer = Marshal.StringToCoTaskMemUni(aumid);
        try {
          Check(store.SetValue(ref key, ref value), "setting the id");
          Check(store.Commit(), "committing the id");
        } finally {
          PropVariantClear(ref value);
        }
        Check(((IPersistFile)link).Save(path, true), "saving the shortcut");
      } finally {
        Marshal.ReleaseComObject(link);
      }
    }
  }
}
'@

function Read-Spec {
  if (-not $SpecFile) { throw '-SpecFile is required' }
  if (-not (Test-Path -LiteralPath $SpecFile)) { throw "no such file: $SpecFile" }
  Get-Content -LiteralPath $SpecFile -Raw -Encoding UTF8 | ConvertFrom-Json
}

# `ConvertTo-Json` unwraps a one-element array and prints nothing for an empty
# one in Windows PowerShell 5.1, so the array brackets are written here.
function Format-JsonArray($items) {
  $parts = @($items | Where-Object { $null -ne $_ } | ForEach-Object { $_ | ConvertTo-Json -Compress })
  '[' + ($parts -join ',') + ']'
}

# Does this command line name this profile directory as its --user-data-dir?
# The character after it must end the value, so `app-profile` never answers
# for `app-profile-2`.
function Test-NamesProfile([string]$commandLine, [string]$profileDir) {
  if (-not $commandLine) { return $false }
  $needle = '--user-data-dir=' + $profileDir
  $at = $commandLine.IndexOf($needle, [StringComparison]::OrdinalIgnoreCase)
  while ($at -ge 0) {
    $end = $at + $needle.Length
    if ($end -ge $commandLine.Length) { return $true }
    $next = $commandLine[$end]
    if ($next -eq '"' -or [char]::IsWhiteSpace($next)) { return $true }
    $at = $commandLine.IndexOf($needle, $end, [StringComparison]::OrdinalIgnoreCase)
  }
  return $false
}

# The windows whose process was started with this profile directory. A window
# is identified by what its own process was told, not by what its id looks like.
# One unfiltered query, and the comparison done here: the directory is never
# written into a query string.
function Get-ProfileWindows([string]$profileDir) {
  $owners = @{}
  foreach ($process in Get-CimInstance -ClassName Win32_Process -Property ProcessId, CommandLine -ErrorAction SilentlyContinue) {
    if (Test-NamesProfile ([string]$process.CommandLine) $profileDir) { $owners[[int]$process.ProcessId] = $true }
  }
  $mine = @()
  if ($owners.Count -eq 0) { return $mine }
  foreach ($w in [DeckHQ.Taskbar]::Windows(0)) {
    if ($owners.ContainsKey([int]$w.pid)) { $mine += $w }
  }
  return $mine
}

try {
  # The id and the paths are text Node compares byte for byte.
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  Add-Type -TypeDefinition $source -Language CSharp

  if ($Action -eq 'windows') {
    if ($ProcessId -le 0) { throw '-ProcessId is required' }
    Write-Output (Format-JsonArray ([DeckHQ.Taskbar]::Windows($ProcessId)))
    exit 0
  }

  $spec = Read-Spec

  if ($Action -eq 'look') {
    $windows = @()
    if ($spec.profileDir) {
      $deadline = [DateTime]::UtcNow.AddMilliseconds([int]$spec.waitMs)
      while ($true) {
        $windows = @(Get-ProfileWindows ([string]$spec.profileDir))
        if ($windows.Count -gt 0 -or [DateTime]::UtcNow -ge $deadline) { break }
        Start-Sleep -Milliseconds 250
      }
    }
    $links = @()
    foreach ($p in @($spec.paths)) {
      if ($p -and (Test-Path -LiteralPath $p)) { $links += [DeckHQ.Taskbar]::ReadLink([string]$p) }
    }
    Write-Output ('{"windows":' + (Format-JsonArray $windows) + ',"links":' + (Format-JsonArray $links) + '}')
    exit 0
  }

  if (-not $spec.tag) { throw 'the spec has no "tag"' }
  if (-not $spec.aumid) { throw 'the spec has no "aumid"' }
  $links = @()
  foreach ($p in @($spec.paths)) {
    if (-not $p) { continue }
    if (-not (Test-Path -LiteralPath $p)) { throw "no such file: $p" }
    [DeckHQ.Taskbar]::Stamp([string]$p, [string]$spec.aumid, [string]$spec.tag)
    $links += [DeckHQ.Taskbar]::ReadLink([string]$p)
  }
  Write-Output (Format-JsonArray $links)
  exit 0
}
catch {
  $reason = $_.Exception
  while ($reason.InnerException) { $reason = $reason.InnerException }
  [Console]::Error.WriteLine($reason.Message)
  exit 1
}
