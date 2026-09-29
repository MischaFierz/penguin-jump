using System.Text.Json;
using System.Text.Json.Nodes;
using Platformer.Core;

namespace Platformer.Game;

public sealed record MainLevel(string Id, int World, string Title, string Data);

/// <summary>
/// The main levels: built into the game, replaced by the level pack the admins publish on the server
/// (so levels can change without a new game version). The last pack is cached for offline play.
/// </summary>
public static class LevelRepo
{
    public static List<MainLevel> Main { get; private set; } = new();
    public static string Version { get; private set; } = "builtin";
    private static List<MainLevel>? _pending;
    private static string? _pendingVersion;
    private static Task? _refresh;

    private static string CacheFile => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), GameConfig.Slug, "levels.json");

    public static void Init()
    {
        Main = LevelData.Index().Select(f =>
        {
            var text = Assets.ReadText($"levels/{f}");
            var d = LevelData.Parse(text, f);
            return new MainLevel(d.Id, d.World, "", text);
        }).ToList();
        try
        {
            if (!File.Exists(CacheFile)) return;
            var j = JsonNode.Parse(File.ReadAllText(CacheFile))!;
            var levels = Read(j);
            if (levels.Count > 0) { Main = levels; Version = j["version"]!.GetValue<string>(); }
        }
        catch
        {
            // broken cache: built-in levels
        }
    }

    private static List<MainLevel> Read(JsonNode j) =>
        j["levels"]!.AsArray().Select(l => new MainLevel(l!["id"]!.GetValue<string>(), l["world"]!.GetValue<int>(),
            l["title"]?.GetValue<string>() ?? "", l["data"]!.GetValue<string>())).Where(l => l.Data.Contains("---")).ToList();

    /// <summary>Fetches the published pack in the background; call <see cref="Poll"/> each frame to apply it.</summary>
    public static void RefreshAsync()
    {
        if (!Online.Enabled || _refresh is { IsCompleted: false }) return;
        _refresh = Task.Run(async () =>
        {
            var j = await Online.MainLevels(Version);
            if (j == null) return;
            var levels = Read(j);
            if (levels.Count == 0) return;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(CacheFile)!);
                File.WriteAllText(CacheFile, j.ToJsonString());
            }
            catch { /* cache is optional */ }
            _pendingVersion = j["version"]!.GetValue<string>();
            _pending = levels;
        });
    }

    /// <returns>true if a new pack was applied</returns>
    public static bool Poll()
    {
        var p = _pending;
        if (p == null) return false;
        _pending = null;
        Main = p;
        Version = _pendingVersion ?? Version;
        return true;
    }

    public static LevelData Load(int index) => LevelData.Parse(Main[index].Data, Main[index].Id);
    public static int IndexOf(string id) => Main.FindIndex(l => l.Id == id);
    public static int WorldOf(string id) => int.TryParse(id.Split('-')[0], out var w) ? w : 1;
}
