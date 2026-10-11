// What the page inside the window may do: stay on the daemon's own address.
// Anything else it is asked to open is handed to the default browser.
using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace DeckHQ.Shell
{
    internal sealed partial class MainForm
    {
        private void Configure(CoreWebView2 core)
        {
            Browser.Quiet(core.Settings);
            core.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e)
            {
                if (IsHome(e.Uri)) return;
                e.Cancel = true;
                OpenOutside(e.Uri);
            };
            core.FrameNavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e)
            {
                if (!IsHome(e.Uri) && !e.Uri.StartsWith("about:", StringComparison.Ordinal)) e.Cancel = true;
            };
            core.NewWindowRequested += delegate(object s, CoreWebView2NewWindowRequestedEventArgs e)
            {
                e.Handled = true;
                OpenOutside(e.Uri);
            };
            core.DocumentTitleChanged += delegate
            {
                // The page counts what needs you in its title: "(3) DeckHQ".
                string title = core.DocumentTitle ?? "";
                Text = title.EndsWith(Title, StringComparison.Ordinal) ? title : Title;
            };
            core.ContainsFullScreenElementChanged += delegate
            {
                if (core.ContainsFullScreenElement != fullScreen) ToggleFullScreen();
            };
            core.NavigationCompleted += async delegate(object s, CoreWebView2NavigationCompletedEventArgs e)
            {
                if (!e.IsSuccess)
                {
                    Fail("The floor at " + home + " did not load (" + e.WebErrorStatus + ").");
                    return;
                }
                status.Visible = false;
                view.Visible = true;
                view.Focus();
                await CaptureIfAskedAsync(core);
            };
            view.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.KeyCode != Keys.F11) return;
                e.Handled = true;
                ToggleFullScreen();
            };
        }

        // The daemon's own origin: http, 127.0.0.1, and the port it bound.
        private bool IsHome(string address)
        {
            Uri uri;
            if (home == null || !Uri.TryCreate(address, UriKind.Absolute, out uri)) return false;
            return uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == home.Port;
        }

        // Only web addresses reach the default browser; any other scheme a
        // page names is dropped rather than handed to the system to interpret.
        private static void OpenOutside(string address)
        {
            Uri uri;
            if (!Uri.TryCreate(address, UriKind.Absolute, out uri)) return;
            if (uri.Scheme != "http" && uri.Scheme != "https") return;
            try
            {
                ProcessStartInfo info = new ProcessStartInfo(uri.AbsoluteUri);
                info.UseShellExecute = true;
                Process.Start(info);
            }
            catch (Exception err)
            {
                Log.Write("could not open " + uri.Host + " in the default browser: " + err.Message);
            }
        }

        private bool captured;

        private async Task CaptureIfAskedAsync(CoreWebView2 core)
        {
            if (options.Capture == null || captured) return;
            captured = true;
            await Task.Delay(options.CaptureDelayMs);
            using (FileStream file = File.Create(options.Capture))
            {
                await core.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, file);
            }
            Log.Write("captured " + options.Capture);
            if (options.ExitAfterCapture) Close();
        }
    }
}
