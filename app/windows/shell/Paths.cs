// Where the shell's own files are, and a log small enough to read.
//
// Everything the app ships sits beside DeckHQ.exe; everything the shell writes
// sits under %LOCALAPPDATA%\DeckHQ. Nothing here touches ~\.deckhq: that
// folder is the daemon's, and the user's.
using System;
using System.Globalization;
using System.IO;
using System.Reflection;

namespace DeckHQ.Shell
{
    internal static class Paths
    {
        public static readonly string AppDir =
            Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);

        public static string Node { get { return Path.Combine(AppDir, "node", "node.exe"); } }

        public static string Cli
        {
            get { return Path.Combine(Path.Combine(AppDir, "core"), Path.Combine("bin", "deckhq.mjs")); }
        }

        // %LOCALAPPDATA% is read from the environment first so a test can point
        // the whole shell at a scratch folder, exactly as DECKHQ_STATE_DIR does
        // for the daemon.
        public static string DataDir
        {
            get
            {
                string root = Environment.GetEnvironmentVariable("LOCALAPPDATA");
                if (string.IsNullOrEmpty(root))
                    root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(root, "DeckHQ");
            }
        }

        public static string WebViewData { get { return Path.Combine(DataDir, "WebView2"); } }

        // Two DeckHQs with two state folders are two applications: each gets
        // its own single-instance name. The ordinary one has no suffix, which
        // is the name the installer looks for.
        public static string InstanceName
        {
            get
            {
                string state = Environment.GetEnvironmentVariable("DECKHQ_STATE_DIR");
                if (string.IsNullOrEmpty(state)) return "DeckHQ.Shell";
                uint hash = 2166136261;
                foreach (char c in state.ToLowerInvariant())
                {
                    hash ^= c;
                    hash *= 16777619;
                }
                return "DeckHQ.Shell." + hash.ToString("x8", CultureInfo.InvariantCulture);
            }
        }
    }

    internal static class Log
    {
        private static readonly object Gate = new object();
        private static string file;

        public static void Write(string line)
        {
            try
            {
                lock (Gate)
                {
                    if (file == null)
                    {
                        Directory.CreateDirectory(Paths.DataDir);
                        file = Path.Combine(Paths.DataDir, "shell.log");
                        // One run's worth: the log is for the launch that just
                        // failed, not a history.
                        File.WriteAllText(file, "");
                    }
                    string stamp = DateTime.Now.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture);
                    File.AppendAllText(file, stamp + "  " + line + Environment.NewLine);
                }
            }
            catch (Exception)
            {
                // A log that cannot be written costs the log and nothing else.
            }
        }
    }
}
