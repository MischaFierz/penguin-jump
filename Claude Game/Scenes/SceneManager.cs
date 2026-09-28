using Platformer.Core;
using Platformer.Game;
using Raylib_cs;

namespace Platformer.Scenes;

public interface IScene
{
    void Update(float dt);
    void Draw();
}

public static class SceneManager
{
    public static IScene Current { get; private set; } = null!;
    private static IScene? _next;
    private static float _fade; // 0 = visible, 1 = black
    private static bool _fadingOut;
    public static bool QuitRequested { get; set; }

    public static void Start(IScene scene) => Current = scene;

    public static void Go(IScene scene)
    {
        if (_next != null) return;
        _next = scene;
        _fadingOut = true;
    }

    public static void Update(float dt)
    {
        if (_fadingOut)
        {
            _fade += dt * 5;
            if (_fade >= 1)
            {
                _fade = 1;
                Current = _next!;
                _next = null;
                _fadingOut = false;
            }
            return;
        }
        if (_fade > 0) _fade = MathF.Max(0, _fade - dt * 4);
        Current.Update(dt);
    }

    public static void Draw()
    {
        Current.Draw();
        if (_fade > 0) Raylib.DrawRectangle(0, 0, Ui.Width, Ui.Height, Art.Fade(new Color(8, 12, 28, 255), _fade));
    }
}

/// <summary>Game session: lives carry over between consecutive levels.</summary>
public static class Session
{
    public const int StartLives = 3;
    public static int Lives = StartLives;
    public static List<string> Levels = new();
}
