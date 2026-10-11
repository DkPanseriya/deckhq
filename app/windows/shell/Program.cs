// DeckHQ.exe — the floor in a window of its own, with nothing to install.
//
// A small Windows Forms program for the .NET Framework that ships with
// Windows. It starts the Node daemon bundled beside it, with no console
// window, and shows the floor that daemon serves in WebView2. It is C# 5 on
// purpose: the compiler that is already on every Windows machine builds it,
// so the build needs no SDK.
//
// The shell itself never touches the network. Finding a daemon, choosing a
// port and waiting for it are the CLI's job (Daemon.cs); the only thing that
// loads an address is WebView2, and the only address is 127.0.0.1.
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace DeckHQ.Shell
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Options options = Options.Parse(args);

            bool first;
            using (Mutex only = new Mutex(true, Paths.InstanceName, out first))
            {
                if (!first)
                {
                    // Already open: hand it the foreground and leave.
                    Native.AllowSetForegroundWindow(Native.AsfwAny);
                    uint show = Native.RegisterWindowMessage(Paths.InstanceName);
                    Native.PostMessage(Native.HwndBroadcast, show, IntPtr.Zero, IntPtr.Zero);
                    return 0;
                }
                Browser.PointAtLoader();
                if (!Browser.Available()) return OpenInBrowserInstead(options);
                Application.Run(new MainForm(options));
                GC.KeepAlive(only);
                return 0;
            }
        }

        // No WebView2 Runtime on this PC. `deckhq app` already knows how to
        // open the floor in a Chrome or Edge app window, or failing that a
        // browser tab, so that is what runs; and the user is told why, once.
        // The daemon it starts is detached and outlives this process, exactly
        // as it does for `deckhq app` from a terminal.
        private static int OpenInBrowserInstead(Options options)
        {
            string told = Path.Combine(Paths.DataDir, "webview2-missing.txt");
            try
            {
                if (!File.Exists(told))
                {
                    MessageBox.Show(
                        "DeckHQ shows its floor in Microsoft Edge WebView2, which was not found on this PC."
                        + Environment.NewLine + Environment.NewLine
                        + "It will open in a browser window instead. Installing the WebView2 Runtime from "
                        + "Microsoft gives DeckHQ a window of its own. This message is shown once.",
                        "DeckHQ", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    Directory.CreateDirectory(Paths.DataDir);
                    File.WriteAllText(told, "Told " + DateTime.Now.ToString("u") + Environment.NewLine);
                }
                string arguments = "\"" + Paths.Cli + "\" app --no-pin"
                    + (options.Port > 0 ? " --port " + options.Port : "");
                ProcessStartInfo info = new ProcessStartInfo(Paths.Node, arguments);
                info.UseShellExecute = false;
                info.CreateNoWindow = true;
                using (Process app = Process.Start(info))
                {
                    app.WaitForExit(60000);
                    return app.HasExited ? app.ExitCode : 0;
                }
            }
            catch (Exception err)
            {
                Log.Write("fallback failed: " + err.Message);
                MessageBox.Show("DeckHQ could not start: " + err.Message, "DeckHQ",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
