// The daemon: find the one that is running, or start one, and stop only ours.
//
// The shell never asks the network anything. "Is a DeckHQ already running for
// this state folder, and where" is a question the CLI already answers
// (`deckhq app --dry-run`), with the rules written down in src/cli/app.mjs, so
// the shell runs that and reads one line. "Which port did it bind" is answered
// by the daemon itself on its first line of output. test/unit/app-windows-
// shell.test.mjs holds the three patterns below against what the CLI prints.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace DeckHQ.Shell
{
    internal sealed class Daemon
    {
        // What `deckhq app --dry-run --json` answers when a DeckHQ is already there:
        // one line of JSON whose `daemon` object says so. Read with a pattern
        // because this shell is C# 5 with no JSON reader of its own (a quote is
        // written \x22, so the pattern itself holds none); the key order is the
        // CLI's (`running`, then `url`) and a test holds the two together.
        public const string ReusedJsonPattern = @"\x22daemon\x22:\{\x22running\x22:true,\x22url\x22:\x22(http://127\.0\.0\.1:\d+/)\x22";
        // The same answer as a sentence: what a core older than `--json` prints.
        public const string ReusedPattern = @"Daemon:\s+(http://127\.0\.0\.1:\d+/)\s+\(already running";
        public const string ListeningPattern = @"^\s*DeckHQ\s+(http://127\.0\.0\.1:\d+/)\s*$";
        public const string AlreadyPattern = @"DeckHQ is already running at (http://127\.0\.0\.1:\d+/)";

        private const int FindTimeoutMs = 20000;
        private const int StartTimeoutMs = 30000;
        private const int StopGraceMs = 4000;

        private readonly object gate = new object();
        private readonly List<string> lastErrors = new List<string>();
        private readonly ManualResetEvent settled = new ManualResetEvent(false);
        private Process process;
        private IntPtr job = IntPtr.Zero;

        public string Url { get; private set; }
        public bool Started { get; private set; }
        public string Error { get; private set; }

        private static ProcessStartInfo Node(string arguments)
        {
            ProcessStartInfo info = new ProcessStartInfo(Paths.Node, "\"" + Paths.Cli + "\" " + arguments);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            info.WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return info;
        }

        private static string PortArgument(int port)
        {
            return port > 0 ? " --port " + port : "";
        }

        // Blocks; call it off the UI thread. True with Url set, or false with Error.
        public bool Open(int port)
        {
            if (!File.Exists(Paths.Node) || !File.Exists(Paths.Cli))
            {
                Error = "This copy of DeckHQ is incomplete: node\\node.exe or core\\bin\\deckhq.mjs "
                    + "is missing from " + Paths.AppDir + ". Install it again.";
                return false;
            }
            return Find(port) || (Error == null && Start(port));
        }

        private bool Find(int port)
        {
            StringBuilder errors = new StringBuilder();
            using (Process find = new Process())
            {
                find.StartInfo = Node("app --dry-run --json --no-window" + PortArgument(port));
                find.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data != null) lock (errors) errors.AppendLine(e.Data);
                };
                find.Start();
                find.BeginErrorReadLine();
                string output = find.StandardOutput.ReadToEnd();
                if (!find.WaitForExit(FindTimeoutMs))
                {
                    try { find.Kill(); } catch (Exception) { }
                    return false;
                }
                find.WaitForExit();
                if (find.ExitCode != 0)
                {
                    // The CLI refuses a named port that something else holds, and says why.
                    string said;
                    lock (errors) said = errors.ToString().Trim();
                    Error = said.Length > 0 ? said : "DeckHQ could not look for a running daemon.";
                    return false;
                }
                Match reused = Regex.Match(output, ReusedJsonPattern);
                if (!reused.Success) reused = Regex.Match(output, ReusedPattern);
                if (!reused.Success) return false;
                Url = reused.Groups[1].Value;
                Started = false;
                Log.Write("reusing the DeckHQ at " + Url);
                return true;
            }
        }

        // Start `deckhq --no-open` as OUR child, with no console window, and
        // wait for the line on which it names the address it bound. With no
        // port named the daemon chooses for itself: where the installed hooks
        // post, else 4317, walking forward past ports that are taken.
        private bool Start(int port)
        {
            process = new Process();
            process.StartInfo = Node("--no-open" + PortArgument(port));
            process.EnableRaisingEvents = true;
            process.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data == null || Url != null) return;
                Match listening = Regex.Match(e.Data, ListeningPattern);
                Match already = Regex.Match(e.Data, AlreadyPattern);
                if (!listening.Success && !already.Success) return;
                Started = listening.Success;
                Url = (listening.Success ? listening : already).Groups[1].Value;
                settled.Set();
            };
            process.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data == null) return;
                lock (gate)
                {
                    lastErrors.Add(e.Data);
                    if (lastErrors.Count > 12) lastErrors.RemoveAt(0);
                }
            };
            process.Exited += delegate { settled.Set(); };
            // "Ignore Ctrl-C" is a per-process switch that children inherit,
            // and a launcher can leave it on. Stop() below asks the daemon to
            // close with a Ctrl-C, so it must not be born deaf to one.
            Native.SetConsoleCtrlHandler(IntPtr.Zero, false);
            process.Start();
            job = Native.CreateKillOnCloseJob();
            if (job != IntPtr.Zero) Native.AssignProcessToJobObject(job, process.Handle);
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            Log.Write("started the daemon, pid " + process.Id);

            settled.WaitOne(StartTimeoutMs);
            if (Url != null)
            {
                Log.Write((Started ? "daemon listening at " : "a DeckHQ was already at ") + Url);
                return true;
            }
            string said;
            lock (gate) said = string.Join(Environment.NewLine, lastErrors.ToArray());
            Error = "The DeckHQ daemon did not start." + (said.Length > 0 ? Environment.NewLine + said : "");
            Started = true; // it is ours to stop, whatever state it is in
            Stop();
            return false;
        }

        // Stop the daemon this shell started; one it found is left alone.
        // Ctrl-C first, the way a terminal would, so it closes its files and
        // removes its daemon.json; the hard stop is the backstop, not the plan.
        public void Stop()
        {
            if (!Started || process == null) return;
            Started = false;
            try
            {
                if (!process.HasExited)
                {
                    bool asked = false;
                    bool attached = Native.AttachConsole((uint)process.Id);
                    if (attached)
                    {
                        Native.SetConsoleCtrlHandler(IntPtr.Zero, true);
                        bool sent = Native.GenerateConsoleCtrlEvent(Native.CtrlCEvent, 0);
                        asked = sent && process.WaitForExit(StopGraceMs);
                        Native.FreeConsole();
                        Native.SetConsoleCtrlHandler(IntPtr.Zero, false);
                    }
                    if (!asked) Log.Write("Ctrl-C did not close the daemon (console attached: " + attached + ")");
                    if (!asked && !process.HasExited)
                    {
                        process.Kill();
                        process.WaitForExit(2000);
                    }
                    Log.Write(asked ? "the daemon closed when asked" : "the daemon was stopped");
                }
            }
            catch (Exception err)
            {
                Log.Write("stopping the daemon: " + err.Message);
            }
        }
    }
}