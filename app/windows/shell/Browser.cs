// WebView2: where its loader is, whether the runtime is on this PC, and every
// switch the shell sets to keep it quiet. app/windows/README.md lists what
// each one does and, more to the point, what none of them can do.
using System;
using System.IO;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace DeckHQ.Shell
{
    internal static class Browser
    {
        // Chromium switches, passed to the WebView2 browser process. They are
        // not a supported WebView2 surface and a runtime update may drop one;
        // the settings in Quiet() below are the supported half.
        public const string Arguments =
            "--disable-features=msSmartScreenProtection"
            + " --disable-background-networking"
            + " --disable-component-update"
            + " --disable-domain-reliability"
            + " --disable-client-side-phishing-detection"
            + " --disable-sync"
            + " --disable-breakpad"
            + " --no-pings"
            + " --no-first-run"
            // No host name resolves inside the browser's network stack; the
            // only address the page is ever given is 127.0.0.1 itself.
            + " --host-resolver-rules=\"MAP * ~NOTFOUND , EXCLUDE 127.0.0.1\"";

        // WebView2Loader.dll is native, so there is one per architecture, kept
        // where the SDK itself keeps them: runtimes\win-<arch>\native.
        public static void PointAtLoader()
        {
            string arch = Environment.GetEnvironmentVariable("PROCESSOR_ARCHITECTURE") ?? "";
            string folder = arch.Equals("ARM64", StringComparison.OrdinalIgnoreCase) ? "win-arm64" : "win-x64";
            string native = Path.Combine(Path.Combine(Paths.AppDir, "runtimes"), Path.Combine(folder, "native"));
            if (Directory.Exists(native)) CoreWebView2Environment.SetLoaderDllFolderPath(native);
        }

        // True when the WebView2 Runtime is installed. It is part of Windows 11
        // and arrives with Edge on Windows 10, but it can be absent.
        public static bool Available()
        {
            if (Environment.GetEnvironmentVariable("DECKHQ_SHELL_NO_WEBVIEW2") == "1") return false;
            try
            {
                string version = CoreWebView2Environment.GetAvailableBrowserVersionString();
                Log.Write("WebView2 Runtime " + version);
                return !string.IsNullOrEmpty(version);
            }
            catch (Exception err)
            {
                Log.Write("no WebView2 Runtime: " + err.Message);
                return false;
            }
        }

        // The profile lives under %LOCALAPPDATA%\DeckHQ\WebView2, never beside
        // the exe: an installed app's own folder is not a place to write.
        public static Task<CoreWebView2Environment> CreateEnvironmentAsync()
        {
            CoreWebView2EnvironmentOptions environment = new CoreWebView2EnvironmentOptions();
            environment.AdditionalBrowserArguments = Arguments;
            // Crash dumps stay on this PC instead of going to Microsoft.
            environment.IsCustomCrashReportingEnabled = true;
            return CoreWebView2Environment.CreateAsync(null, Paths.WebViewData, environment);
        }

        public static void Quiet(CoreWebView2Settings settings)
        {
            // SmartScreen sends the addresses a page visits to Microsoft. The
            // only address this window visits is this PC's own loopback.
            settings.IsReputationCheckingRequired = false;
            settings.IsPasswordAutosaveEnabled = false;
            settings.IsGeneralAutofillEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.IsSwipeNavigationEnabled = false;
            // Reload, zoom and find stay, as they are in `deckhq app`'s window.
            settings.AreBrowserAcceleratorKeysEnabled = true;
        }
    }
}
