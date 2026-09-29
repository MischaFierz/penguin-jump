using System.Numerics;
using Platformer.Core;
using Platformer.Scenes;
using Raylib_cs;

namespace Platformer;

public static class Program
{
    private static RenderTexture2D _target;

    public static void Main(string[] args)
    {
        GameConfig.Load();

        // headless test tool: "--simtest <level.txt> <inputs.txt>" plays raw tick inputs (one number per line)
        // and prints the gameplay state after every tick; compared against the JS and PHP versions in CI.
        if (args.Length == 3 && args[0] == "--simtest")
        {
            SimTest(args[1], args[2]);
            return;
        }
        // test tool: "--verify-manifest <version.json> <version.json.sig>" -> prints VALID / INVALID
        if (args.Length == 3 && args[0] == "--verify-manifest")
        {
            bool ok = Updater.VerifySignature(File.ReadAllBytes(args[1]), File.ReadAllText(args[2]).Trim());
            using var o = new StreamWriter(Console.OpenStandardOutput());
            o.WriteLine(ok ? "VALID" : "INVALID");
            return;
        }

        // unknown tool option: never fall through to opening a game window
        if (args.Length > 0 && args[0].StartsWith("--") && args[0] != "--screenshot") return;

        Updater.CleanupOldFiles();
        SaveData.Load();

        // optional: "--screenshot <file> [scene]" renders a few frames in a hidden, silent window and saves a PNG (used for testing)
        string? shot = args.Length >= 2 && args[0] == "--screenshot" ? args[1] : null;

        var flags = ConfigFlags.ResizableWindow | ConfigFlags.VSyncHint | ConfigFlags.Msaa4xHint;
        if (shot != null) flags = ConfigFlags.HiddenWindow | ConfigFlags.UnfocusedWindow | ConfigFlags.Msaa4xHint;
        Raylib.SetConfigFlags(flags);
        Raylib.SetTraceLogLevel(TraceLogLevel.Warning);
        Raylib.InitWindow(Ui.Width, Ui.Height, GameConfig.Name);
        Raylib.SetWindowMinSize(640, 360);
        Raylib.SetExitKey(KeyboardKey.Null);
        Raylib.SetTargetFPS(Math.Max(60, Raylib.GetMonitorRefreshRate(Raylib.GetCurrentMonitor())));

        _target = Raylib.LoadRenderTexture(Ui.Width, Ui.Height);
        Raylib.SetTextureFilter(_target.Texture, TextureFilter.Bilinear);

        Loc.Init(SaveData.Current.Language);
        if (shot == null) Audio.Init(); // test runs stay silent
        Audio.SfxVolume = SaveData.Current.SfxVolume;
        Audio.MusicVolume = SaveData.Current.MusicVolume;
        if (SaveData.Current.Fullscreen && shot == null) ApplyFullscreen(true);

        SceneManager.Start(args.Length >= 3 && shot != null ? DebugScene(args[2]) : new TitleScene());
        int frames = 0;

        while (!Raylib.WindowShouldClose() && !SceneManager.QuitRequested)
        {
            float dt = MathF.Min(Raylib.GetFrameTime(), 1f / 20f);
            Input.Mouse = ToVirtual(Raylib.GetMousePosition());
            Input.Update(dt);
            if (Raylib.IsKeyPressed(KeyboardKey.F11) || (Raylib.IsKeyDown(KeyboardKey.LeftAlt) && Raylib.IsKeyPressed(KeyboardKey.Enter)))
            {
                SaveData.Current.Fullscreen = !SaveData.Current.Fullscreen;
                ApplyFullscreen(SaveData.Current.Fullscreen);
                SaveData.Save();
            }

            SceneManager.Update(shot != null ? 1f / 60f : dt);
            Audio.Update();

            Raylib.BeginTextureMode(_target);
            Raylib.ClearBackground(Color.Black);
            SceneManager.Draw();
            Raylib.EndTextureMode();

            Raylib.BeginDrawing();
            Raylib.ClearBackground(Color.Black);
            var (scale, offset) = Letterbox();
            Raylib.DrawTexturePro(_target.Texture, new Rectangle(0, 0, Ui.Width, -Ui.Height),
                new Rectangle(offset.X, offset.Y, Ui.Width * scale, Ui.Height * scale), Vector2.Zero, 0, Color.White);
            Raylib.EndDrawing();

            if (shot != null && ++frames == 150)
            {
                var img = Raylib.LoadImageFromTexture(_target.Texture);
                Raylib.ImageFlipVertical(ref img);
                Raylib.ExportImage(img, shot);
                Raylib.UnloadImage(img);
                break;
            }
        }

        SaveData.Save();
        Loc.Unload();
        Audio.Shutdown();
        Raylib.UnloadRenderTexture(_target);
        Raylib.CloseWindow();
    }

    private static void SimTest(string levelFile, string inputFile)
    {
        var level = Game.LevelData.Parse(File.ReadAllText(levelFile), Path.GetFileName(levelFile));
        var replay = new Game.Replay();
        foreach (var line in File.ReadAllLines(inputFile))
            if (int.TryParse(line, out var b)) replay.Add(Game.TickInput.FromBits(b));
        using var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = false, NewLine = "\n" };
        var result = Game.ReplayRunner.Run(level, replay, st => stdout.WriteLine(st.StateHash()));
        stdout.WriteLine($"RESULT {(result.Completed ? 1 : 0)} {result.Ticks} {result.TimeTicks} {result.FinalScore} {result.Coins}");
        stdout.WriteLine($"ENCODED {replay.Encode()}");
    }

    private static IScene DebugScene(string name)
    {
        Session.Levels = Game.LevelData.Index();
        if (name.StartsWith("level:"))
        {
            int idx = Session.Levels.FindIndex(l => l.Contains(name[6..].Replace('-', '_')));
            return new PlayScene(Math.Max(0, idx));
        }
        if (name.StartsWith("lang:"))
        {
            Loc.Set(Loc.All.First(l => l.Code == name[5..]));
            return new TitleScene();
        }
        if (name.StartsWith("board:")) return new LeaderboardScene(name[6..], () => new LevelSelectScene());
        if (name == "submit")
            return new SubmitScene(new SubmitScene.Run("1-1", "0123456789abcdef0123456789abcdef", "AgE", 3000, 4200, 12), () => new TitleScene());
        return name switch
        {
            "account" => new AccountScene(),
            "language" => new LanguageScene(),
            "options" => new OptionsScene(),
            "levels" => new LevelSelectScene(),
            _ => new TitleScene()
        };
    }

    private static (float scale, Vector2 offset) Letterbox()
    {
        float sw = Raylib.GetRenderWidth(), sh = Raylib.GetRenderHeight();
        float scale = MathF.Min(sw / Ui.Width, sh / Ui.Height);
        return (scale, new Vector2((sw - Ui.Width * scale) / 2, (sh - Ui.Height * scale) / 2));
    }

    private static Vector2 ToVirtual(Vector2 mouse)
    {
        var (scale, offset) = Letterbox();
        // mouse coordinates are in screen units; on HiDPI the render size may differ
        float dpi = Raylib.GetRenderWidth() / (float)Math.Max(1, Raylib.GetScreenWidth());
        return (mouse * dpi - offset) / scale;
    }

    public static void ApplyFullscreen(bool on)
    {
        bool isOn = Raylib.IsWindowState(ConfigFlags.BorderlessWindowMode);
        if (on != isOn) Raylib.ToggleBorderlessWindowed();
    }
}
