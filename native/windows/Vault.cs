using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace GogLogin;

internal static class Vault
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("gog-achievements-cli:session:v1");
    private const int MaxBytes = 96000;

    internal static object Run(JsonElement input)
    {
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GogAchievementsCli");
        return Operate(folder, input);
    }

    private static object Operate(string folder, JsonElement input)
    {
        var file = Path.Combine(folder, "session.dpapi");
        var action = input.GetProperty("action").GetString();
        if (Directory.Exists(folder) && (File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0) throw new IOException();
        if (File.Exists(file) && (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0) throw new IOException();
        if (action == "get") return new { type = "vault", secret = Read(file) };
        if (action == "remove") { File.Delete(file); return new { type = "vault" }; }
        if (action != "set") throw new ArgumentException();
        var secret = input.GetProperty("secret").GetString() ?? throw new ArgumentException();
        var bytes = Encoding.UTF8.GetBytes(secret);
        if (bytes.Length == 0 || bytes.Length > MaxBytes) throw new ArgumentException();
        // DPAPI binds encryption to this Windows user. Disk holds only ciphertext.
        byte[] encrypted;
        try { encrypted = ProtectedData.Protect(bytes, Entropy, DataProtectionScope.CurrentUser); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
        Directory.CreateDirectory(folder);
        if ((File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0) throw new IOException();
        var user = WindowsIdentity.GetCurrent().User ?? throw new IOException();
        var permissions = new DirectorySecurity();
        permissions.SetOwner(user);
        permissions.SetAccessRuleProtection(true, false);
        permissions.AddAccessRule(new FileSystemAccessRule(user, FileSystemRights.FullControl,
            InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        new DirectoryInfo(folder).SetAccessControl(permissions);
        var temporary = Path.Combine(folder, $"{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
                stream.Write(encrypted);
            File.Move(temporary, file, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        return new { type = "vault" };
    }

    internal static object SelfTest()
    {
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), $"GogAchievementsCliTest-{Guid.NewGuid():N}");
        try
        {
            var secret = string.Concat(Enumerable.Repeat("temporary-test", 1000));
            using var set = JsonDocument.Parse(JsonSerializer.Serialize(new { action = "set", secret }));
            Operate(folder, set.RootElement);
            var matched = Read(Path.Combine(folder, "session.dpapi")) == secret;
            var encrypted = !Encoding.UTF8.GetString(File.ReadAllBytes(Path.Combine(folder, "session.dpapi"))).Contains("temporary-test");
            using var remove = JsonDocument.Parse("{\"action\":\"remove\"}");
            Operate(folder, remove.RootElement);
            var deleted = !File.Exists(Path.Combine(folder, "session.dpapi"));
            var owner = new DirectoryInfo(folder).GetAccessControl().GetOwner(typeof(SecurityIdentifier));
            var privateFolder = owner.Equals(WindowsIdentity.GetCurrent().User);
            return new { self_test_passed = matched && encrypted && deleted && privateFolder, checks = 4 };
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }

    private static string? Read(string file)
    {
        if (!File.Exists(file)) return null;
        if (new FileInfo(file).Length > MaxBytes + 4096) throw new IOException();
        var bytes = ProtectedData.Unprotect(File.ReadAllBytes(file), Entropy, DataProtectionScope.CurrentUser);
        try { if (bytes.Length == 0 || bytes.Length > MaxBytes) throw new IOException(); return Encoding.UTF8.GetString(bytes); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
}
