using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Platformer.Core;
using Platformer.Game;
using Raylib_cs;

namespace Platformer.Scenes;

/// <summary>A level being edited: 15 rows of tile characters (legend in Game/Level.cs).</summary>
public sealed class EditorDoc
{
    public string Id { get; set; } = "";
    public string? Code { get; set; }            // server id ("c12") once uploaded
    public string Title { get; set; } = "";
    public int World { get; set; } = 1;
    public List<string> Rows { get; set; } = new();

    public static EditorDoc New()
    {
        var rows = Enumerable.Repeat("", 15).ToList();
        rows[11] = "   @" + new string(' ', 34) + "G";
        rows[12] = rows[13] = rows[14] = new string('#', 40);
        return new EditorDoc { Id = "l" + DateTime.UtcNow.Ticks.ToString("x"), Title = Loc.T("editor.untitled"), Rows = rows };
    }

    public string Text(string code) => $"id={code}\nworld={World}\n---\n{string.Join("\n", Rows)}\n";
}

/// <summary>Drafts on this computer (a JSON file next to the save file).</summary>
public static class EditorStore
{
    private static string FilePath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), GameConfig.Slug, "editor-levels.json");

    public static List<EditorDoc> All()
    {
        try { return File.Exists(FilePath) ? JsonSerializer.Deserialize<List<EditorDoc>>(File.ReadAllText(FilePath)) ?? new() : new(); }
        catch { return new(); }
    }

    public static void Put(EditorDoc doc)
    {
        var all = All().Where(d => d.Id != doc.Id).ToList();
        all.Insert(0, doc);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(all.Take(60).ToList()));
        }
        catch { /* best effort */ }
    }
}

/// <summary>Drawing of single tiles (editor, palette, previews).</summary>
public static class EditorArt
{
    private const float T = (float)Phys.Tile;

    public static void Tile(char c, int x, int y, Theme th, float t, Func<int, int, char> at)
    {
        float px = x * T, py = y * T;
        var bc = new Vector2(px + T / 2, py + T);
        switch (c)
        {
            case '#': Art.Ground(x, y, th, y > 0 && at(x, y - 1) != '#', at(x - 1, y) != '#', at(x + 1, y) != '#'); break;
            case 'B': Art.Brick(px, py, th); break;
            case '?': Art.PrizeBlock(px, py, t, false); break;
            case 'F' or 'S' or 'W' or 'H':
                Art.PrizeBlock(px, py, t, false);
                Item(c, px + T - 10, py + 10, t, 0.4f);
                break;
            case 'E': Art.PrizeBlock(px, py, t, true); break;
            case 'x': Art.Crumble(px, py, 0, th); break;
            case '-': Art.OneWay(px, py, th, at(x - 1, y) != '-', at(x + 1, y) != '-'); break;
            case '^': Art.Spikes(px, py, th); break;
            case '~': Art.Liquid(px, py, at(x, y - 1) != '~', th, t); break;
            case 'o': Art.Coin(new Vector2(px + T / 2, py + T / 2), t); break;
            case '*': Art.Spring(px, py, 0); break;
            case 'M' or 'V':
                Art.MovingPlatform(px, py + T - 28, 1, th);
                var w = new Color(255, 255, 255, 210);
                if (c == 'M')
                {
                    Art.Tri(new Vector2(px + 6, py + 10), new Vector2(px + 16, py + 4), new Vector2(px + 16, py + 16), w);
                    Art.Tri(new Vector2(px + T - 6, py + 10), new Vector2(px + T - 16, py + 16), new Vector2(px + T - 16, py + 4), w);
                }
                else
                {
                    Art.Tri(new Vector2(px + T / 2, py + 2), new Vector2(px + T / 2 - 7, py + 11), new Vector2(px + T / 2 + 7, py + 11), w);
                    Art.Tri(new Vector2(px + T / 2, py + 22), new Vector2(px + T / 2 + 7, py + 13), new Vector2(px + T / 2 - 7, py + 13), w);
                }
                break;
            case 'C': Art.Checkpoint(px, py, false, t); break;
            case 'G': Art.Igloo(px, py, t); break;
            case '!': Art.Sign(px, py); break;
            case '@': Art.Penguin(px + T / 2, py + T, 1, t, 0, false, 0, 0, false); break;
            case 'e': Art.Walker(bc, -1, t, false, new Color(170, 120, 230, 255)); break;
            case 's': Art.Spiky(bc, -1, t); break;
            case 'b': Art.Bird(new Vector2(px + T / 2, py + T - 14), -1, t); break;
            case 'h': Art.Hopper(bc, -1, t, false); break;
            case 'i': Art.Icicle(px, py, 0); break;
        }
    }

    public static void Item(char c, float cx, float cy, float t, float scale)
    {
        Rlgl.PushMatrix();
        Rlgl.Translatef(cx, cy, 0);
        Rlgl.Scalef(scale, scale, 1);
        switch (c)
        {
            case 'F': Art.Fish(Vector2.Zero, t); break;
            case 'S': Art.Snowflake(Vector2.Zero, t); break;
            case 'W': Art.WingItem(Vector2.Zero, t); break;
            default: Art.Heart(Vector2.Zero, 1); break;
        }
        Rlgl.PopMatrix();
    }

    /// <summary>Tiny coloured overview of a level text.</summary>
    public static void MiniMap(string data, float x, float y, float maxW)
    {
        var lines = data.Replace("\r", "").Split('\n');
        int start = Array.IndexOf(lines, "---") + 1;
        var rows = lines.Skip(start).Take(15).ToList();
        int w = Math.Max(1, rows.Max(r => r.Length));
        float px = MathF.Min(4, maxW / w);
        for (int ry = 0; ry < rows.Count; ry++)
            for (int rx = 0; rx < rows[ry].Length; rx++)
            {
                char c = rows[ry][rx];
                if (c == ' ') continue;
                Raylib.DrawRectangleRec(new Rectangle(x + rx * px, y + ry * px, px, px), c switch
                {
                    '#' => new Color(107, 143, 199, 255), 'B' => new Color(159, 199, 236, 255), 'o' => new Color(255, 210, 74, 255),
                    '?' or 'F' or 'S' or 'W' or 'H' => new Color(242, 182, 50, 255), '^' => new Color(201, 207, 216, 255), '~' => new Color(255, 106, 58, 255),
                    'G' => Color.White, '@' => new Color(32, 38, 60, 255), 'e' or 's' or 'b' or 'h' => new Color(224, 86, 86, 255),
                    _ => new Color(200, 210, 230, 200)
                });
            }
    }
}

/// <summary>List of the player's levels (this computer + online drafts), "new level".</summary>
public sealed class EditorListScene : IScene
{
    private record Entry(EditorDoc Doc, string Status);

    private float _t;
    private int _sel;
    private List<Entry>? _server;
    private string? _msg;
    private Task<OnlineResult<JsonNode>>? _load;

    public EditorListScene()
    {
        if (Online.LoggedIn) _load = Online.MyLevels(); else _server = new();
    }

    private List<Entry> Entries()
    {
        var local = EditorStore.All();
        var list = local.Select(d => new Entry(d, _server?.FirstOrDefault(s => s.Doc.Code == d.Code && d.Code != null)?.Status ?? (d.Code != null ? "draft" : "local"))).ToList();
        foreach (var s in _server ?? new()) if (!local.Any(d => d.Code == s.Doc.Code)) list.Add(s);
        return list.Take(10).ToList();
    }

    private static Rectangle NewRect => new(Ui.Width / 2f - 220, 120, 440, 60);
    private static Rectangle Rect(int i) => new(140 + i % 2 * 510, 200 + i / 2 * 76, 490, 64);

    public void Update(float dt)
    {
        _t += dt;
        if (_load is { IsCompleted: true })
        {
            var r = _load.Result; _load = null;
            if (!r.Ok) { _msg = Loc.T(Online.ErrorKey(r.Error)); _server = new(); }
            else _server = r.Data!["levels"]!.AsArray().Select(l => new Entry(new EditorDoc
            {
                Id = "l" + l!["id"]!.GetValue<string>(), Code = l["id"]!.GetValue<string>(), Title = l["title"]!.GetValue<string>(), World = l["world"]!.GetValue<int>(),
                Rows = l["rows"]!.AsArray().Select(x => x!.GetValue<string>()).ToList()
            }, l["status"]!.GetValue<string>())).ToList();
        }
        var list = Entries();
        int n = list.Count + 1, prev = _sel;
        if (Input.MenuDown) _sel = Math.Min(n - 1, _sel + (_sel == 0 ? 1 : 2));
        if (Input.MenuUp) _sel = Math.Max(0, _sel - 2);
        if (Input.MenuRight) _sel = Math.Min(n - 1, _sel + 1);
        if (Input.MenuLeft) _sel = Math.Max(0, _sel - 1);
        bool click = false;
        if (Ui.Hover(NewRect)) { if (Input.MouseMoved) _sel = 0; if (Input.Click) { _sel = 0; click = true; } }
        for (int i = 0; i < list.Count; i++) if (Ui.Hover(Rect(i))) { if (Input.MouseMoved) _sel = i + 1; if (Input.Click) { _sel = i + 1; click = true; } }
        if (prev != _sel) Audio.Play(Sfx.MenuMove);
        if (Input.Confirm || click)
        {
            Audio.Play(Sfx.MenuSelect);
            SceneManager.Go(new EditorScene(_sel == 0 ? EditorDoc.New() : JsonSerializer.Deserialize<EditorDoc>(JsonSerializer.Serialize(list[_sel - 1].Doc))!));
        }
        else if (Input.Back) SceneManager.Go(new TitleScene());
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t, false);
        MenuBackdrop.Header(Loc.T("editor.title"), 24);
        Ui.Button(NewRect, "+ " + Loc.T("editor.new"), _sel == 0, 28);
        var list = Entries();
        if (_load != null) Ui.Text("...", Ui.Width / 2f, 220, 26, Color.White, Align.Center);
        for (int i = 0; i < list.Count; i++)
        {
            var r = Rect(i);
            bool sel = _sel == i + 1;
            Raylib.DrawRectangleRounded(r, 0.25f, 8, sel ? Ui.Accent : new Color(30, 48, 90, 240));
            Raylib.DrawRectangleRoundedLinesEx(r, 0.25f, 8, 3, sel ? Color.White : new Color(120, 170, 230, 255));
            Ui.Text(list[i].Doc.Title, r.X + 16, r.Y + 8, 26, sel ? Ui.Ink : Color.White, shadow: !sel);
            Ui.Text(Loc.T("editor.status_" + list[i].Status), r.X + 16, r.Y + 38, 18, sel ? Ui.Ink : new Color(170, 200, 240, 255), shadow: false);
        }
        if (!Online.LoggedIn) Ui.TextBlock(Loc.T("editor.login_needed"), Ui.Width / 2f, 600, 22, 1000, new Color(40, 60, 100, 255));
        if (_msg != null) Ui.TextBlock(_msg, Ui.Width / 2f, 640, 22, 1000, Color.White);
        MenuBackdrop.Hint();
    }
}

/// <summary>The level editor.</summary>
public sealed class EditorScene : IScene
{
    private const int S = 32, Top = 72, RowsN = 15;
    private const int MapH = S * RowsN, BarY = Top + MapH + 4, PalY = BarY + 22;
    private const float T = (float)Phys.Tile;
    private static readonly char[] Tools = ['#', 'B', '?', 'o', '-', 'x', '^', '~', '*', 'M', 'V', 'F', 'S', 'W', 'H', 'C', 'e', 's', 'b', 'h', 'i', '@', 'G', ' '];
    private const char Hand = (char)('H' + 0x1000);
    private static readonly Dictionary<char, string> ToolKeys = new()
    {
        ['#'] = "ground", ['B'] = "brick", ['?'] = "coinblock", ['o'] = "coin", ['-'] = "oneway", ['x'] = "crumble", ['^'] = "spikes", ['~'] = "liquid", ['*'] = "spring",
        ['M'] = "platform", ['V'] = "platformv", ['F'] = "fish", ['S'] = "snowflake", ['W'] = "wings", ['H'] = "heart", ['C'] = "checkpoint", ['e'] = "walker", ['s'] = "spiky",
        ['b'] = "bird", ['h'] = "hopper", ['i'] = "icicle", ['@'] = "start", ['G'] = "goal", [' '] = "eraser", [Hand] = "hand",
    };

    private readonly EditorDoc _doc;
    private float _t, _camX, _msgT;
    private char _tool = '#';
    private int _width;
    private string _msg;
    private bool _painting;
    private float? _dragX, _dragCam;
    private readonly Stack<List<string>> _undo = new();
    private TextField? _rename;
    private Task? _busy;
    private string? _busyResult;

    public EditorScene(EditorDoc doc)
    {
        _doc = doc;
        while (_doc.Rows.Count < RowsN) _doc.Rows.Add("");
        _width = Math.Max(40, _doc.Rows.Max(r => r.Length));
        _msg = Loc.T("editor.hint");
        _msgT = 6;
        Audio.PlayMusic(-1);
    }

    private static char[] Palette => [.. Tools, Hand];
    private int Cols => Ui.Width / S;
    private float MaxCam => Math.Max(0, _width - Cols);
    private void Say(string m, float secs = 5) { _msg = m; _msgT = secs; }

    private static Rectangle PalRect(int i) { float w = Ui.Width / 13f; return new Rectangle(i % 13 * w + 4, PalY + i / 13 * 60, w - 8, 54); }

    private (string id, string label, Rectangle r)[] Buttons() =>
    [
        ("back", "<", new Rectangle(12, 8, 64, 54)), ("title", _doc.Title, new Rectangle(84, 8, 300, 54)),
        ("world", $"{Loc.T("editor.world")} {_doc.World}", new Rectangle(392, 8, 150, 54)), ("narrow", "-", new Rectangle(550, 8, 50, 54)),
        ("wide", "+", new Rectangle(604, 8, 50, 54)), ("undo", "Undo", new Rectangle(662, 8, 56, 54)), ("test", Loc.T("editor.test"), new Rectangle(726, 8, 160, 54)),
        ("save", Loc.T("editor.save"), new Rectangle(894, 8, 170, 54)), ("publish", Loc.T("editor.publish"), new Rectangle(1072, 8, 196, 54)),
    ];

    private char Get(int x, int y) => y < 0 || y >= RowsN ? ' ' : x < 0 || x >= _width ? '#' : x < _doc.Rows[y].Length ? _doc.Rows[y][x] : ' ';

    private void Set(int x, int y, char c)
    {
        if (y < 0 || y >= RowsN || x < 0 || x >= _width) return;
        if (c is '@' or 'G') for (int r = 0; r < RowsN; r++) _doc.Rows[r] = _doc.Rows[r].Replace(c, ' ');
        var row = _doc.Rows[y].PadRight(x + 1).ToCharArray();
        row[x] = c;
        _doc.Rows[y] = new string(row).TrimEnd(' ');
    }

    private string? Check()
    {
        string all = string.Join("\n", _doc.Rows);
        if (all.Count(ch => ch == '@') != 1) return Loc.T("editor.need_start");
        if (all.Count(ch => ch == 'G') != 1) return Loc.T("editor.need_goal");
        if (_doc.Rows.Max(r => r.Length) < 20) return Loc.T("editor.too_small");
        return null;
    }

    public void Update(float dt)
    {
        _t += dt;
        if (_msgT > 0) _msgT -= dt;
        if (_busy != null)
        {
            if (!_busy.IsCompleted) return;
            _busy = null;
            if (_busyResult != null) Say(_busyResult, 8);
            return;
        }
        // start a pending verification run (scene changes happen on the game thread)
        if (_pendingRun != null && _busy == null)
        {
            string run = _pendingRun;
            _pendingRun = null;
            Say(Loc.T("editor.publish_info"), 8);
            Test(run, r =>
            {
                if (!r.Completed || r.RunId == null) { Say(Loc.T("editor.not_finished"), 8); return; }
                _busyResult = null;
                _busy = Task.Run(async () =>
                {
                    var p = await Online.Publish(_doc.Code!, r.RunId, r.Replay, r.TimeTicks, r.Score);
                    _busyResult = p.Ok ? Loc.T("editor.published") : Loc.T(Online.ErrorKey(p.Error));
                });
            });
            return;
        }

        if (_rename != null)
        {
            _rename.Update(true);
            if (Raylib.IsKeyPressed(KeyboardKey.Enter)) { if (_rename.Text.Trim().Length > 0) _doc.Title = _rename.Text.Trim(); _rename = null; }
            else if (Raylib.IsKeyPressed(KeyboardKey.Escape)) _rename = null;
            return;
        }
        var m = Input.Mouse;
        // scrolling
        if (Raylib.IsKeyDown(KeyboardKey.Right) || Raylib.IsKeyDown(KeyboardKey.D)) _camX += dt * 30;
        if (Raylib.IsKeyDown(KeyboardKey.Left) || Raylib.IsKeyDown(KeyboardKey.A)) _camX -= dt * 30;
        var wheel = Raylib.GetMouseWheelMoveV();
        _camX -= (wheel.Y + wheel.X) * 3;
        bool left = Raylib.IsMouseButtonDown(MouseButton.Left), right = Raylib.IsMouseButtonDown(MouseButton.Right);
        if (left && m.Y >= BarY && m.Y < PalY) _camX = m.X / Ui.Width * _width - Cols / 2f;
        if ((Raylib.IsKeyDown(KeyboardKey.LeftControl) || Raylib.IsKeyDown(KeyboardKey.RightControl)) && Raylib.IsKeyPressed(KeyboardKey.Z)) DoUndo();
        if (Raylib.IsKeyPressed(KeyboardKey.H)) _tool = Hand;
        if (Input.Click)
        {
            foreach (var b in Buttons()) if (Ui.Hover(b.r)) { Command(b.id); return; }
            var pal = Palette;
            for (int i = 0; i < pal.Length; i++)
                if (Ui.Hover(PalRect(i))) { _tool = pal[i]; Audio.Play(Sfx.MenuMove); Say(Loc.T("editor.tool." + ToolKeys[pal[i]]), 3); }
        }
        bool inMap = m.Y >= Top && m.Y < Top + MapH;
        if ((left || right) && inMap)
        {
            if (_tool == Hand && left)
            {
                _dragX ??= m.X; _dragCam ??= _camX;
                _camX = _dragCam.Value - (m.X - _dragX.Value) / S;
            }
            else
            {
                if (!_painting) { _undo.Push(_doc.Rows.ToList()); _painting = true; }
                int x = (int)MathF.Floor(m.X / S + _camX), y = (int)MathF.Floor((m.Y - Top) / S);
                char c = right ? ' ' : _tool;
                if (Get(x, y) != c) Set(x, y, c);
            }
        }
        if (!left && !right) { _painting = false; _dragX = _dragCam = null; }
        _camX = Math.Clamp(_camX, 0, MaxCam);
        if (Raylib.IsKeyPressed(KeyboardKey.Escape)) Command("back");
    }

    private void DoUndo()
    {
        if (_undo.Count > 0) { _doc.Rows.Clear(); _doc.Rows.AddRange(_undo.Pop()); }
    }

    private void Command(string id)
    {
        Audio.Play(Sfx.MenuSelect);
        switch (id)
        {
            case "back": EditorStore.Put(_doc); SceneManager.Go(new EditorListScene()); break;
            case "title": _rename = new TextField { Text = _doc.Title, MaxLength = 40, Rect = new Rectangle(Ui.Width / 2f - 300, 330, 600, 60), Label = Loc.T("editor.rename") }; break;
            case "world": _doc.World = _doc.World % 4 + 1; break;
            case "narrow":
                if (_width > 20) { _undo.Push(_doc.Rows.ToList()); _width -= 10; for (int r = 0; r < RowsN; r++) if (_doc.Rows[r].Length > _width) _doc.Rows[r] = _doc.Rows[r][.._width].TrimEnd(' '); }
                break;
            case "wide": if (_width < 300) { _width = Math.Min(300, _width + 10); _camX = MaxCam; } break;
            case "undo": DoUndo(); break;
            case "test": Test(null, null); break;
            case "save": Save(false); break;
            case "publish": Publish(); break;
        }
    }

    private void Test(string? verifyRun, Action<EditorTestResult>? done)
    {
        var err = Check();
        if (err != null) { Say(err); return; }
        EditorStore.Put(_doc);
        string code = verifyRun != null ? _doc.Code! : "test";
        Session.Lives = Session.StartLives;
        SceneManager.Go(new PlayScene(-1, null, new CustomLevel(code, LevelData.Parse(_doc.Text(code), code), "test", _doc.Title, "", () => this,
            done ?? (r => { if (r.Completed) Say(Loc.T("editor.test_ok")); }), verifyRun)));
    }

    /// <summary>Saves on this computer and, when logged in, as a draft online. Returns the server id.</summary>
    private async Task<string?> SaveAsync()
    {
        EditorStore.Put(_doc);
        if (!Online.LoggedIn) return null;
        var r = await Online.SaveLevel(_doc.Code, _doc.Title, _doc.World, _doc.Rows);
        if (!r.Ok) { _busyResult = Loc.T(Online.ErrorKey(r.Error)); return null; }
        _doc.Code = r.Data!["id"]!.GetValue<string>();
        EditorStore.Put(_doc);
        return _doc.Code;
    }

    private void Save(bool quiet)
    {
        if (_doc.Title.Trim().Length < 3) { Say(Loc.T("editor.title_short")); return; }
        _busyResult = null;
        _busy = Task.Run(async () =>
        {
            var code = await SaveAsync();
            if (_busyResult == null && !quiet) _busyResult = Loc.T(code != null ? "editor.saved" : "editor.saved_local");
        });
    }

    private void Publish()
    {
        var err = Check();
        if (err != null) { Say(err); return; }
        if (!Online.LoggedIn) { Say(Loc.T("editor.login_needed"), 8); return; }
        if (_doc.Title.Trim().Length < 3) { Say(Loc.T("editor.title_short")); return; }
        _busyResult = null;
        string? run = null;
        _busy = Task.Run(async () =>
        {
            var code = await SaveAsync();
            if (code == null) return;
            var r = await Online.StartVerifyRun(code);
            if (!r.Ok) { _busyResult = Loc.T(Online.ErrorKey(r.Error)); return; }
            run = r.Data;
        }).ContinueWith(_ =>
        {
            // back on the game loop thread via Update polling: start the test run there
            _pendingRun = run;
        });
    }

    private string? _pendingRun;

    public void Draw()
    {
        var th = Art.ThemeFor(_doc.World);
        Raylib.ClearBackground(new Color(10, 16, 36, 255));
        float k = S / T;
        // background at full width, squeezed into the map area
        Rlgl.PushMatrix();
        Rlgl.Translatef(0, Top, 0);
        Art.Background(th, _camX * S, _t, Ui.Width, MapH);
        Rlgl.PopMatrix();
        // tiles
        Rlgl.PushMatrix();
        Rlgl.Translatef(-_camX * S, Top, 0);
        Rlgl.Scalef(k, k, 1);
        int x0 = Math.Max(0, (int)_camX - 1), x1 = Math.Min(_width, (int)(_camX + Cols) + 2);
        for (int y = 0; y < RowsN; y++)
            for (int x = x0; x < x1; x++)
                EditorArt.Tile(Get(x, y), x, y, th, _t, Get);
        for (int x = x0; x <= x1; x++) Raylib.DrawLineEx(new Vector2(x * T, 0), new Vector2(x * T, RowsN * T), 1.5f, new Color(255, 255, 255, 30));
        for (int y = 0; y <= RowsN; y++) Raylib.DrawLineEx(new Vector2(x0 * T, y * T), new Vector2(x1 * T, y * T), 1.5f, new Color(255, 255, 255, 30));
        Raylib.DrawRectangleRec(new Rectangle(_width * T, 0, 30 * T, RowsN * T), new Color(0, 0, 0, 120));
        var m = Input.Mouse;
        if (m.Y >= Top && m.Y < Top + MapH)
        {
            int cx = (int)MathF.Floor(m.X / S + _camX), cy = (int)MathF.Floor((m.Y - Top) / S);
            Raylib.DrawRectangleLinesEx(new Rectangle(cx * T, cy * T, T, T), 4, Ui.Accent);
        }
        Rlgl.PopMatrix();
        // cover everything outside the map (tiles drawn below the map area)
        Raylib.DrawRectangle(0, Top + MapH, Ui.Width, Ui.Height - Top - MapH, new Color(10, 18, 40, 250));
        Raylib.DrawRectangle(0, 0, Ui.Width, Top, new Color(10, 18, 40, 250));
        // scroll bar
        Raylib.DrawRectangleRounded(new Rectangle(0, BarY, Ui.Width, 16), 1, 8, new Color(255, 255, 255, 30));
        float vw = MathF.Min(1, Cols / (float)_width);
        Raylib.DrawRectangleRounded(new Rectangle(_camX / _width * Ui.Width, BarY, Ui.Width * vw, 16), 1, 8, new Color(255, 196, 64, 200));
        // toolbar
        foreach (var b in Buttons()) Ui.Button(b.r, b.label, false, 24);
        // palette
        var pal = Palette;
        for (int i = 0; i < pal.Length; i++)
        {
            var r = PalRect(i);
            bool sel = pal[i] == _tool;
            Raylib.DrawRectangleRounded(r, 0.25f, 8, sel ? Ui.Accent : new Color(30, 48, 90, 240));
            Raylib.DrawRectangleRoundedLinesEx(r, 0.25f, 8, 2, sel ? Color.White : new Color(120, 170, 230, 150));
            DrawIcon(pal[i], r.X + r.Width / 2, r.Y + r.Height / 2, th);
        }
        if (_msgT > 0)
        {
            float w = MathF.Min(1100, Ui.Measure(_msg, 22).X + 40);
            Raylib.DrawRectangleRounded(new Rectangle(Ui.Width / 2f - w / 2, Top + 10, w, 40), 0.5f, 8, new Color(10, 18, 40, 225));
            Ui.Text(_msg, Ui.Width / 2f, Top + 19, 22, Color.White, Align.Center, shadow: false);
        }
        if (_busy != null) { Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, new Color(0, 0, 0, 120)); Ui.Text("...", Ui.Width / 2f, 330, 40, Color.White, Align.Center); }
        if (_rename != null)
        {
            Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, new Color(0, 0, 0, 160));
            Ui.Panel(new Rectangle(Ui.Width / 2f - 340, 260, 680, 200));
            _rename.Draw(true);
            Ui.Text("[Enter] OK      [Esc] " + Loc.T("menu.back"), Ui.Width / 2f, 410, 22, new Color(170, 190, 220, 255), Align.Center, shadow: false);
        }
    }

    private void DrawIcon(char tool, float cx, float cy, Theme th)
    {
        if (tool == Hand)
        {
            // four-way arrows
            var c = Color.White;
            Art.Tri(new Vector2(cx, cy - 16), new Vector2(cx - 7, cy - 7), new Vector2(cx + 7, cy - 7), c);
            Art.Tri(new Vector2(cx, cy + 16), new Vector2(cx + 7, cy + 7), new Vector2(cx - 7, cy + 7), c);
            Art.Tri(new Vector2(cx - 16, cy), new Vector2(cx - 7, cy + 7), new Vector2(cx - 7, cy - 7), c);
            Art.Tri(new Vector2(cx + 16, cy), new Vector2(cx + 7, cy - 7), new Vector2(cx + 7, cy + 7), c);
            return;
        }
        if (tool == ' ')
        {
            Raylib.DrawLineEx(new Vector2(cx - 12, cy - 12), new Vector2(cx + 12, cy + 12), 5, new Color(255, 120, 120, 255));
            Raylib.DrawLineEx(new Vector2(cx + 12, cy - 12), new Vector2(cx - 12, cy + 12), 5, new Color(255, 120, 120, 255));
            return;
        }
        float scale = tool == 'G' ? 0.42f : 0.62f;
        Rlgl.PushMatrix();
        Rlgl.Translatef(cx - T * scale / 2, cy - T * scale / 2, 0);
        Rlgl.Scalef(scale, scale, 1);
        EditorArt.Tile(tool, 0, 0, th, _t, (_, _) => ' ');
        Rlgl.PopMatrix();
    }
}
