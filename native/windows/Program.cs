using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace GogLogin;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            if (args.SequenceEqual(["--self-test"]))
            {
                var selfTest = LoginProtocol.SelfTest();
                return Emit(selfTest, (bool)selfTest["self_test_passed"]! ? 0 : 1);
            }
            if (args.SequenceEqual(["--clipboard"])) { Console.Write(Clipboard.GetText(TextDataFormat.UnicodeText)); return 0; }
            if (args.SequenceEqual(["--vault-self-test"])) return Emit(Vault.SelfTest());
            var vault = args.SequenceEqual(["--vault"]);
            if (args.Length > 0 && !vault) return Emit(Error("INVALID_LOGIN_CONFIG"), 7);
            using var stream = Console.OpenStandardInput();
            using var input = new MemoryStream();
            var buffer = new byte[4096];
            int size;
            while ((size = stream.Read(buffer, 0, buffer.Length)) > 0)
            {
                input.Write(buffer, 0, size);
                if (input.Length > (vault ? 120000 : 16000)) return Emit(Error("INVALID_LOGIN_CONFIG"), 7);
            }
            using var data = JsonDocument.Parse(input.ToArray());
            if (vault)
            {
                try { return Emit(Vault.Run(data.RootElement)); }
                catch { return Emit(Error("VAULT_UNAVAILABLE"), 7); }
            }
            LoginConfig config;
            try { config = LoginProtocol.ParseConfig(data.RootElement); }
            catch { return Emit(Error("INVALID_LOGIN_CONFIG"), 7); }
            try { _ = CoreWebView2Environment.GetAvailableBrowserVersionString(); }
            catch { return Emit(Error("WEBVIEW2_MISSING"), 7); }
            ApplicationConfiguration.Initialize();
            var folder = Path.Combine(Path.GetTempPath(), $"gog-signin-{Guid.NewGuid():N}");
            object result;
            using (var form = new LoginWindow(config, folder))
            {
                Application.Run(form);
                result = form.Result ?? Error("AUTH_CANCELLED");
            }
            for (var attempt = 0; attempt < 10 && Directory.Exists(folder); attempt++)
            {
                try { Directory.Delete(folder, true); }
                catch { Thread.Sleep(100); }
            }
            return Emit(result);
        }
        catch { return Emit(Error("NATIVE_HELPER_FAILED"), 7); }
    }

    internal static object Error(string code) => new { type = "error", code };
    private static int Emit(object value, int status = 0) { Console.Write(JsonSerializer.Serialize(value)); return status; }
}

internal sealed class LoginWindow : Form
{
    private readonly WebView2 view = new() { Dock = DockStyle.Fill };
    private readonly LoginConfig config;
    private readonly string folder;
    private readonly System.Windows.Forms.Timer timeout;
    internal object? Result { get; private set; }

    internal LoginWindow(LoginConfig config, string folder)
    {
        this.config = config;
        this.folder = folder;
        Text = "Sign in to GOG";
        ClientSize = new System.Drawing.Size(560, 720);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(view);
        timeout = new() { Interval = config.TimeoutMs };
        timeout.Tick += (_, _) => Finish(Program.Error("AUTH_TIMEOUT"));
        Shown += async (_, _) => await Start();
        FormClosing += (_, _) => { timeout.Stop(); Result ??= Program.Error("AUTH_CANCELLED"); };
        FormClosed += (_, _) => { view.Dispose(); timeout.Dispose(); };
    }

    private void Finish(object result)
    {
        if (Result is not null || IsDisposed) return;
        Result = result;
        Close();
    }

    private async Task Start()
    {
        timeout.Start();
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: folder);
            if (IsDisposed) return;
            var options = environment.CreateCoreWebView2ControllerOptions();
            options.IsInPrivateModeEnabled = true;
            await view.EnsureCoreWebView2Async(environment, options);
            if (IsDisposed) return;
            view.CoreWebView2.Settings.AreDevToolsEnabled = false;
            view.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            view.CoreWebView2.Settings.IsStatusBarEnabled = false;
            view.CoreWebView2.Settings.IsWebMessageEnabled = false;
            view.CoreWebView2.NavigationStarting += (_, eventArgs) =>
            {
                var callback = LoginProtocol.ReadCallback(eventArgs.Uri, config.State);
                if (callback is not null)
                {
                    eventArgs.Cancel = true;
                    Finish(callback.Error is not null ? Program.Error(callback.Error) : new { type = "code", code = callback.Code, state = callback.State });
                }
                else if (!LoginProtocol.Allowed(eventArgs.Uri)) eventArgs.Cancel = true;
            };
            view.CoreWebView2.FrameNavigationStarting += (_, eventArgs) =>
            {
                if (eventArgs.Uri != "about:blank" && (!Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out var uri) || uri.Scheme != "https"))
                    eventArgs.Cancel = true;
            };
            view.CoreWebView2.NewWindowRequested += (_, eventArgs) =>
            {
                eventArgs.Handled = true;
                if (LoginProtocol.Allowed(eventArgs.Uri)) view.CoreWebView2.Navigate(eventArgs.Uri);
            };
            view.CoreWebView2.NavigationCompleted += (_, eventArgs) =>
            {
                if (!eventArgs.IsSuccess && eventArgs.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
                    Finish(Program.Error("LOGIN_PAGE_FAILED"));
            };
            view.CoreWebView2.ProcessFailed += (_, _) => Finish(Program.Error("LOGIN_PAGE_FAILED"));
            view.CoreWebView2.Navigate(config.LoginUrl);
        }
        catch { Finish(Program.Error("LOGIN_PAGE_FAILED")); }
    }
}
