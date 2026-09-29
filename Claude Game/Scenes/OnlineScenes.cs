using System.Numerics;
using System.Text.Json.Nodes;
using Platformer.Core;
using Raylib_cs;

namespace Platformer.Scenes;

/// <summary>Single-line text input drawn in the game style (keyboard input, mouse to focus).</summary>
public sealed class TextField
{
    public string Text = "";
    public bool Password;
    public int MaxLength = 20;
    public Rectangle Rect;
    public string Label = "";

    public void Update(bool focused)
    {
        if (!focused) return;
        int c;
        while ((c = Raylib.GetCharPressed()) != 0)
            if (c >= 32 && c != 127 && Text.Length < MaxLength) Text += char.ConvertFromUtf32(c);
        if ((Raylib.IsKeyPressed(KeyboardKey.Backspace) || Raylib.IsKeyPressedRepeat(KeyboardKey.Backspace)) && Text.Length > 0)
            Text = Text[..^1];
        if ((Raylib.IsKeyDown(KeyboardKey.LeftControl) || Raylib.IsKeyDown(KeyboardKey.RightControl)) && Raylib.IsKeyPressed(KeyboardKey.V))
        {
            var paste = Raylib.GetClipboardText_();
            if (!string.IsNullOrEmpty(paste)) Text = (Text + new string(paste.Where(ch => ch >= 32).ToArray()))[..Math.Min(MaxLength, Text.Length + paste.Length)];
        }
    }

    public void Draw(bool focused)
    {
        Ui.Text(Label, Rect.X, Rect.Y - 30, 22, new Color(170, 200, 240, 255));
        Raylib.DrawRectangleRounded(Rect, 0.3f, 8, new Color(10, 18, 40, 255));
        Raylib.DrawRectangleRoundedLinesEx(Rect, 0.3f, 8, 3, focused ? Ui.Accent : new Color(90, 130, 190, 255));
        string shown = Password ? new string('•', Text.Length) : Text;
        Ui.Text(shown, Rect.X + 14, Rect.Y + (Rect.Height - 30) / 2, 30, Color.White, shadow: false);
        if (focused && (int)(Raylib.GetTime() * 2) % 2 == 0)
        {
            float x = Rect.X + 16 + Ui.Measure(shown, 30).X;
            Raylib.DrawRectangle((int)x, (int)(Rect.Y + 12), 3, (int)Rect.Height - 24, Color.White);
        }
    }
}

/// <summary>Login / registration / logout for the optional online account.</summary>
public sealed class AccountScene : IScene
{
    private readonly TextField _user = new() { MaxLength = 20 }, _pass = new() { Password = true, MaxLength = 128 };
    private readonly Menu _menu = new();
    private int _focus; // 0 user, 1 password, 2 buttons
    private float _t;
    private Task<OnlineResult<string?>>? _busy;
    private Task? _logout;
    private string? _message, _recovery;

    private bool LoggedIn => Online.LoggedIn;

    private void Layout()
    {
        _user.Rect = new Rectangle(Ui.Width / 2f - 260, 250, 520, 60);
        _pass.Rect = new Rectangle(Ui.Width / 2f - 260, 360, 520, 60);
        _menu.Rects.Clear();
        if (LoggedIn)
        {
            _menu.Rects.Add(new Rectangle(Ui.Width / 2f - 220, 330, 440, 62));
            _menu.Rects.Add(new Rectangle(Ui.Width / 2f - 220, 410, 440, 62));
        }
        else
            for (int i = 0; i < 3; i++) _menu.Rects.Add(new Rectangle(Ui.Width / 2f - 330 + i * 225, 470, 210, 62));
    }

    public void Update(float dt)
    {
        _t += dt;
        Layout();
        if (_recovery != null)
        {
            if (Input.Confirm || Input.Click || Input.Back) { _recovery = null; Audio.Play(Sfx.MenuSelect); }
            return;
        }
        if (_busy != null)
        {
            if (!_busy.IsCompleted) return;
            var r = _busy.Result;
            _busy = null;
            if (r.Ok) { _pass.Text = ""; _message = null; _recovery = r.Data; _menu.Selected = 0; }
            else _message = Loc.T(Online.ErrorKey(r.Error));
            return;
        }
        if (_logout != null) { if (_logout.IsCompleted) _logout = null; return; }

        if (LoggedIn)
        {
            switch (_menu.Update(2))
            {
                case 0: _logout = Online.Logout(); break;
                case 1: SceneManager.Go(new OptionsScene()); break;
            }
            if (Input.Back) SceneManager.Go(new OptionsScene());
            return;
        }

        // focus handling: Tab / arrows / mouse
        if (Raylib.IsKeyPressed(KeyboardKey.Tab)) _focus = (_focus + 1) % 3;
        if (_focus < 2 && Raylib.IsKeyPressed(KeyboardKey.Down)) _focus++;
        if (_focus > 0 && _focus < 2 && Raylib.IsKeyPressed(KeyboardKey.Up)) _focus--;
        if (Input.Click)
        {
            if (Ui.Hover(_user.Rect)) _focus = 0;
            else if (Ui.Hover(_pass.Rect)) _focus = 1;
        }
        _user.Update(_focus == 0);
        _pass.Update(_focus == 1);
        if (_focus < 2)
        {
            if (Raylib.IsKeyPressed(KeyboardKey.Enter)) _focus++;
            if (Raylib.IsKeyPressed(KeyboardKey.Escape)) SceneManager.Go(new OptionsScene());
            return;
        }
        if (Raylib.IsKeyPressed(KeyboardKey.Up)) { _focus = 1; return; }
        int sel = _menu.Update(3);
        if (sel is 0 or 1)
        {
            if (!Online.Enabled) { _message = Loc.T("online.not_configured"); return; }
            _message = null;
            _busy = Online.Authenticate(_user.Text.Trim(), _pass.Text, register: sel == 1);
        }
        else if (sel == 2 || Input.Back) SceneManager.Go(new OptionsScene());
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t, false);
        MenuBackdrop.Header(Loc.T("online.account"));
        Layout();
        var panel = new Rectangle(Ui.Width / 2f - 380, 150, 760, 460);
        Ui.Panel(panel);
        if (LoggedIn)
        {
            Ui.Text(Loc.F("online.logged_in", Online.Username ?? ""), Ui.Width / 2f, 220, 36, Ui.Accent, Align.Center);
            Ui.Button(_menu.Rects[0], Loc.T("online.logout"), _menu.Selected == 0, 30);
            Ui.Button(_menu.Rects[1], Loc.T("menu.back"), _menu.Selected == 1, 30);
        }
        else
        {
            _user.Label = Loc.T("online.username");
            _pass.Label = Loc.T("online.password");
            _user.Draw(_focus == 0);
            _pass.Draw(_focus == 1);
            Ui.Text(Loc.T("online.password_rules"), Ui.Width / 2f, 428, 20, new Color(170, 190, 220, 255), Align.Center, shadow: false);
            string[] items = [Loc.T("online.login"), Loc.T("online.register"), Loc.T("menu.back")];
            for (int i = 0; i < 3; i++) Ui.Button(_menu.Rects[i], items[i], _focus == 2 && _menu.Selected == i, 26);
        }
        if (_busy != null || _logout != null) Ui.Text("...", Ui.Width / 2f, 560, 30, Color.White, Align.Center);
        if (_message != null) Ui.TextBlock(_message, Ui.Width / 2f, 555, 24, 700, new Color(255, 150, 150, 255));
        if (!Online.Enabled) Ui.TextBlock(Loc.T("online.not_configured"), Ui.Width / 2f, 640, 22, 900, new Color(40, 60, 100, 255));

        if (_recovery != null)
        {
            Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, new Color(0, 0, 0, 170));
            Ui.Panel(new Rectangle(Ui.Width / 2f - 400, 200, 800, 300));
            Ui.TextBlock(Loc.T("online.recovery"), Ui.Width / 2f, 230, 26, 720, Color.White);
            Ui.Text(_recovery, Ui.Width / 2f, 360, 40, Ui.Accent, Align.Center);
            Ui.Text(Loc.T("menu.continue") + " >", Ui.Width / 2f, 440, 24, Color.White, Align.Center);
        }
    }
}

/// <summary>Online leaderboard of one level (fastest times / most points).</summary>
public sealed class LeaderboardScene : IScene
{
    private readonly string _level;
    private readonly Func<IScene> _back;
    private string _by = "time";
    private Task<OnlineResult<List<LeaderboardEntry>>>? _load;
    private List<LeaderboardEntry>? _entries;
    private string? _error;
    private float _t;

    public LeaderboardScene(string levelId, Func<IScene> back)
    {
        _level = levelId;
        _back = back;
        Reload();
    }

    private void Reload()
    {
        _entries = null;
        _error = null;
        _load = Online.Enabled ? Online.Top(_level, _by, 10) : null;
        if (_load == null) _error = Loc.T("online.not_configured");
    }

    public void Update(float dt)
    {
        _t += dt;
        if (_load is { IsCompleted: true })
        {
            var r = _load.Result;
            _load = null;
            if (r.Ok) _entries = r.Data; else _error = Loc.T(Online.ErrorKey(r.Error));
        }
        if (Input.MenuLeft || Input.MenuRight || (Input.Click && Input.Mouse.Y < 200))
        {
            _by = _by == "time" ? "score" : "time";
            Audio.Play(Sfx.MenuMove);
            Reload();
        }
        else if (Input.Back || Input.Confirm || Input.Click) SceneManager.Go(_back());
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t, false);
        MenuBackdrop.Header($"{Loc.T("online.leaderboard")}  {_level}", 30);
        var panel = new Rectangle(Ui.Width / 2f - 420, 120, 840, 540);
        Ui.Panel(panel);
        Ui.Text($"◀  {(_by == "time" ? Loc.T("online.by_time") : Loc.T("online.by_score"))}  ▶", Ui.Width / 2f, 140, 30, Ui.Accent, Align.Center);
        DrawTable(_entries, _error, 200, _load != null);
    }

    public static void DrawTable(List<LeaderboardEntry>? entries, string? error, float y, bool loading)
    {
        if (loading) { Ui.Text("...", Ui.Width / 2f, y + 60, 34, Color.White, Align.Center); return; }
        if (error != null) { Ui.TextBlock(error, Ui.Width / 2f, y + 60, 26, 700, new Color(255, 170, 170, 255)); return; }
        if (entries == null) return;
        if (entries.Count == 0) { Ui.TextBlock(Loc.T("online.empty"), Ui.Width / 2f, y + 60, 26, 700, Color.White); return; }
        var head = new Color(150, 190, 240, 255);
        Ui.Text("#", Ui.Width / 2f - 380, y, 22, head);
        Ui.Text(Loc.T("online.username"), Ui.Width / 2f - 320, y, 22, head);
        Ui.Text(Loc.T("hud.time"), Ui.Width / 2f + 190, y, 22, head, Align.Right);
        Ui.Text(Loc.T("hud.score"), Ui.Width / 2f + 380, y, 22, head, Align.Right);
        foreach (var e in entries)
        {
            y += 42;
            var col = e.Rank switch { 1 => new Color(255, 215, 90, 255), 2 => new Color(220, 225, 235, 255), 3 => new Color(230, 170, 110, 255), _ => Color.White };
            Ui.Text($"{e.Rank}", Ui.Width / 2f - 380, y, 28, col);
            Ui.Text(e.Name + (e.Registered ? " ✓" : ""), Ui.Width / 2f - 320, y, 28, col);
            Ui.Text(Online.FormatTime(e.TimeTicks), Ui.Width / 2f + 190, y, 28, col, Align.Right);
            Ui.Text($"{e.Score}", Ui.Width / 2f + 380, y, 28, col, Align.Right);
        }
    }
}

/// <summary>
/// Sends a finished run to the server. Without an account the player types a nickname first.
/// Shows the verified result, the rank and the top 5.
/// </summary>
public sealed class SubmitScene : IScene
{
    public sealed record Run(string LevelId, string? RunId, string Replay, int TimeTicks, int Score, int Coins);

    private readonly Run _run;
    private readonly Func<IScene> _next;
    private readonly TextField _nick = new() { MaxLength = 16 };
    private Task<OnlineResult<JsonNode>>? _busy;
    private JsonNode? _result;
    private List<LeaderboardEntry>? _top;
    private string? _message;
    private float _t;
    private bool _asking;

    public SubmitScene(Run run, Func<IScene> next)
    {
        _run = run;
        _next = next;
        _nick.Text = SaveData.Current.Nickname ?? "";
        _nick.Rect = new Rectangle(Ui.Width / 2f - 260, 330, 520, 60);
        if (run.RunId == null) _message = Loc.T("online.no_run");
        else if (Online.LoggedIn) Send();
        else _asking = true;
    }

    private void Send()
    {
        _asking = false;
        _message = null;
        _busy = Online.Submit(_run.RunId!, _run.LevelId, _run.Replay, _run.TimeTicks, _run.Score, _run.Coins, _nick.Text.Trim());
    }

    public void Update(float dt)
    {
        _t += dt;
        if (_busy != null)
        {
            if (!_busy.IsCompleted) return;
            var r = _busy.Result;
            _busy = null;
            if (r.Ok)
            {
                _result = r.Data;
                _top = r.Data?["top"]?.AsArray().Select(e => new LeaderboardEntry(e!["rank"]!.GetValue<int>(), e["name"]!.GetValue<string>(),
                    e["registered"]!.GetValue<bool>(), e["timeTicks"]!.GetValue<int>(), e["score"]!.GetValue<int>(), e["coins"]!.GetValue<int>())).ToList();
                if (!Online.LoggedIn) { SaveData.Current.Nickname = _nick.Text.Trim(); SaveData.Save(); }
            }
            else
            {
                _message = Loc.T(Online.ErrorKey(r.Error));
                // name problems can be fixed; everything else ends here (the run id is used up)
                _asking = r.Error is "nick_format" or "nick_bad" or "nick_taken";
            }
            return;
        }
        if (_asking)
        {
            _nick.Update(true);
            if (Raylib.IsKeyPressed(KeyboardKey.Enter) && _nick.Text.Trim().Length >= 3) Send();
            else if (Raylib.IsKeyPressed(KeyboardKey.Escape)) SceneManager.Go(_next());
            return;
        }
        if (Input.Confirm || Input.Back || Input.Click) SceneManager.Go(_next());
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t, false);
        MenuBackdrop.Header(Loc.T("online.leaderboard"), 30);
        Ui.Panel(new Rectangle(Ui.Width / 2f - 420, 120, 840, 540));
        Ui.Text($"{_run.LevelId}   {Online.FormatTime(_run.TimeTicks)}   {_run.Score}", Ui.Width / 2f, 140, 30, Ui.Accent, Align.Center);
        if (_asking)
        {
            _nick.Label = Loc.T("online.nickname");
            _nick.Draw(true);
            Ui.Text("Enter ✓     Esc ✗", Ui.Width / 2f, 420, 22, new Color(170, 190, 220, 255), Align.Center, shadow: false);
        }
        if (_busy != null) Ui.Text(Loc.T("online.sending"), Ui.Width / 2f, 300, 30, Color.White, Align.Center);
        if (_message != null) Ui.TextBlock(_message, Ui.Width / 2f, _asking ? 470 : 300, 26, 720, new Color(255, 170, 170, 255));
        if (_result != null)
        {
            Ui.TextBlock(Loc.F("online.accepted", _result["rankTime"]?.ToString() ?? "?", _result["rankScore"]?.ToString() ?? "?"), Ui.Width / 2f, 195, 26, 760, new Color(140, 255, 180, 255));
            LeaderboardScene.DrawTable(_top, null, 270, false);
        }
        if (!_asking && _busy == null) Ui.Text(Loc.T("menu.continue") + " >", Ui.Width / 2f, 612, 24, Color.White, Align.Center);
    }
}
