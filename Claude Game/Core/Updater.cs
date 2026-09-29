using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

namespace Platformer.Core;

public enum UpdateState { Idle, Checking, UpToDate, Available, Downloading, Installing, Restarting, Failed }

/// <summary>
/// Checks {baseUrl}/version.json (published by the GitHub Actions workflow), downloads the
/// zip for this platform, swaps the files next to the executable and restarts the game.
/// Security: version.json must carry a valid ECDSA P-256 signature (version.json.sig) made with
/// the release key whose public half is compiled into the game (game.json "updateKey"), and the
/// downloaded zip must match the SHA-256 listed in the signed manifest. A hacked website or a
/// man-in-the-middle can therefore not push a modified game.
/// Running executables cannot be overwritten on Windows, but they can be renamed - so every
/// replaced file is first renamed to *.old and cleaned up on the next start.
/// </summary>
public static class Updater
{
    public static UpdateState State { get; private set; } = UpdateState.Idle;
    public static string? LatestVersion { get; private set; }
    public static float Progress { get; private set; }
    public static bool CanInstall => !GameConfig.IsDevBuild && _download != null;

    private static string? _download;
    private static string? _exeName;
    private static byte[]? _sha256;
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(10) };

    public static string PlatformKey =>
        RuntimeInformation.IsOSPlatform(OSPlatform.Windows) ? "win-x64" :
        RuntimeInformation.IsOSPlatform(OSPlatform.OSX) ? (RuntimeInformation.ProcessArchitecture == Architecture.Arm64 ? "osx-arm64" : "osx-x64") :
        "linux-x64";

    public static void CleanupOldFiles()
    {
        try
        {
            foreach (var f in Directory.GetFiles(AppContext.BaseDirectory, "*.old", SearchOption.AllDirectories))
                try { File.Delete(f); } catch { /* still locked - next time */ }
        }
        catch { /* ignore */ }
    }

    public static void CheckAsync()
    {
        if (State is UpdateState.Checking or UpdateState.Downloading or UpdateState.Installing) return;
        if (string.IsNullOrEmpty(GameConfig.BaseUrl)) { State = UpdateState.Failed; return; }
        State = UpdateState.Checking;
        Task.Run(async () =>
        {
            try
            {
                long t = DateTime.UtcNow.Ticks;
                var json = await Http.GetByteArrayAsync($"{GameConfig.BaseUrl}/version.json?t={t}");
                var sig = (await Http.GetStringAsync($"{GameConfig.BaseUrl}/version.json.sig?t={t}")).Trim();
                if (!VerifySignature(json, sig)) throw new InvalidDataException("bad signature");
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                LatestVersion = root.GetProperty("version").GetString();
                _download = null;
                if (root.TryGetProperty("downloads", out var dl) && dl.TryGetProperty(PlatformKey, out var mine))
                {
                    _download = mine.GetProperty("url").GetString();
                    _exeName = mine.TryGetProperty("exe", out var exe) ? exe.GetString() : null;
                    _sha256 = Convert.FromHexString(mine.GetProperty("sha256").GetString() ?? "");
                    if (_sha256.Length != 32 || _exeName != null && (_exeName.Contains('/') || _exeName.Contains('\\') || _exeName.Contains(".."))) throw new InvalidDataException();
                }

                State = IsNewer(LatestVersion, GameConfig.Version) ? UpdateState.Available : UpdateState.UpToDate;
            }
            catch
            {
                State = UpdateState.Failed;
            }
        });
    }

    /// <summary>ECDSA P-256 / SHA-256 signature (raw r||s, base64) over the exact bytes of version.json.</summary>
    public static bool VerifySignature(byte[] data, string signatureBase64)
    {
        if (string.IsNullOrEmpty(GameConfig.UpdateKey)) return false;
        try
        {
            using var ec = ECDsa.Create();
            ec.ImportSubjectPublicKeyInfo(Convert.FromBase64String(GameConfig.UpdateKey), out _);
            return ec.VerifyData(data, Convert.FromBase64String(signatureBase64), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        }
        catch
        {
            return false;
        }
    }

    public static bool IsNewer(string? remote, string local) =>
        System.Version.TryParse(remote, out var r) && System.Version.TryParse(local, out var l) && r > l;

    public static void InstallAsync()
    {
        if (!CanInstall || State == UpdateState.Downloading) return;
        State = UpdateState.Downloading;
        Progress = 0;
        Task.Run(async () =>
        {
            try
            {
                var url = _download!.StartsWith("https://") ? _download : $"{GameConfig.BaseUrl}/{_download!.TrimStart('/')}";
                var tmp = Path.Combine(Path.GetTempPath(), $"{GameConfig.Slug}-update.zip");
                using (var resp = await Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead))
                {
                    resp.EnsureSuccessStatusCode();
                    long total = resp.Content.Headers.ContentLength ?? -1;
                    await using var src = await resp.Content.ReadAsStreamAsync();
                    await using var dst = File.Create(tmp);
                    var buffer = new byte[81920];
                    long read = 0;
                    int n;
                    while ((n = await src.ReadAsync(buffer)) > 0)
                    {
                        await dst.WriteAsync(buffer.AsMemory(0, n));
                        read += n;
                        if (total > 0) Progress = read / (float)total;
                    }
                }

                // the file must be exactly the one listed in the signed manifest
                await using (var f = File.OpenRead(tmp))
                    if (!CryptographicOperations.FixedTimeEquals(await SHA256.HashDataAsync(f), _sha256))
                        throw new InvalidDataException("checksum mismatch");

                State = UpdateState.Installing;
                var baseDir = AppContext.BaseDirectory;
                using (var zip = ZipFile.OpenRead(tmp))
                {
                    foreach (var entry in zip.Entries)
                    {
                        if (string.IsNullOrEmpty(entry.Name)) continue; // directory
                        var target = Path.GetFullPath(Path.Combine(baseDir, entry.FullName));
                        if (!target.StartsWith(Path.GetFullPath(baseDir), StringComparison.OrdinalIgnoreCase)) continue;
                        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                        if (File.Exists(target)) File.Move(target, target + ".old", overwrite: true);
                        entry.ExtractToFile(target, overwrite: true);
                        if (!OperatingSystem.IsWindows())
                            File.SetUnixFileMode(target, File.GetUnixFileMode(target) | UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute);
                    }
                }

                File.Delete(tmp);
                State = UpdateState.Restarting;
            }
            catch
            {
                try { File.Delete(Path.Combine(Path.GetTempPath(), $"{GameConfig.Slug}-update.zip")); } catch { /* ignore */ }
                State = UpdateState.Failed;
            }
        });
    }

    /// <summary>Starts the freshly installed executable. The caller then closes the game.</summary>
    public static void Restart()
    {
        var exe = !string.IsNullOrEmpty(_exeName) ? Path.Combine(AppContext.BaseDirectory, _exeName) : Environment.ProcessPath;
        if (exe == null || !File.Exists(exe)) exe = Environment.ProcessPath;
        if (exe != null) Process.Start(new ProcessStartInfo(exe) { UseShellExecute = false, WorkingDirectory = AppContext.BaseDirectory });
    }
}
