# DeckHQ — which window a session is in, and bringing that one window forward.
#
# "Go to session" is the user clicking a robot and asking to be taken to the
# terminal, the editor or the desktop app it is already running in. Which
# window that is cannot be read from a transcript: it is a fact about the
# process tree and the windows on the desktop, so this is the third and last
# place in the package that has to ask Windows itself.
#
# THIS SCRIPT IS FIXED TEXT AND NOTHING IS EVER INTERPOLATED INTO IT. Node runs
# it with `-File`, never `-Command`, for the reason `shortcut.ps1` gives. Every
# value it is given is a bare number or one of two fixed words.
#
#   -Action table [-ProcessId N]   Print {"processes":[...], "windows":[...],
#                                  "foreground":H, "console":{...}|null}: every
#                                  process as pid, ppid and image name, and
#                                  every visible, uncloaked, unowned top-level
#                                  window as hwnd, pid, title and class.
#                                  Changes nothing. WHICH window a session is
#                                  in is decided from this by a pure function
#                                  in `session-window.mjs`, not here.
#
#                                  With -ProcessId, `console` is the window of
#                                  the console THAT process is attached to:
#                                  {"hwnd","root","pid","windowClass","title"}.
#                                  For a classic console `root` is the console
#                                  window itself; under a pseudoconsole it is
#                                  the window that hosts it — MEASURED for
#                                  Windows Terminal, which owns the hidden
#                                  stand-in window. This is the one answer the
#                                  process tree cannot give: a tab Windows
#                                  handed to the terminal (the default-terminal
#                                  path) has a shell whose parent is not the
#                                  terminal at all. `title` is the console's
#                                  own title, which is what a tab is named
#                                  unless somebody renamed it.
#
#                                  It attaches THIS process to that console for
#                                  as long as the question takes and detaches.
#                                  It reads; it writes nothing to it.
#
#   -Action focus -Hwnd H -ProcessId P [-ConsolePid C]
#                                  Bring that window to the foreground, and
#                                  restore it first if it is minimised. Refused
#                                  unless the window still belongs to process
#                                  P, so a handle Windows has since given to
#                                  some other window is never the one raised.
#                                  Prints {"ok":true, "foreground":true|false,
#                                  "restored", "flashed", "tab", "tabs",
#                                  "tabTitle"}. `foreground` is read back from
#                                  Windows after the attempt, not assumed:
#                                  Windows may decline to let a background
#                                  process take the foreground, and then the
#                                  window's taskbar button is flashed instead
#                                  and this says so.
#
#                                  With -ConsolePid, and when the window has
#                                  tabs: the tab whose name IS that console's
#                                  title is selected, through UI Automation —
#                                  and only when exactly one tab carries that
#                                  name. `tab` is `selected`, `already`, `only`
#                                  (one tab, nothing to choose), `ambiguous`
#                                  (several tabs share the name), `unmatched`
#                                  (no tab has it: a renamed tab) or `none`.
#
# Nothing here kills, signals or sends input to any process. The only state it
# changes is which window is in front and which of its tabs is showing, and
# only for `focus`.
#
# Exit code is 0 on success and 1 on any failure, with the reason on stderr.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('table', 'focus')]
  [string]$Action,

  [long]$Hwnd = 0,
  [int]$ProcessId = 0,
  [int]$ConsolePid = 0
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace DeckHQ {
  public class ProcInfo {
    public int pid;
    public int ppid;
    public string name;
  }

  public class WinInfo {
    public long hwnd;
    public int pid;
    public string title;
    public string windowClass;
  }

  public class ConsoleInfo {
    public long hwnd;
    public long root;
    public int pid;
    public string windowClass;
    public string title;
  }

  public class FocusResult {
    public bool foreground;
    public bool restored;
    public bool flashed;
    public string via;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ProcessEntry32 {
    public uint dwSize;
    public uint cntUsage;
    public uint th32ProcessID;
    public IntPtr th32DefaultHeapID;
    public uint th32ModuleID;
    public uint cntThreads;
    public uint th32ParentProcessID;
    public int pcPriClassBase;
    public uint dwFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
    public string szExeFile;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct FlashInfo {
    public uint cbSize;
    public IntPtr hwnd;
    public uint dwFlags;
    public uint uCount;
    public uint dwTimeout;
  }

  public static class Focus {
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry32 entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry32 entry);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern uint GetConsoleTitleW(StringBuilder text, uint max);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetStdHandle(int which);
    [DllImport("kernel32.dll")]
    static extern bool WriteFile(IntPtr handle, byte[] bytes, uint count, out uint written, IntPtr overlapped);

    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll")]
    static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")]
    static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")]
    static extern bool ShowWindowAsync(IntPtr hwnd, int command);
    [DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint from, uint to, bool attach);
    [DllImport("user32.dll")]
    static extern bool FlashWindowEx(ref FlashInfo info);
    [DllImport("dwmapi.dll")]
    static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

    const int STD_OUTPUT_HANDLE = -11;
    const int STD_ERROR_HANDLE = -12;
    const uint TH32CS_SNAPPROCESS = 2;
    const uint GW_OWNER = 4;
    const uint GA_ROOTOWNER = 3;
    const int DWMWA_CLOAKED = 14;
    const int SW_RESTORE = 9;
    const uint FLASHW_ALL = 3;
    const uint FLASHW_TIMERNOFG = 12;

    // The two handles this process was STARTED with, taken before any console
    // is let go. Once one is, PowerShell has no console of its own and what it
    // prints afterwards goes nowhere — measured: the first version of this
    // printed nothing and exited 0. So every line this script says is written
    // here, to the pipe Node is reading.
    static IntPtr stdout = IntPtr.Zero;
    static IntPtr stderr = IntPtr.Zero;

    public static void Init() {
      stdout = GetStdHandle(STD_OUTPUT_HANDLE);
      stderr = GetStdHandle(STD_ERROR_HANDLE);
    }

    static void Write(IntPtr handle, string text) {
      byte[] bytes = Encoding.UTF8.GetBytes(text + "\n");
      uint written;
      WriteFile(handle, bytes, (uint)bytes.Length, out written, IntPtr.Zero);
    }

    public static void Say(string text) { Write(stdout, text); }
    public static void Complain(string text) { Write(stderr, text); }

    static string Text(IntPtr hwnd) {
      StringBuilder text = new StringBuilder(512);
      GetWindowTextW(hwnd, text, text.Capacity);
      return text.ToString();
    }

    static string Class(IntPtr hwnd) {
      StringBuilder text = new StringBuilder(256);
      GetClassNameW(hwnd, text, text.Capacity);
      return text.ToString();
    }

    public static List<ProcInfo> Processes() {
      List<ProcInfo> found = new List<ProcInfo>();
      IntPtr snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
      if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1)) return found;
      try {
        ProcessEntry32 entry = new ProcessEntry32();
        entry.dwSize = (uint)Marshal.SizeOf(typeof(ProcessEntry32));
        if (!Process32FirstW(snapshot, ref entry)) return found;
        do {
          ProcInfo info = new ProcInfo();
          info.pid = (int)entry.th32ProcessID;
          info.ppid = (int)entry.th32ParentProcessID;
          info.name = entry.szExeFile;
          found.Add(info);
        } while (Process32NextW(snapshot, ref entry));
      } finally {
        CloseHandle(snapshot);
      }
      return found;
    }

    // Every window a person could be taken to: visible, a top-level window in
    // its own right (not owned by another), and not one of the cloaked ghosts
    // Windows keeps for suspended store apps and other desktops' shells. In the
    // order Windows enumerates them, which is front to back.
    public static List<WinInfo> Windows() {
      List<WinInfo> found = new List<WinInfo>();
      EnumWindows(delegate (IntPtr hwnd, IntPtr lParam) {
        if (!IsWindowVisible(hwnd)) return true;
        if (GetWindow(hwnd, GW_OWNER) != IntPtr.Zero) return true;
        int cloaked = 0;
        DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, 4);
        if (cloaked != 0) return true;
        string title = Text(hwnd);
        string cls = Class(hwnd);
        if (title.Length == 0 && cls != "ConsoleWindowClass") return true;
        uint owner;
        GetWindowThreadProcessId(hwnd, out owner);
        WinInfo info = new WinInfo();
        info.hwnd = hwnd.ToInt64();
        info.pid = (int)owner;
        info.title = title;
        info.windowClass = cls;
        found.Add(info);
        return true;
      }, IntPtr.Zero);
      return found;
    }

    // The console another process is attached to, by joining it for the length
    // of one question. Null when that process has no console, or none this
    // process is allowed to join.
    public static ConsoleInfo ConsoleOf(int pid) {
      FreeConsole();
      if (!AttachConsole((uint)pid)) return null;
      try {
        IntPtr hwnd = GetConsoleWindow();
        if (hwnd == IntPtr.Zero) return null;
        ConsoleInfo info = new ConsoleInfo();
        info.hwnd = hwnd.ToInt64();
        IntPtr root = GetAncestor(hwnd, GA_ROOTOWNER);
        if (root == IntPtr.Zero) root = hwnd;
        info.root = root.ToInt64();
        info.windowClass = Class(root);
        uint owner;
        GetWindowThreadProcessId(root, out owner);
        info.pid = (int)owner;
        StringBuilder title = new StringBuilder(1024);
        GetConsoleTitleW(title, (uint)title.Capacity);
        info.title = title.ToString();
        return info;
      } finally {
        FreeConsole();
      }
    }

    // One JSON string, as text. Written by hand because the alternative —
    // PowerShell 5.1's ConvertTo-Json, once per process — took two seconds on
    // a machine with 560 of them, and this is on the path of a click.
    public static void Quote(StringBuilder json, string value) {
      json.Append('"');
      foreach (char c in value ?? "") {
        if (c == '"' || c == '\\') { json.Append('\\'); json.Append(c); }
        else if (c < ' ' || c > '~') { json.Append("\\u"); json.Append(((int)c).ToString("x4")); }
        else json.Append(c);
      }
      json.Append('"');
    }

    public static string Quoted(string value) {
      StringBuilder json = new StringBuilder();
      Quote(json, value);
      return json.ToString();
    }

    public static string Table(int consolePid) {
      StringBuilder json = new StringBuilder(32768);
      json.Append("{\"processes\":[");
      bool first = true;
      foreach (ProcInfo p in Processes()) {
        if (!first) json.Append(',');
        first = false;
        json.Append("{\"pid\":").Append(p.pid).Append(",\"ppid\":").Append(p.ppid).Append(",\"name\":");
        Quote(json, p.name);
        json.Append('}');
      }
      json.Append("],\"windows\":[");
      first = true;
      foreach (WinInfo w in Windows()) {
        if (!first) json.Append(',');
        first = false;
        json.Append("{\"hwnd\":").Append(w.hwnd).Append(",\"pid\":").Append(w.pid).Append(",\"title\":");
        Quote(json, w.title);
        json.Append(",\"windowClass\":");
        Quote(json, w.windowClass);
        json.Append('}');
      }
      json.Append("],\"foreground\":").Append(GetForegroundWindow().ToInt64());
      json.Append(",\"console\":");
      ConsoleInfo console = consolePid > 0 ? ConsoleOf(consolePid) : null;
      if (console == null) json.Append("null");
      else {
        json.Append("{\"hwnd\":").Append(console.hwnd).Append(",\"root\":").Append(console.root);
        json.Append(",\"pid\":").Append(console.pid).Append(",\"windowClass\":");
        Quote(json, console.windowClass);
        json.Append(",\"title\":");
        Quote(json, console.title);
        json.Append('}');
      }
      json.Append('}');
      return json.ToString();
    }

    public static FocusResult Raise(long handle, int pid) {
      IntPtr hwnd = new IntPtr(handle);
      if (!IsWindow(hwnd)) throw new InvalidOperationException("that window is gone");
      uint owner;
      GetWindowThreadProcessId(hwnd, out owner);
      if (pid <= 0 || (int)owner != pid) {
        throw new InvalidOperationException("that window no longer belongs to the process it was found on");
      }
      FocusResult result = new FocusResult();
      if (IsIconic(hwnd)) {
        ShowWindowAsync(hwnd, SW_RESTORE);
        result.restored = true;
      }
      result.via = "direct";
      SetForegroundWindow(hwnd);
      if (GetForegroundWindow() != hwnd) {
        result.via = "input-queue";
        // Windows gives the foreground only to the process that already has
        // it. Sharing an input queue with the thread that does is the
        // documented way for a helper to be allowed, and it sends no input.
        IntPtr front = GetForegroundWindow();
        uint ignored;
        uint frontThread = front == IntPtr.Zero ? 0 : GetWindowThreadProcessId(front, out ignored);
        uint me = GetCurrentThreadId();
        bool joined = frontThread != 0 && frontThread != me && AttachThreadInput(me, frontThread, true);
        try {
          BringWindowToTop(hwnd);
          SetForegroundWindow(hwnd);
        } finally {
          if (joined) AttachThreadInput(me, frontThread, false);
        }
      }
      // Asked again rather than assumed: the switch is not instantaneous.
      for (int i = 0; i < 10 && GetForegroundWindow() != hwnd; i++) System.Threading.Thread.Sleep(20);
      result.foreground = GetForegroundWindow() == hwnd;
      if (!result.foreground) {
        FlashInfo flash = new FlashInfo();
        flash.cbSize = (uint)Marshal.SizeOf(typeof(FlashInfo));
        flash.hwnd = hwnd;
        flash.dwFlags = FLASHW_ALL | FLASHW_TIMERNOFG;
        flash.uCount = 3;
        flash.dwTimeout = 0;
        FlashWindowEx(ref flash);
        result.flashed = true;
        result.via = "flash";
      }
      return result;
    }
  }
}
'@

# The tab whose name is the session's console title, selected — when there is
# exactly one. Read first, and nothing is selected on a guess: two tabs with the
# same name, or none with it, is reported and left alone.
function Select-SessionTab([long]$window, [string]$title) {
  $state = @{ tab = 'none'; tabs = 0 }
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$window)
  $isTab = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::TabItem)
  $items = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isTab))
  $state.tabs = $items.Count
  if ($items.Count -eq 0) { return $state }
  if ($items.Count -eq 1) { $state.tab = 'only'; return $state }
  $matching = @($items | Where-Object { $title -and $_.Current.Name -ceq $title })
  if ($matching.Count -eq 0) { $state.tab = 'unmatched'; return $state }
  if ($matching.Count -gt 1) { $state.tab = 'ambiguous'; return $state }
  $pattern = $null
  if (-not $matching[0].TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    $state.tab = 'unmatched'
    return $state
  }
  if ($pattern.Current.IsSelected) { $state.tab = 'already'; return $state }
  $pattern.Select()
  $state.tab = 'selected'
  return $state
}

try {
  Add-Type -TypeDefinition $source -Language CSharp
  [DeckHQ.Focus]::Init()

  if ($Action -eq 'table') {
    [DeckHQ.Focus]::Say([DeckHQ.Focus]::Table($ProcessId))
    exit 0
  }

  if ($Hwnd -le 0) { throw '-Hwnd is required' }
  $raised = [DeckHQ.Focus]::Raise($Hwnd, $ProcessId)
  $tab = @{ tab = 'none'; tabs = 0 }
  $title = ''
  if ($ConsolePid -gt 0) {
    $console = [DeckHQ.Focus]::ConsoleOf($ConsolePid)
    if ($null -ne $console) { $title = [string]$console.title }
    # A tab that cannot be read is not a reason to fail a window that was
    # raised: the window is the promise, the tab is the courtesy.
    try { $tab = Select-SessionTab $Hwnd $title } catch { $tab = @{ tab = 'none'; tabs = 0 } }
  }
  [DeckHQ.Focus]::Say(
    '{"ok":true,"foreground":' + $raised.foreground.ToString().ToLowerInvariant() +
    ',"restored":' + $raised.restored.ToString().ToLowerInvariant() +
    ',"flashed":' + $raised.flashed.ToString().ToLowerInvariant() +
    ',"via":"' + $raised.via + '","tab":"' + $tab.tab + '","tabs":' + [int]$tab.tabs +
    ',"tabTitle":' + [DeckHQ.Focus]::Quoted($title) + '}')
  exit 0
}
catch {
  $reason = $_.Exception.Message
  if ($_.Exception.InnerException) { $reason = $_.Exception.InnerException.Message }
  try { [DeckHQ.Focus]::Complain($reason) } catch { [Console]::Error.WriteLine($reason) }
  exit 1
}
