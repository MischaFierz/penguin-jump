using System.Text.Json;
using Platformer.Core;

namespace Platformer.Game;

/// <summary>
/// Level file format (shared/levels/*.txt, identical for desktop + web):
///   header lines key=value, then "---", then the tile map (one char per 48px tile).
/// Legend:
///   #  ground        B  ice brick (breakable with power)   ?  coin block
///   F  fish block    S  snowflake block    W  wing block    H  heart (1-up) block    E  empty block
///   o  coin          -  one-way platform   x  crumbling ice ^  spikes    ~  deadly liquid
///   M  moving platform (horizontal, consecutive M = width)  V  moving platform (vertical)
///   *  spring        C  checkpoint    G  goal igloo    @  player start    !  tutorial sign
///   e  walker        s  spiky walker  b  bird          h  hopper          i  falling icicle
/// </summary>
public sealed class LevelData
{
    public required string Id { get; init; }
    public required int World { get; init; }
    public required string[] Signs { get; init; }
    public required char[,] Tiles { get; init; }
    public int Width => Tiles.GetLength(0);
    public int Height => Tiles.GetLength(1);

    public static List<string> Index() =>
        JsonSerializer.Deserialize<List<string>>(Assets.ReadText("levels/index.json")) ?? new();

    public static LevelData Load(string file)
    {
        var text = Assets.ReadText($"levels/{file}").Replace("\r", "");
        var lines = text.Split('\n');
        string id = file, signs = "";
        int world = 1, i = 0;
        for (; i < lines.Length && lines[i] != "---"; i++)
        {
            var kv = lines[i].Split('=', 2);
            if (kv.Length != 2) continue;
            switch (kv[0].Trim())
            {
                case "id": id = kv[1].Trim(); break;
                case "world": world = int.Parse(kv[1].Trim()); break;
                case "signs": signs = kv[1].Trim(); break;
            }
        }

        var rows = lines.Skip(i + 1).ToList();
        while (rows.Count > 0 && rows[^1].Length == 0 && rows.Count > 15) rows.RemoveAt(rows.Count - 1);
        while (rows.Count < 15) rows.Add("");
        int w = rows.Max(r => r.Length), h = rows.Count;
        var tiles = new char[w, h];
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
            tiles[x, y] = x < rows[y].Length ? rows[y][x] : ' ';

        return new LevelData
        {
            Id = id, World = world, Tiles = tiles,
            Signs = signs.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
        };
    }
}
