// The window: a title bar, the product's icon, and the floor inside it.
using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DeckHQ.Shell
{
    internal sealed partial class MainForm : Form
    {
        private const string Title = "DeckHQ";

        private readonly Options options;
        private readonly Daemon daemon = new Daemon();
        private readonly Label status = new Label();
        private readonly uint showMessage;
        private WebView2 view;
        private Uri home;

        private bool fullScreen;
        private FormBorderStyle borderBefore;
        private FormWindowState stateBefore;
        private Rectangle boundsBefore;

        public MainForm(Options options)
        {
            this.options = options;
            Text = Title;
            // The floor's own ground colour (public/index.html, theme-color),
            // so the window does not flash white before the page paints.
            BackColor = Color.FromArgb(0x13, 0x14, 0x19);
            MinimumSize = new Size(480, 360);
            using (Stream icon = Assembly.GetExecutingAssembly().GetManifestResourceStream("DeckHQ.ico"))
            {
                if (icon != null) Icon = new Icon(icon);
            }

            status.Dock = DockStyle.Fill;
            status.TextAlign = ContentAlignment.MiddleCenter;
            status.ForeColor = Color.FromArgb(0xb9, 0xbd, 0xc7);
            status.Font = new Font("Segoe UI", 11f);
            status.Text = "Starting DeckHQ…";
            Controls.Add(status);

            Placement.Restore(this);
            showMessage = Native.RegisterWindowMessage(Paths.InstanceName);
            Shown += async delegate { await StartAsync(); };
            FormClosing += delegate
            {
                if (fullScreen) ToggleFullScreen();
                Placement.Save(this);
            };
            FormClosed += delegate { daemon.Stop(); };
        }

        // The daemon and the browser start side by side; the page is asked for
        // only when both are there.
        private async Task StartAsync()
        {
            try
            {
                Task<bool> opening = Task.Run(() => daemon.Open(options.Port));
                CoreWebView2Environment environment = await Browser.CreateEnvironmentAsync();
                view = new WebView2();
                view.Dock = DockStyle.Fill;
                view.DefaultBackgroundColor = BackColor;
                view.Visible = false;
                Controls.Add(view);
                await view.EnsureCoreWebView2Async(environment);
                Configure(view.CoreWebView2);

                if (!await opening)
                {
                    Fail(daemon.Error);
                    return;
                }
                home = new Uri(daemon.Url);
                view.CoreWebView2.Navigate(home.AbsoluteUri);
            }
            catch (Exception err)
            {
                Fail(err.Message);
            }
        }

        private void Fail(string message)
        {
            Log.Write("failed: " + message);
            if (view != null) view.Visible = false;
            status.Visible = true;
            status.Text = "DeckHQ could not start." + Environment.NewLine + Environment.NewLine + message;
        }

        // A second launch broadcasts this window's own message; come forward.
        protected override void WndProc(ref Message m)
        {
            if (showMessage != 0 && m.Msg == (int)showMessage)
            {
                if (Native.IsIconic(Handle)) Native.ShowWindow(Handle, Native.SwRestore);
                Activate();
                Native.SetForegroundWindow(Handle);
                return;
            }
            base.WndProc(ref m);
        }

        private void ToggleFullScreen()
        {
            if (!fullScreen)
            {
                borderBefore = FormBorderStyle;
                stateBefore = WindowState;
                boundsBefore = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                WindowState = FormWindowState.Normal;
                FormBorderStyle = FormBorderStyle.None;
                Bounds = Screen.FromControl(this).Bounds;
            }
            else
            {
                FormBorderStyle = borderBefore;
                Bounds = boundsBefore;
                WindowState = stateBefore;
            }
            fullScreen = !fullScreen;
        }
    }
}
