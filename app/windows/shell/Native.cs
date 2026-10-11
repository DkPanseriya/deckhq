// The Win32 calls the shell makes, and nothing else.
//
// Three jobs need them: telling the first DeckHQ window to come forward when a
// second one is launched; stopping the daemon the way Ctrl-C would, so it gets
// to close its files; and a job object, so the daemon cannot outlive a shell
// that was killed rather than closed. None of them touches the network.
using System;
using System.Runtime.InteropServices;

namespace DeckHQ.Shell
{
    internal static class Native
    {
        public static readonly IntPtr HwndBroadcast = new IntPtr(0xffff);
        public const int AsfwAny = -1;
        public const int SwRestore = 9;
        public const uint CtrlCEvent = 0;
        public const uint JobKillOnClose = 0x2000;
        public const uint JobSilentBreakawayOk = 0x1000;
        public const int JobExtendedLimitInformation = 9;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern uint RegisterWindowMessage(string name);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);

        [DllImport("user32.dll")]
        public static extern bool AllowSetForegroundWindow(int processId);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hwnd);

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hwnd, int command);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hwnd);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool AttachConsole(uint processId);

        [DllImport("kernel32.dll")]
        public static extern bool FreeConsole();

        [DllImport("kernel32.dll")]
        public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);

        [DllImport("kernel32.dll")]
        public static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroup);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        public static extern IntPtr CreateJobObject(IntPtr attributes, string name);

        [DllImport("kernel32.dll")]
        public static extern bool SetInformationJobObject(
            IntPtr job, int infoClass, ref JobExtendedLimits info, int length);

        [DllImport("kernel32.dll")]
        public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [StructLayout(LayoutKind.Sequential)]
        public struct JobBasicLimits
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct IoCounters
        {
            public ulong ReadOperations;
            public ulong WriteOperations;
            public ulong OtherOperations;
            public ulong ReadTransfers;
            public ulong WriteTransfers;
            public ulong OtherTransfers;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct JobExtendedLimits
        {
            public JobBasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        // A job that takes exactly one process with it when its last handle
        // closes, which Windows does for us if the shell dies without closing.
        // Breakaway is allowed silently: a terminal the daemon opens for the
        // user is the user's, and must not be inside this job.
        public static IntPtr CreateKillOnCloseJob()
        {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return IntPtr.Zero;
            JobExtendedLimits info = new JobExtendedLimits();
            info.Basic.LimitFlags = JobKillOnClose | JobSilentBreakawayOk;
            SetInformationJobObject(
                job, JobExtendedLimitInformation, ref info, Marshal.SizeOf(typeof(JobExtendedLimits)));
            return job;
        }
    }
}
