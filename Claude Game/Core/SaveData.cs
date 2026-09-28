using System.Text.Json;

namespace Platformer.Core;

public sealed class LevelRecord
{
    public int Score { get; set; }
    public int Coins { get; set; }
    public int TotalCoins { get; set; }
    public float Time { get; set; }
}

/// <summary>Progress and settings, stored as JSON in the user's app-data folder.</summary>
public sealed class SaveData
{
    public string? Language { get; set; }
    public int Unlocked { get; set; } = 1;
    public Dictionary<string, LevelRecord> Records { get; set; } = new();
    public float SfxVolume { get; set; } = 0.8f;
    public float MusicVolume { get; set; } = 0.5f;
    public bool Fullscreen { get; set; }
    public string? SkippedVersion { get; set; }

    public static SaveData Current { get; private set; } = new();

    private static string FilePath
    {
        get
        {
            var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), GameConfig.Slug);
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "save.json");
        }
    }

    public static void Load()
    {
        try
        {
            if (File.Exists(FilePath))
                Current = JsonSerializer.Deserialize<SaveData>(File.ReadAllText(FilePath)) ?? new SaveData();
        }
        catch
        {
            Current = new SaveData();
        }
    }

    public static void Save()
    {
        try
        {
            File.WriteAllText(FilePath, JsonSerializer.Serialize(Current, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // saving is best effort
        }
    }
}
