using System.Numerics;
using System.Text.Json.Nodes;
using Platformer.Core;
using Platformer.Game;
using Raylib_cs;

namespace Platformer.Scenes;

public sealed record CommunityEntry(string Id, string Title, string Author, int World, int Likes, int Plays, bool Liked);

/// <summary>Small shared drawing helpers (the fonts have no ♥/▶ glyphs, so they are drawn as shapes).</summary>
public static class Icons
{
    public static void Heart(float x, float y, bool filled, Color col)
    {
        if (filled) Art.Heart(new Vector2(x, y), 0.55f, col);
        else
        {
            Art.Heart(new Vector2(x, y), 0.55f, col);
            Art.Heart(new Vector2(x, y + 1), 0.33f, new Color(30, 48, 90, 255));
        }
    }

    public static void Play(float x, float y, Color col) => Art.Tri(new Vector2(x - 7, y - 9), new Vector2(x - 7, y + 9), new Vector2(x + 9, y), col);

    public static void Stats(float right, float y, CommunityEntry e, Color col)
    {
        string plays = e.Plays.ToString(), likes = e.Likes.ToString();
        float pw = Ui.Measure(plays, 22).X, lw = Ui.Measure(likes, 22).X;
        Ui.Text(plays, right, y, 22, col, Align.Right, shadow: false);
        Play(right - pw - 16, y + 12, col);
        float lx = right - pw - 44;
        Ui.Text(likes, lx, y, 22, col, Align.Right, shadow: false);
        Heart(lx - lw - 16, y + 12, e.Liked, new Color(255, 90, 120, 255));
    }

    public static CommunityEntry Entry(JsonNode l) => new(l["id"]!.GetValue<string>(), l["title"]!.GetValue<string>(), l["author"]?.GetValue<string>() ?? "",
        l["world"]!.GetValue<int>(), l["likes"]!.GetValue<int>(), l["plays"]!.GetValue<int>(), l["liked"]?.GetValue<bool>() ?? false);
}

/// <summary>Browse community levels: most liked / newest / most played, search, pages.</summary>
public sealed class CommunityScene : IScene
{
    private string _sort, _q;
    private int _page, _sel, _total;
    private float _t;
    private List<CommunityEntry>? _list;
    private string? _error;
    private Task<OnlineResult<JsonNode>>? _load;
    private TextField? _search;

    public CommunityScene(string sort = "top", string q = "", int page = 1, int sel = 0)
    {
        _sort = sort; _q = q; _page = page; _sel = sel;
        Load();
    }

    private void Load()
    {
        _list = null; _error = null;
        if (!Online.Enabled) { _error = Loc.T("online.not_configured"); return; }
        _load = Online.Community(_sort, _q, _page);
    }

    private static readonly string[] Sorts = ["top", "new", "plays"];
    private static Rectangle TabRect(int i) => new(200 + i * 230, 110, 215, 50);
    private static Rectangle SearchRect => new(900, 110, 240, 50);
    private static Rectangle CardRect(int i) => new(130 + i % 2 * 520, 180 + i / 2 * 84, 500, 72);
    private static Rectangle PageRect(int d) => d < 0 ? new(130, 610, 120, 50) : new(1030, 610, 120, 50);
    private static Rectangle BuildRect => new(480, 610, 320, 50);

    public void Update(float dt)
    {
        _t += dt;
        if (_load is { IsCompleted: true })
        {
            var r = _load.Result;
            _load = null;
            if (!r.Ok) _error = Loc.T(Online.ErrorKey(r.Error));
            else
            {
                _list = r.Data!["levels"]!.AsArray().Select(l => Icons.Entry(l!)).ToList();
                _total = r.Data!["total"]!.GetValue<int>();
                _sel = Math.Min(_sel, Math.Max(0, _list.Count - 1));
            }
        }
        if (_search != null)
        {
            _search.Update(true);
            if (Raylib.IsKeyPressed(KeyboardKey.Enter)) { _q = _search.Text.Trim(); _page = 1; _search = null; Load(); }
            else if (Raylib.IsKeyPressed(KeyboardKey.Escape)) _search = null;
            return;
        }
        for (int i = 0; i < 3; i++)
            if (Input.Click && Ui.Hover(TabRect(i)) && _sort != Sorts[i]) { _sort = Sorts[i]; _page = 1; Audio.Play(Sfx.MenuMove); Load(); }
        if ((Input.Click && Ui.Hover(SearchRect)) || Raylib.IsKeyPressed(KeyboardKey.F))
            _search = new TextField { Text = _q, MaxLength = 40, Rect = new Rectangle(Ui.Width / 2f - 300, 330, 600, 60), Label = Loc.T("community.search") };
        if (Input.Click && Ui.Hover(BuildRect)) { SceneManager.Go(new EditorListScene()); return; }
        int pages = Math.Max(1, (_total + 19) / 20);
        if (((Input.Click && Ui.Hover(PageRect(-1))) || Raylib.IsKeyPressed(KeyboardKey.PageUp)) && _page > 1) { _page--; Load(); }
        if (((Input.Click && Ui.Hover(PageRect(1))) || Raylib.IsKeyPressed(KeyboardKey.PageDown)) && _page < pages) { _page++; Load(); }
        int n = Math.Min(10, _list?.Count ?? 0);
        if (n > 0)
        {
            int prev = _sel;
            if (Input.MenuRight) _sel = Math.Min(n - 1, _sel + 1);
            if (Input.MenuLeft) _sel = Math.Max(0, _sel - 1);
            if (Input.MenuDown) _sel = Math.Min(n - 1, _sel + 2);
            if (Input.MenuUp) _sel = Math.Max(0, _sel - 2);
            bool click = false;
            for (int i = 0; i < n; i++)
                if (Ui.Hover(CardRect(i))) { if (Input.MouseMoved) _sel = i; if (Input.Click) { _sel = i; click = true; } }
            if (prev != _sel) Audio.Play(Sfx.MenuMove);
            if (Input.Confirm || click)
            {
                Audio.Play(Sfx.MenuSelect);
                string sort = _sort, q = _q; int page = _page, sel = _sel;
                SceneManager.Go(new CommunityLevelScene(_list![_sel].Id, () => new CommunityScene(sort, q, page, sel), _list[_sel]));
                return;
            }
        }
        if (Input.Back) SceneManager.Go(new TitleScene());
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t, false);
        MenuBackdrop.Header(Loc.T("community.title"), 24);
        string[] labels = [Loc.T("online.by_top"), Loc.T("online.by_new"), Loc.T("online.by_plays")];
        for (int i = 0; i < 3; i++) Ui.Button(TabRect(i), labels[i], _sort == Sorts[i], 24);
        Ui.Button(SearchRect, _q != "" ? _q : Loc.T("community.search"), false, 22);
        if (_error != null) Ui.TextBlock(_error, Ui.Width / 2f, 300, 28, 800, Color.White);
        else if (_list == null) Ui.Text("...", Ui.Width / 2f, 330, 34, Color.White, Align.Center);
        else if (_list.Count == 0) Ui.TextBlock(Loc.T("community.empty"), Ui.Width / 2f, 300, 28, 800, Color.White);
        else
            for (int i = 0; i < Math.Min(10, _list.Count); i++)
            {
                var l = _list[i];
                var r = CardRect(i);
                bool sel = i == _sel;
                var th = Art.ThemeFor(l.World);
                Raylib.DrawRectangleRounded(r, 0.25f, 8, sel ? Ui.Accent : new Color(30, 48, 90, 240));
                Raylib.DrawRectangleRoundedLinesEx(r, 0.25f, 8, 3, sel ? Color.White : Art.Fade(th.GroundCap, 0.9f));
                var fg = sel ? Ui.Ink : Color.White;
                float s = 28;
                while (s > 16 && Ui.Measure(l.Title, s).X > 300) s -= 2;
                Ui.Text(l.Title, r.X + 16, r.Y + 8, s, fg, shadow: !sel);
                Ui.Text(Loc.F("community.by", l.Author), r.X + 16, r.Y + 42, 18, sel ? Ui.Ink : new Color(170, 200, 240, 255), shadow: false);
                Icons.Stats(r.X + r.Width - 16, r.Y + 24, l, fg);
            }
        int pages = Math.Max(1, (_total + 19) / 20);
        if (_page > 1) Ui.Button(PageRect(-1), "<", false, 26);
        if (_page < pages) Ui.Button(PageRect(1), ">", false, 26);
        Ui.Button(BuildRect, Loc.T("editor.title"), false, 24);
        if (pages > 1) Ui.Text($"{_page} / {pages}", Ui.Width / 2f, 578, 20, new Color(40, 60, 100, 255), Align.Center, shadow: false);
        if (_search != null)
        {
            Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, new Color(0, 0, 0, 160));
            Ui.Panel(new Rectangle(Ui.Width / 2f - 340, 260, 680, 200));
            _search.Draw(true);
            Ui.Text("[Enter] OK      [Esc] " + Loc.T("menu.back"), Ui.Width / 2f, 410, 22, new Color(170, 190, 220, 255), Align.Center, shadow: false);
        }
    }
}

/// <summary>One community level: play, like, leaderboard, report.</summary>
public sealed class CommunityLevelScene : IScene
{
    private readonly string _code;
    private readonly Func<IScene> _back;
    private CommunityEntry? _info;
    private string? _data, _msg;
    private List<LeaderboardEntry>? _top;
    private readonly Menu _menu = new();
    private float _t;
    private Task<OnlineResult<JsonNode>>? _load, _like, _report;
    private Task<OnlineResult<List<LeaderboardEntry>>>? _topLoad;
    private TextField? _reason;

    public CommunityLevelScene(string code, Func<IScene> back, CommunityEntry? info = null)
    {
        _code = code; _back = back; _info = info;
        _load = Online.CommunityLevel(code);
        _topLoad = Online.Top(code, "time", 5);
    }

    private string[] Items => [Loc.T("menu.play"), Loc.T("community.like"), Loc.T("online.leaderboard"), Loc.T("community.report"), Loc.T("menu.back")];

    private void Layout()
    {
        _menu.Rects.Clear();
        for (int i = 0; i < 5; i++) _menu.Rects.Add(new Rectangle(120, 250 + i * 70, 380, 58));
    }

    private IScene Self() => new CommunityLevelScene(_code, _back, _info);

    public void Update(float dt)
    {
        _t += dt;
        if (_load is { IsCompleted: true })
        {
            var r = _load.Result; _load = null;
            if (r.Ok) { _info = Icons.Entry(r.Data!); _data = r.Data!["data"]!.GetValue<string>(); } else _msg = Loc.T(Online.ErrorKey(r.Error));
        }
        if (_topLoad is { IsCompleted: true }) { _top = _topLoad.Result.Data ?? new(); _topLoad = null; }
        if (_like is { IsCompleted: true })
        {
            var r = _like.Result; _like = null;
            if (r.Ok && _info != null) _info = _info with { Liked = r.Data!["liked"]!.GetValue<bool>(), Likes = r.Data!["likes"]!.GetValue<int>() };
            else _msg = Loc.T(Online.ErrorKey(r.Error));
        }
        if (_report is { IsCompleted: true }) { _msg = _report.Result.Ok ? Loc.T("community.reported") : Loc.T(Online.ErrorKey(_report.Result.Error)); _report = null; }
        if (_reason != null)
        {
            _reason.Update(true);
            if (Raylib.IsKeyPressed(KeyboardKey.Enter)) { _report = Online.Report(_code, _reason.Text); _reason = null; }
            else if (Raylib.IsKeyPressed(KeyboardKey.Escape)) _reason = null;
            return;
        }
        Layout();
        switch (_menu.Update(5))
        {
            case 0:
                if (_data == null || _info == null) break;
                Session.Lives = Session.StartLives;
                SceneManager.Go(new PlayScene(-1, null, new CustomLevel(_code, LevelData.Parse(_data, _code), "community", _info.Title, _info.Author, Self)));
                break;
            case 1:
                if (!Online.LoggedIn) _msg = Loc.T("community.login_needed");
                else _like ??= Online.Like(_code);
                break;
            case 2: SceneManager.Go(new LeaderboardScene(_code, Self)); break;
            case 3: _reason = new TextField { MaxLength = 200, Rect = new Rectangle(Ui.Width / 2f - 340, 330, 680, 60), Label = Loc.T("community.report_reason") }; break;
            case 4: SceneManager.Go(_back()); return;
        }
        if (Input.Back) SceneManager.Go(_back());
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t, false);
        string title = _info?.Title ?? "...";
        float s = 58;
        while (s > 28 && Ui.Measure(title, s).X > 1100) s -= 4;
        Ui.Title(title, Ui.Width / 2f, 40, s, Color.White, new Color(30, 50, 100, 255));
        if (_info != null)
        {
            Ui.Text(Loc.F("community.by", _info.Author), Ui.Width / 2f - 20, 130, 24, new Color(40, 60, 100, 255), Align.Right, shadow: false);
            Icons.Stats(Ui.Width / 2f + 200, 130, _info, new Color(40, 60, 100, 255));
        }
        Layout();
        var items = Items;
        for (int i = 0; i < items.Length; i++) Ui.Button(_menu.Rects[i], items[i], _menu.Selected == i, 26);
        if (_info != null) Icons.Heart(_menu.Rects[1].X + 30, _menu.Rects[1].Y + 29, _info.Liked, new Color(255, 90, 120, 255));
        Ui.Panel(new Rectangle(560, 190, 620, 420));
        Ui.Text(Loc.T("online.by_time"), 870, 206, 26, Ui.Accent, Align.Center);
        if (_top == null) Ui.Text("...", 870, 300, 30, Color.White, Align.Center);
        else if (_top.Count == 0) Ui.TextBlock(Loc.T("online.empty"), 870, 300, 24, 540, Color.White);
        else
            for (int k = 0; k < _top.Count; k++)
            {
                float y = 260 + k * 60;
                Ui.Text($"{_top[k].Rank}. {_top[k].Name}", 600, y, 26, Color.White);
                Ui.Text(Online.FormatTime(_top[k].TimeTicks), 1150, y, 26, Color.White, Align.Right);
            }
        if (_data != null) EditorArt.MiniMap(_data, 580, 540, 600);
        if (_msg != null) Ui.TextBlock(_msg, Ui.Width / 2f, 640, 22, 1000, Color.White);
        if (_reason != null)
        {
            Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, new Color(0, 0, 0, 160));
            Ui.Panel(new Rectangle(Ui.Width / 2f - 380, 260, 760, 200));
            _reason.Draw(true);
            Ui.Text("[Enter] OK      [Esc] " + Loc.T("menu.back"), Ui.Width / 2f, 410, 22, new Color(170, 190, 220, 255), Align.Center, shadow: false);
        }
    }
}
