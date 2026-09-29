using System.Globalization;
using System.Text.Json;
using Raylib_cs;

namespace Platformer.Core;

public sealed class Language
{
    public required string Code { get; init; }
    public required Dictionary<string, string> Strings { get; init; }
    public string Name => Strings.GetValueOrDefault("lang.name", Code);
    public Font Font { get; set; }
    public bool HasCustomFont { get; set; }
}

/// <summary>
/// Loads all translations from shared/lang (embedded) and a matching system font per language,
/// so that e.g. Japanese, Chinese, Korean, Greek and Cyrillic text render correctly.
/// </summary>
public static class Loc
{
    public const int FontBaseSize = 64;

    public static List<Language> All { get; } = new();
    public static Language Current { get; private set; } = null!;
    private static Language _english = null!;

    public static void Init(string? preferredCode)
    {
        var codes = JsonSerializer.Deserialize<string[]>(Assets.ReadText("lang/index.json")) ?? ["en"];
        foreach (var code in codes)
        {
            var dict = JsonSerializer.Deserialize<Dictionary<string, string>>(Assets.ReadText($"lang/{code}.json")) ?? new();
            All.Add(new Language { Code = code, Strings = dict });
        }

        _english = All.First(l => l.Code == "en");
        foreach (var lang in All) FontLoader.Load(lang);

        Current = Find(preferredCode) ?? Find(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName) ?? _english;
    }

    private static Language? Find(string? code) =>
        string.IsNullOrEmpty(code) ? null : All.FirstOrDefault(l => l.Code.Equals(code, StringComparison.OrdinalIgnoreCase));

    public static void Set(Language lang) => Current = lang;

    public static string T(string key) =>
        Current != null && Current.Strings.TryGetValue(key, out var v) ? v :
        _english != null && _english.Strings.TryGetValue(key, out v) ? v : key; // not initialised in headless tools

    public static string F(string key, params object[] args) => string.Format(T(key), args);

    public static void Unload()
    {
        foreach (var lang in All)
            if (lang.HasCustomFont) Raylib.UnloadFont(lang.Font);
    }
}

/// <summary>Finds a system font that contains the glyphs of a language and loads exactly those glyphs.</summary>
public static class FontLoader
{
    private static readonly string[] LatinFonts =
    [
        @"C:\Windows\Fonts\arialbd.ttf", @"C:\Windows\Fonts\segoeuib.ttf", @"C:\Windows\Fonts\arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf", "/usr/share/fonts/noto/NotoSans-Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf"
    ];

    private static readonly Dictionary<string, string[]> CjkFonts = new()
    {
        ["ja"] = [@"C:\Windows\Fonts\YuGothB.ttc", @"C:\Windows\Fonts\meiryob.ttc", @"C:\Windows\Fonts\msgothic.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
            "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"],
        ["zh"] = [@"C:\Windows\Fonts\msyhbd.ttc", @"C:\Windows\Fonts\msyh.ttc", @"C:\Windows\Fonts\simsun.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
            "/System/Library/Fonts/Hiragino Sans GB.ttc", "/System/Library/Fonts/PingFang.ttc"],
        ["ko"] = [@"C:\Windows\Fonts\malgunbd.ttf", @"C:\Windows\Fonts\malgun.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
            "/System/Library/Fonts/AppleSDGothicNeo.ttc"],
    };

    public static void Load(Language lang)
    {
        var chars = new HashSet<int>();
        for (int c = 32; c < 127; c++) chars.Add(c);
        foreach (var c in "×•→←↑↓©…■□äöüÄÖÜéèàç") chars.Add(c);
        foreach (var s in lang.Strings.Values)
        foreach (var rune in s.EnumerateRunes())
            chars.Add(rune.Value);
        foreach (var rune in GameConfig.Name.EnumerateRunes()) chars.Add(rune.Value);
        var codepoints = chars.ToArray();

        var candidates = CjkFonts.TryGetValue(lang.Code, out var cjk) ? cjk.Concat(LatinFonts) : LatinFonts;
        foreach (var path in candidates)
        {
            try
            {
                if (!File.Exists(path)) continue;
                var data = File.ReadAllBytes(path);
                if (path.EndsWith(".ttc", StringComparison.OrdinalIgnoreCase)) data = ExtractFirstFontFromCollection(data);
                var font = Raylib.LoadFontFromMemory(".ttf", data, Loc.FontBaseSize, codepoints, codepoints.Length);
                if (font.GlyphCount <= 0 || font.Texture.Id == 0) continue;
                Raylib.SetTextureFilter(font.Texture, TextureFilter.Bilinear);
                lang.Font = font;
                lang.HasCustomFont = true;
                return;
            }
            catch
            {
                // try the next candidate
            }
        }

        lang.Font = Raylib.GetFontDefault();
    }

    /// <summary>
    /// raylib can only read plain .ttf/.otf files. Font collections (.ttc) are common for CJK fonts,
    /// so we rebuild a standalone font file from the first face of the collection.
    /// </summary>
    private static byte[] ExtractFirstFontFromCollection(byte[] ttc)
    {
        static uint U32(byte[] d, int o) => (uint)(d[o] << 24 | d[o + 1] << 16 | d[o + 2] << 8 | d[o + 3]);
        static ushort U16(byte[] d, int o) => (ushort)(d[o] << 8 | d[o + 1]);
        static void W32(byte[] d, int o, uint v) { d[o] = (byte)(v >> 24); d[o + 1] = (byte)(v >> 16); d[o + 2] = (byte)(v >> 8); d[o + 3] = (byte)v; }

        if (ttc.Length < 16 || ttc[0] != 't' || ttc[1] != 't' || ttc[2] != 'c' || ttc[3] != 'f') return ttc;
        int fontOffset = (int)U32(ttc, 12);
        int numTables = U16(ttc, fontOffset + 4);
        int headerSize = 12 + numTables * 16;

        var tables = new List<(int recordPos, int offset, int length)>();
        int total = headerSize;
        for (int i = 0; i < numTables; i++)
        {
            int rec = fontOffset + 12 + i * 16;
            int off = (int)U32(ttc, rec + 8), len = (int)U32(ttc, rec + 12);
            tables.Add((rec, off, len));
            total += (len + 3) & ~3;
        }

        var result = new byte[total];
        Array.Copy(ttc, fontOffset, result, 0, headerSize);
        int pos = headerSize;
        for (int i = 0; i < tables.Count; i++)
        {
            var (_, off, len) = tables[i];
            Array.Copy(ttc, off, result, pos, len);
            W32(result, 12 + i * 16 + 8, (uint)pos);
            pos += (len + 3) & ~3;
        }

        return result;
    }
}
