// The window's size and position, remembered between runs, and the two
// command-line switches the shell reads.
using System;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Windows.Forms;

namespace DeckHQ.Shell
{
    internal static class Placement
    {
        private static string StoreFile { get { return Path.Combine(Paths.DataDir, "window.txt"); } }

        // First run: 1600x1000, the size `deckhq app` opens at, or as much of
        // that as the screen has. Later runs: where it was, if that is still
        // on a screen that exists.
        public static void Restore(Form form)
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            form.Size = new Size(Math.Min(1600, area.Width), Math.Min(1000, area.Height));
            form.StartPosition = FormStartPosition.CenterScreen;
            try
            {
                string[] parts = File.ReadAllText(StoreFile).Trim().Split(',');
                if (parts.Length != 5) return;
                int[] n = new int[5];
                for (int i = 0; i < 5; i++) n[i] = int.Parse(parts[i], CultureInfo.InvariantCulture);
                Rectangle saved = new Rectangle(n[0], n[1], n[2], n[3]);
                if (saved.Width < 320 || saved.Height < 240) return;
                bool visible = false;
                foreach (Screen screen in Screen.AllScreens)
                {
                    Rectangle shared = Rectangle.Intersect(screen.WorkingArea, saved);
                    if (shared.Width >= 120 && shared.Height >= 60) visible = true;
                }
                if (!visible) return;
                form.StartPosition = FormStartPosition.Manual;
                form.Bounds = saved;
                if (n[4] == 1) form.WindowState = FormWindowState.Maximized;
            }
            catch (Exception)
            {
                // No file, or one that does not parse: the first-run size stands.
            }
        }

        public static void Save(Form form)
        {
            try
            {
                Rectangle r = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
                int maximized = form.WindowState == FormWindowState.Maximized ? 1 : 0;
                Directory.CreateDirectory(Paths.DataDir);
                File.WriteAllText(StoreFile, string.Format(
                    CultureInfo.InvariantCulture, "{0},{1},{2},{3},{4}", r.X, r.Y, r.Width, r.Height, maximized));
            }
            catch (Exception)
            {
                // A window that opens at the default size next time is not a failure.
            }
        }
    }

    internal sealed class Options
    {
        public int Port;
        // Test-only: write the WebView's own picture of the page to this PNG
        // once it has loaded, and optionally close afterwards. Not a feature.
        public string Capture;
        public int CaptureDelayMs = 8000;
        public bool ExitAfterCapture;

        public static Options Parse(string[] args)
        {
            Options options = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                string next = i + 1 < args.Length ? args[i + 1] : null;
                int number;
                if (args[i] == "--port" && int.TryParse(next, out number) && number > 0 && number < 65536)
                    options.Port = number;
                else if (args[i] == "--capture" && next != null)
                    options.Capture = next;
                else if (args[i] == "--capture-delay" && int.TryParse(next, out number) && number >= 0)
                    options.CaptureDelayMs = number;
                else if (args[i] == "--exit-after-capture")
                    options.ExitAfterCapture = true;
            }
            return options;
        }
    }
}
