using System.Reflection;
using System.Text.Json;

namespace GogLogin;

internal static class LoginProtocolTests
{
    internal static Dictionary<string, object?> Run()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("login-protocol-cases.json")
            ?? throw new InvalidOperationException("Missing login protocol cases.");
        using var data = JsonDocument.Parse(stream);
        var failures = new List<string>();
        var count = 0;
        foreach (var item in data.RootElement.GetProperty("navigation").EnumerateArray())
        {
            count++;
            if (LoginProtocol.Allowed(item.GetProperty("url").GetString()!, item.GetProperty("main_frame").GetBoolean())
                != item.GetProperty("allowed").GetBoolean()) failures.Add("navigation/" + item.GetProperty("name").GetString());
        }
        foreach (var item in data.RootElement.GetProperty("callbacks").EnumerateArray())
        {
            count++;
            var actual = LoginProtocol.ReadCallback(item.GetProperty("url").GetString()!, item.GetProperty("expected_state").GetString()!);
            var expected = item.GetProperty("expected");
            var passed = expected.ValueKind == JsonValueKind.Null ? actual is null : actual is not null &&
                actual.Code == expected.GetProperty("code").GetString() &&
                actual.State == expected.GetProperty("state").GetString() && actual.Error == expected.GetProperty("error").GetString();
            if (!passed) failures.Add("callback/" + item.GetProperty("name").GetString());
        }
        foreach (var item in data.RootElement.GetProperty("configs").EnumerateArray())
        {
            count++;
            var valid = false;
            try { LoginProtocol.ParseConfig(item.GetProperty("input")); valid = true; }
            catch { /* Invalid configurations must be rejected before opening a browser. */ }
            if (valid != item.GetProperty("valid").GetBoolean()) failures.Add("config/" + item.GetProperty("name").GetString());
        }
        return new() { ["self_test_passed"] = count > 0 && failures.Count == 0, ["checks"] = count, ["failed_cases"] = failures };
    }
}
