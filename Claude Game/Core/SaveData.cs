using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Platformer.Core;

public sealed class LevelRecord
{
    public int Score { get; set; }
    public int Coins { get; set; }
    public int TotalCoins { get; set; }
    public float Time { get; set; }
}

/// <summary>
/// Progress and settings, stored as JSON in the user's app-data folder.
/// The file carries an HMAC-SHA256 checksum: if someone edits it (e.g. to unlock all levels or
/// fake records), progress is reset while settings are kept. The key of official builds is
/// injected by the build (GitHub secret), so it is not in the public source code. This is a
/// hurdle, not a guarantee - which is why online highscores are verified on the server instead.
/// </summary>
public sealed class SaveData
{
    public string? Language { get; set; }
    public int Unlocked { get; set; } = 1;
    public Dictionary<string, LevelRecord> Records { get; set; } = new();
    public float SfxVolume { get; set; } = 0.8f;
    public float MusicVolume { get; set; } = 0.5f;
    public bool Fullscreen { get; set; }
    public string? SkippedVersion { get; set; }
    public string? Nickname { get; set; }
    public string? OnlineUser { get; set; }
    public string? OnlineToken { get; set; }

    public static SaveData Current { get; private set; } = new();

    /// <summary>True once after loading a manipulated file (the title screen shows a note).</summary>
    public static bool WasTampered { get; set; }

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    private static byte[] Key => SHA256.HashData(Encoding.UTF8.GetBytes(
        (typeof(SaveData).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(a => a.Key == "SaveKey")?.Value is { Length: > 0 } k ? k : "dev-build-save-key")
        + "|" + GameConfig.Slug));

    private static string FilePath
    {
        get
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), GameConfig.Slug);
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "save.json");
        }
    }

    private static string Sign(string data) => Convert.ToHexString(HMACSHA256.HashData(Key, Encoding.UTF8.GetBytes(data)));

    public static void Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return;
            var root = JsonNode.Parse(File.ReadAllText(FilePath))!.AsObject();
            string data = root["data"]?.GetValue<string>() ?? "";
            string sig = root["sig"]?.GetValue<string>() ?? "";
            var loaded = JsonSerializer.Deserialize<SaveData>(data) ?? new SaveData();
            if (!CryptographicOperations.FixedTimeEquals(Convert.FromHexString(sig.Length == 64 ? sig : new string('0', 64)), Convert.FromHexString(Sign(data))))
            {
                // manipulated: keep harmless settings, drop progress and records
                loaded = new SaveData
                {
                    Language = loaded.Language, SfxVolume = Math.Clamp(loaded.SfxVolume, 0, 1), MusicVolume = Math.Clamp(loaded.MusicVolume, 0, 1),
                    Fullscreen = loaded.Fullscreen, Nickname = loaded.Nickname
                };
                WasTampered = true;
            }
            Current = loaded;
        }
        catch
        {
            Current = new SaveData();
            WasTampered = File.Exists(FilePath);
        }
        if (WasTampered) Save();
    }

    public static void Save()
    {
        try
        {
            string data = JsonSerializer.Serialize(Current, Json);
            var tmp = FilePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(new { data, sig = Sign(data) }, Json));
            File.Move(tmp, FilePath, overwrite: true); // atomic: no half-written save on crash
        }
        catch
        {
            // saving is best effort
        }
    }
}
