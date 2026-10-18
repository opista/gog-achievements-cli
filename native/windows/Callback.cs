using System.Text.Json;
using System.Text.RegularExpressions;

namespace GogLogin;

internal record Callback(string? Code, string? State, string? Error);
internal record LoginConfig(string LoginUrl, string State, int TimeoutMs);

internal static class LoginProtocol
{
    internal const string Redirect = "https://embed.gog.com/on_login_success?origin=client";
    internal static readonly HashSet<string> Hosts = ["auth.gog.com", "login.gog.com", "embed.gog.com", "www.gog.com"];

    internal static Dictionary<string, List<string>> Query(Uri uri)
    {
        var fields = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var part in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = part.Split('=', 2);
            var key = Uri.UnescapeDataString(pair[0]);
            if (!fields.TryGetValue(key, out var values)) fields[key] = values = [];
            values.Add(pair.Length == 2 ? Uri.UnescapeDataString(pair[1]) : "");
        }
        return fields;
    }

    internal static Callback? ReadCallback(string value, string expectedState)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            !Regex.IsMatch(value, @"^https://(?:embed|www)\.gog\.com/", RegexOptions.IgnoreCase) ||
            uri.UserInfo.Length > 0 || (uri.AbsolutePath != "/on_login_success" && uri.AbsolutePath != "/on_login_success/")) return null;
        var fields = Query(uri);
        fields.TryGetValue("state", out var states);
        if (states is not null && (states.Count != 1 || states[0] != expectedState)) return new(null, null, "INVALID_LOGIN_STATE");
        if (fields.ContainsKey("error")) return new(null, null, "AUTH_CANCELLED");
        if (!fields.TryGetValue("code", out var codes) || codes.Count != 1 ||
            !Regex.IsMatch(codes[0], @"\A[A-Za-z0-9._~+=/-]{1,4096}\z")) return new(null, null, "INVALID_LOGIN_CODE");
        return new(codes[0], states?[0], null);
    }

    internal static LoginConfig ParseConfig(JsonElement data)
    {
        var url = data.GetProperty("login_url").GetString() ?? "";
        var state = data.GetProperty("state").GetString() ?? "";
        var timeout = data.GetProperty("timeout_ms").GetInt32();
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "auth.gog.com" ||
            uri.AbsolutePath != "/auth" || !Regex.IsMatch(url, @"^https://auth\.gog\.com/", RegexOptions.IgnoreCase) || uri.UserInfo.Length > 0 || state.Length == 0 || state.Length > 1024 || timeout <= 0 || timeout > 600000)
            throw new ArgumentException();
        var fields = Query(uri);
        if (!fields.TryGetValue("redirect_uri", out var redirects) || redirects.Count != 1 || redirects[0] != Redirect ||
            !fields.TryGetValue("state", out var states) || states.Count != 1 || states[0] != state) throw new ArgumentException();
        return new(url, state, timeout);
    }

    internal static bool Allowed(string url, bool isMainFrame = true)
    {
        if (url == "about:blank") return true;
        // Turnstile uses embedded documents; only GOG may own the main login page.
        if (!isMainFrame && url == "about:srcdoc") return true;
        return Uri.TryCreate(url, UriKind.Absolute, out var uri) && uri.Scheme == "https" &&
            (!isMainFrame || uri.UserInfo.Length == 0 && Hosts.Contains(uri.Host));
    }

}
