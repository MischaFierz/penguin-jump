using System.Reflection;
using System.Text.Json;

namespace Platformer.Core;

/// <summary>Reads embedded resources (translations, levels, game.json).</summary>
public static class Assets
{
    private static readonly Assembly Asm = typeof(Assets).Assembly;

    public static string ReadText(string name)
    {
        using var stream = Asm.GetManifestResourceStream(name)
                           ?? throw new FileNotFoundException($"Embedded resource not found: {name}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }

    public static bool Exists(string name) => Asm.GetManifestResourceInfo(name) != null;
}

/// <summary>
/// Central game configuration from game.json at the repository root.
/// Change the name there and every platform (desktop, web, Android, website) picks it up.
/// </summary>
public static class GameConfig
{
    public static string Name { get; private set; } = "Game";
    public static string PackageId { get; private set; } = "";
    public static string BaseUrl { get; private set; } = "";
    public static string Repo { get; private set; } = "";

    /// <summary>Public key (SPKI, base64) that release manifests must be signed with.</summary>
    public static string UpdateKey { get; private set; } = "";

    /// <summary>Version of this build, e.g. "1.0.42". Local builds are "0.0.0".</summary>
    public static string Version { get; private set; } = "0.0.0";

    /// <summary>Local developer builds never auto-update themselves.</summary>
    public static bool IsDevBuild { get; private set; } = true;

    /// <summary>Folder-safe version of the name, used for the save folder.</summary>
    public static string Slug => new string(Name.Where(char.IsLetterOrDigit).ToArray());

    public static void Load()
    {
        using var doc = JsonDocument.Parse(Assets.ReadText("game.json"));
        var root = doc.RootElement;
        Name = root.GetProperty("name").GetString() ?? Name;
        PackageId = root.TryGetProperty("packageId", out var p) ? p.GetString() ?? "" : "";
        BaseUrl = (root.TryGetProperty("baseUrl", out var b) ? b.GetString() ?? "" : "").TrimEnd('/');
        Repo = root.TryGetProperty("repo", out var r) ? r.GetString() ?? "" : "";
        UpdateKey = root.TryGetProperty("updateKey", out var k) ? k.GetString() ?? "" : "";

        var info = typeof(GameConfig).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0-dev";
        IsDevBuild = info.Contains("dev", StringComparison.OrdinalIgnoreCase);
        Version = info.Split('-', '+')[0];
    }
}
