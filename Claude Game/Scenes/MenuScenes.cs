using System.Numerics;
using Platformer.Core;
using Platformer.Game;
using Raylib_cs;

namespace Platformer.Scenes;

/// <summary>Animated snowy background shared by all menus.</summary>
public static class MenuBackdrop
{
    private static readonly Theme Theme = Art.ThemeFor(1);

    public static void Draw(float t, bool penguin = true)
    {
        Art.Background(Theme, t * 40, t);
        for (int x = 0; x < Ui.Width; x += 48)
        {
            Art.Ground(x / 48, 13, Theme, true, false, false);
            Raylib.DrawRectangle(x, 14 * 48, 48, 48, Theme.GroundFill);
        }
        for (int i = 0; i < 70; i++)
        {
            float x = (Art.Hash(i * 7) * 1400 + MathF.Sin(t + i) * 30) % 1400 - 60;
            float y = (Art.Hash(i * 11) * 760 + t * (30 + Art.Hash(i) * 50)) % 760 - 20;
            Raylib.DrawCircleV(new Vector2(x, y), 1.5f + Art.Hash(i * 5) * 2.5f, new Color(255, 255, 255, 200));
        }
        if (penguin)
        {
            float px = (t * 110) % (Ui.Width + 200) - 100;
            Art.Penguin(px, 13 * 48, 1, t, 1, false, 0, 1, false);
        }
    }

    public static void Header(string text, float y = 40)
    {
        Ui.Title(text, Ui.Width / 2f, y, 58, Color.White, new Color(30, 50, 100, 255));
    }

    public static void Hint()
    {
        Ui.Text(Loc.T("hint.menu"), Ui.Width / 2f, Ui.Height - 34, 20, new Color(40, 60, 100, 255), Align.Center, shadow: false);
    }
}

public sealed class TitleScene : IScene
{
    private readonly Menu _menu = new();
    private float _t;
    private static bool _autoChecked;

    public TitleScene()
    {
        Audio.PlayMusic(0);
        if (!_autoChecked && !GameConfig.IsDevBuild)
        {
            _autoChecked = true;
            Updater.CheckAsync();
            UpdateDialog.AutoShow = true;
        }
    }

    private string[] Items => [Loc.T("menu.play"), $"{Loc.T("menu.language")}: {Loc.Current.Name}", Loc.T("menu.options"), Loc.T("menu.quit")];

    private void Layout()
    {
        _menu.Rects.Clear();
        for (int i = 0; i < 4; i++) _menu.Rects.Add(new Rectangle(Ui.Width / 2f - 200, 330 + i * 78, 400, 62));
    }

    public void Update(float dt)
    {
        _t += dt;
        if (UpdateDialog.Update(dt)) return;
        Layout();
        switch (_menu.Update(4))
        {
            case 0:
                SceneManager.Go(new LevelSelectScene());
                break;
            case 1:
                SceneManager.Go(new LanguageScene());
                break;
            case 2:
                SceneManager.Go(new OptionsScene());
                break;
            case 3:
                SceneManager.QuitRequested = true;
                break;
        }
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t);
        float bob = MathF.Sin(_t * 2) * 6;
        Ui.Title(GameConfig.Name, Ui.Width / 2f, 90 + bob, 104, new Color(255, 255, 255, 255), new Color(30, 60, 130, 255));
        Ui.Text(Loc.T("subtitle"), Ui.Width / 2f, 210 + bob, 32, new Color(255, 214, 90, 255), Align.Center);
        Art.Penguin(Ui.Width / 2f - 330, 300, 1, _t, 0, true, -1 + MathF.Sin(_t * 3), 1, true, 1, false, 1.8f);
        Art.Penguin(Ui.Width / 2f + 330, 300, -1, _t + 1, 0, false, 0, 2, false, 1, false, 1.8f);

        Layout();
        var items = Items;
        for (int i = 0; i < items.Length; i++) Ui.Button(_menu.Rects[i], items[i], _menu.Selected == i);

        Ui.Text($"v{GameConfig.Version}{(GameConfig.IsDevBuild ? " (dev)" : "")}", Ui.Width - 16, Ui.Height - 30, 18, new Color(40, 60, 100, 255), Align.Right, shadow: false);
        MenuBackdrop.Hint();
        UpdateDialog.Draw();
    }
}

public sealed class LanguageScene : IScene
{
    private const int Cols = 3;
    private int _sel;
    private float _t;

    public LanguageScene() => _sel = Loc.All.IndexOf(Loc.Current);

    private Rectangle Rect(int i)
    {
        int col = i % Cols, row = i / Cols;
        return new Rectangle(Ui.Width / 2f - 3 * 190 + col * 380 + 10, 140 + row * 82, 360, 66);
    }

    public void Update(float dt)
    {
        _t += dt;
        int n = Loc.All.Count;
        int prev = _sel;
        if (Input.MenuLeft) _sel = Math.Max(0, _sel - 1);
        if (Input.MenuRight) _sel = Math.Min(n - 1, _sel + 1);
        if (Input.MenuUp) _sel = _sel - Cols >= 0 ? _sel - Cols : _sel;
        if (Input.MenuDown) _sel = Math.Min(n - 1, _sel + Cols);
        bool click = false;
        for (int i = 0; i < n; i++)
            if (Ui.Hover(Rect(i)))
            {
                if (Input.MouseMoved) _sel = i;
                if (Input.Click) { _sel = i; click = true; }
            }
        if (_sel != prev) { Audio.Play(Sfx.MenuMove); Loc.Set(Loc.All[_sel]); }

        if (Input.Confirm || click)
        {
            Audio.Play(Sfx.MenuSelect);
            Loc.Set(Loc.All[_sel]);
            SaveData.Current.Language = Loc.Current.Code;
            SaveData.Save();
            SceneManager.Go(new TitleScene());
        }
        else if (Input.Back)
        {
            Loc.Set(Loc.All.First(l => l.Code == (SaveData.Current.Language ?? Loc.All[_sel].Code)));
            SceneManager.Go(new TitleScene());
        }
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t, false);
        MenuBackdrop.Header(Loc.T("lang.title"), 34);
        for (int i = 0; i < Loc.All.Count; i++)
        {
            var lang = Loc.All[i];
            var r = Rect(i);
            bool sel = i == _sel;
            Raylib.DrawRectangleRounded(new Rectangle(r.X + 4, r.Y + 6, r.Width, r.Height), 0.35f, 8, new Color(0, 0, 0, 90));
            Raylib.DrawRectangleRounded(r, 0.35f, 8, sel ? Ui.Accent : new Color(30, 48, 90, 235));
            Raylib.DrawRectangleRoundedLinesEx(r, 0.35f, 8, 3, sel ? Color.White : new Color(120, 170, 230, 255));
            Ui.Text(lang.Name, r.X + r.Width / 2, r.Y + 15, 34, sel ? Ui.Ink : Color.White, Align.Center, lang.Font, shadow: !sel);
            Ui.Text(lang.Code.ToUpperInvariant(), r.X + 14, r.Y + 6, 14, sel ? Ui.Ink : new Color(140, 170, 220, 255), Align.Left, shadow: false);
        }
        MenuBackdrop.Hint();
    }
}

public sealed class OptionsScene : IScene
{
    private readonly Menu _menu = new();
    private float _t;
    private bool _showControls;
    private bool _checking;

    private const int Count = 6;

    private void Layout()
    {
        _menu.Rects.Clear();
        for (int i = 0; i < Count; i++) _menu.Rects.Add(new Rectangle(Ui.Width / 2f - 280, 150 + i * 80, 560, 62));
    }

    private static string OnOff(bool v) => v ? Loc.T("options.on") : Loc.T("options.off");
    private static string Bar(float v) => new string('■', (int)MathF.Round(v * 10)) + new string('□', 10 - (int)MathF.Round(v * 10));

    public void Update(float dt)
    {
        _t += dt;
        if (UpdateDialog.Update(dt)) return;
        if (_showControls)
        {
            if (Input.Back || Input.Confirm || Input.Click) { _showControls = false; Audio.Play(Sfx.MenuSelect); }
            return;
        }

        if (_checking && Updater.State == UpdateState.Available)
        {
            _checking = false;
            UpdateDialog.Show();
        }

        Layout();
        var save = SaveData.Current;
        int dir = Input.MenuRight ? 1 : Input.MenuLeft ? -1 : 0;
        if (dir != 0)
        {
            if (_menu.Selected == 0) { save.SfxVolume = Math.Clamp(save.SfxVolume + dir * 0.1f, 0, 1); Audio.SfxVolume = save.SfxVolume; Audio.Play(Sfx.Coin); }
            if (_menu.Selected == 1) { save.MusicVolume = Math.Clamp(save.MusicVolume + dir * 0.1f, 0, 1); Audio.MusicVolume = save.MusicVolume; }
            SaveData.Save();
        }

        switch (_menu.Update(Count))
        {
            case 0:
                save.SfxVolume = save.SfxVolume >= 1 ? 0 : Math.Clamp(save.SfxVolume + 0.1f, 0, 1);
                Audio.SfxVolume = save.SfxVolume;
                SaveData.Save();
                break;
            case 1:
                save.MusicVolume = save.MusicVolume >= 1 ? 0 : Math.Clamp(save.MusicVolume + 0.1f, 0, 1);
                Audio.MusicVolume = save.MusicVolume;
                SaveData.Save();
                break;
            case 2:
                save.Fullscreen = !save.Fullscreen;
                Program.ApplyFullscreen(save.Fullscreen);
                SaveData.Save();
                break;
            case 3:
                _showControls = true;
                break;
            case 4:
                _checking = true;
                Updater.CheckAsync();
                break;
            case 5:
                SceneManager.Go(new TitleScene());
                break;
        }
        if (Input.Back) SceneManager.Go(new TitleScene());
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t);
        MenuBackdrop.Header(Loc.T("options.title"));
        Layout();
        var save = SaveData.Current;
        string[] items =
        [
            $"{Loc.T("options.sfx")}   {Bar(save.SfxVolume)}",
            $"{Loc.T("options.music")}   {Bar(save.MusicVolume)}",
            $"{Loc.T("options.fullscreen")}: {OnOff(save.Fullscreen)}",
            Loc.T("options.controls"),
            Loc.T("options.update"),
            Loc.T("menu.back")
        ];
        for (int i = 0; i < Count; i++) Ui.Button(_menu.Rects[i], items[i], _menu.Selected == i, 30);

        string status = Updater.State switch
        {
            UpdateState.Checking => Loc.T("update.checking"),
            UpdateState.UpToDate => Loc.T("update.none"),
            UpdateState.Failed => Loc.T("update.failed"),
            UpdateState.Available => Loc.F("update.available", Updater.LatestVersion ?? ""),
            _ => ""
        };
        if (_checking || Updater.State is UpdateState.UpToDate or UpdateState.Failed)
            Ui.Text(status, Ui.Width / 2f, 640, 24, Color.White, Align.Center);
        Ui.Text($"{Loc.T("options.version")} {GameConfig.Version}{(GameConfig.IsDevBuild ? " (dev)" : "")}", Ui.Width - 16, Ui.Height - 30, 18, new Color(40, 60, 100, 255), Align.Right, shadow: false);

        if (_showControls) DrawControls();
        UpdateDialog.Draw();
    }

    private static void DrawControls()
    {
        Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, new Color(0, 0, 0, 140));
        var r = new Rectangle(160, 110, 960, 500);
        Ui.Panel(r);
        Ui.Text(Loc.T("options.controls"), 640, 130, 44, Ui.Accent, Align.Center);
        float y = 210;
        Ui.Text(Loc.T("controls.keyboard"), 560, y, 28, new Color(150, 200, 255, 255), Align.Center);
        Ui.Text(Loc.T("controls.gamepad"), 900, y, 28, new Color(150, 200, 255, 255), Align.Center);
        (string key, string kb, string pad)[] rows =
        [
            ("controls.move", "← → / A D", "D-Pad / Stick"),
            ("controls.jump", "Space / ↑ / W", "A"),
            ("controls.run", "Shift / X", "X / B"),
            ("controls.pause", "Esc / P", "Start"),
        ];
        foreach (var (key, kb, pad) in rows)
        {
            y += 70;
            Ui.Text(Loc.T(key), 200, y, 28, Color.White);
            Ui.Text(kb, 560, y, 28, Color.White, Align.Center);
            Ui.Text(pad, 900, y, 28, Color.White, Align.Center);
        }
    }
}

public sealed class LevelSelectScene : IScene
{
    private int _sel;
    private float _t;

    public LevelSelectScene()
    {
        Session.Levels = LevelData.Index();
        _sel = Math.Clamp(SaveData.Current.Unlocked - 1, 0, Session.Levels.Count - 1);
        Audio.PlayMusic(0);
    }

    private static Rectangle Rect(int i)
    {
        int world = i / 3, n = i % 3;
        return new Rectangle(470 + n * 250, 130 + world * 132, 230, 112);
    }

    private static bool Unlocked(int i) => i < SaveData.Current.Unlocked;

    public void Update(float dt)
    {
        _t += dt;
        int count = Session.Levels.Count, prev = _sel;
        if (Input.MenuLeft) _sel = Math.Max(0, _sel - 1);
        if (Input.MenuRight) _sel = Math.Min(count - 1, _sel + 1);
        if (Input.MenuUp && _sel - 3 >= 0) _sel -= 3;
        if (Input.MenuDown && _sel + 3 < count) _sel += 3;
        bool click = false;
        for (int i = 0; i < count; i++)
            if (Ui.Hover(Rect(i)))
            {
                if (Input.MouseMoved) _sel = i;
                if (Input.Click) { _sel = i; click = true; }
            }
        if (prev != _sel) Audio.Play(Sfx.MenuMove);

        if ((Input.Confirm || click) && Unlocked(_sel))
        {
            Audio.Play(Sfx.MenuSelect);
            Session.Lives = Session.StartLives;
            SceneManager.Go(new PlayScene(_sel));
        }
        else if (Input.Back) SceneManager.Go(new TitleScene());
    }

    public void Draw()
    {
        MenuBackdrop.Draw(_t, false);
        MenuBackdrop.Header(Loc.T("levels.title"), 30);
        int count = Session.Levels.Count;
        for (int w = 0; w < (count + 2) / 3; w++)
        {
            var th = Art.ThemeFor(w + 1);
            var band = new Rectangle(60, 124 + w * 132, 1160, 124);
            Raylib.DrawRectangleRounded(band, 0.2f, 8, Art.Fade(th.SkyTop, 0.85f));
            Raylib.DrawRectangleRoundedLinesEx(band, 0.2f, 8, 2, Art.Fade(th.GroundCap, 0.8f));
            Ui.Text($"{Loc.T("hud.world")} {w + 1}", 84, 140 + w * 132, 22, new Color(200, 220, 255, 255));
            var name = Loc.T($"world.{w + 1}");
            float s = 34;
            while (s > 16 && Ui.Measure(name, s).X > 370) s -= 2;
            Ui.Text(name, 84, 172 + w * 132, s, Color.White);
        }

        for (int i = 0; i < count; i++)
        {
            var r = Rect(i);
            bool sel = i == _sel, open = Unlocked(i);
            string id = $"{i / 3 + 1}-{i % 3 + 1}";
            if (sel) r = new Rectangle(r.X - 4, r.Y - 4, r.Width + 8, r.Height + 8);
            Raylib.DrawRectangleRounded(r, 0.2f, 8, sel ? Ui.Accent : open ? new Color(30, 48, 90, 240) : new Color(40, 44, 60, 230));
            Raylib.DrawRectangleRoundedLinesEx(r, 0.2f, 8, 3, sel ? Color.White : new Color(120, 170, 230, 255));
            var fg = sel ? Ui.Ink : Color.White;
            Ui.Text(id, r.X + 16, r.Y + 10, 40, open ? fg : new Color(130, 130, 150, 255), shadow: !sel);
            if (!open)
            {
                DrawLock(new Vector2(r.X + r.Width - 40, r.Y + 36));
                Ui.Text(Loc.T("levels.locked"), r.X + 16, r.Y + 70, 22, new Color(150, 150, 170, 255), shadow: false);
                continue;
            }
            if (SaveData.Current.Records.TryGetValue(id, out var rec))
            {
                Art.Coin(new Vector2(r.X + r.Width - 70, r.Y + 32), _t, 0.7f);
                Ui.Text($"{rec.Coins}/{rec.TotalCoins}", r.X + r.Width - 14, r.Y + 20, 22, fg, Align.Right, shadow: !sel);
                Ui.Text($"{Loc.T("levels.best")}: {rec.Score}", r.X + 16, r.Y + 62, 20, fg, shadow: !sel);
                Ui.Text(StageView.FormatTime(rec.Time), r.X + r.Width - 14, r.Y + 62, 20, fg, Align.Right, shadow: !sel);
                Art.Star(new Vector2(r.X + r.Width - 26, r.Y + 94), 9, 4, new Color(255, 230, 90, 255));
            }
        }
        MenuBackdrop.Hint();
    }

    private static void DrawLock(Vector2 c)
    {
        Raylib.DrawRing(c - new Vector2(0, 10), 8, 12, 180, 360, 16, new Color(170, 170, 190, 255));
        Raylib.DrawRectangleRounded(new Rectangle(c.X - 16, c.Y - 10, 32, 26), 0.3f, 4, new Color(170, 170, 190, 255));
        Raylib.DrawCircleV(c + new Vector2(0, 2), 4, new Color(60, 60, 80, 255));
    }
}

/// <summary>Modal "update available" dialog used on the title and options screens.</summary>
public static class UpdateDialog
{
    public static bool Visible { get; private set; }
    public static bool AutoShow { get; set; }
    private static int _sel;
    private static float _restartTimer;

    public static void Show() { Visible = true; _sel = 0; }

    private static Rectangle Btn(int i) => new(Ui.Width / 2f - 290 + i * 300, 420, 280, 62);

    /// <summary>Returns true if the dialog is open and consumed input.</summary>
    public static bool Update(float dt)
    {
        if (AutoShow && Updater.State == UpdateState.Available && SaveData.Current.SkippedVersion != Updater.LatestVersion)
        {
            AutoShow = false;
            Show();
        }
        if (AutoShow && Updater.State is UpdateState.UpToDate or UpdateState.Failed) AutoShow = false;
        if (!Visible) return false;

        switch (Updater.State)
        {
            case UpdateState.Available:
                if (Input.MenuLeft || Input.MenuRight) { _sel = 1 - _sel; Audio.Play(Sfx.MenuMove); }
                for (int i = 0; i < 2; i++)
                    if (Ui.Hover(Btn(i)))
                    {
                        if (Input.MouseMoved) _sel = i;
                        if (Input.Click) { _sel = i; Activate(); return true; }
                    }
                if (Input.Confirm) Activate();
                else if (Input.Back) { Visible = false; SaveData.Current.SkippedVersion = Updater.LatestVersion; SaveData.Save(); }
                break;
            case UpdateState.Restarting:
                _restartTimer += dt;
                if (_restartTimer > 1.2f)
                {
                    Updater.Restart();
                    SceneManager.QuitRequested = true;
                }
                break;
            case UpdateState.Failed:
            case UpdateState.UpToDate:
                if (Input.Confirm || Input.Back || Input.Click) Visible = false;
                break;
        }
        return true;
    }

    private static void Activate()
    {
        Audio.Play(Sfx.MenuSelect);
        if (_sel == 1)
        {
            Visible = false;
            SaveData.Current.SkippedVersion = Updater.LatestVersion;
            SaveData.Save();
            return;
        }
        if (Updater.CanInstall) Updater.InstallAsync();
        else
        {
            Raylib.OpenURL(GameConfig.BaseUrl);
            Visible = false;
        }
    }

    public static void Draw()
    {
        if (!Visible) return;
        Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, new Color(0, 0, 0, 150));
        var r = new Rectangle(Ui.Width / 2f - 340, 200, 680, 320);
        Ui.Panel(r);
        Ui.Text(GameConfig.Name, Ui.Width / 2f, 222, 38, Ui.Accent, Align.Center);
        switch (Updater.State)
        {
            case UpdateState.Available:
                Ui.TextBlock(Loc.F("update.available", Updater.LatestVersion ?? ""), Ui.Width / 2f, 290, 30, 600, Color.White);
                Ui.Button(Btn(0), Loc.T("update.install"), _sel == 0, 28);
                Ui.Button(Btn(1), Loc.T("update.later"), _sel == 1, 28);
                break;
            case UpdateState.Downloading:
            case UpdateState.Installing:
                Ui.Text(Loc.T("update.downloading"), Ui.Width / 2f, 300, 30, Color.White, Align.Center);
                Ui.ProgressBar(new Rectangle(Ui.Width / 2f - 260, 370, 520, 34), Updater.State == UpdateState.Installing ? 1 : Updater.Progress);
                break;
            case UpdateState.Restarting:
                Ui.Text(Loc.T("update.restart"), Ui.Width / 2f, 330, 30, Color.White, Align.Center);
                break;
            case UpdateState.Failed:
                Ui.TextBlock(Loc.T("update.failed"), Ui.Width / 2f, 310, 28, 600, Color.White);
                break;
            case UpdateState.UpToDate:
                Ui.TextBlock(Loc.T("update.none"), Ui.Width / 2f, 310, 28, 600, Color.White);
                break;
            default:
                Ui.Text(Loc.T("update.checking"), Ui.Width / 2f, 330, 30, Color.White, Align.Center);
                break;
        }
    }
}
