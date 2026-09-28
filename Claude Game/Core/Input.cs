using System.Numerics;
using Raylib_cs;

namespace Platformer.Core;

/// <summary>Unified keyboard + gamepad + mouse input.</summary>
public static class Input
{
    private const float StickDeadzone = 0.45f;
    private static bool _stickLeft, _stickRight, _stickUp, _stickDown;
    private static bool _prevStickLeft, _prevStickRight, _prevStickUp, _prevStickDown;
    private static float _repeatTimer;
    private static int _repeatDir; // for held menu navigation

    public static Vector2 Mouse { get; set; }
    public static bool MouseMoved { get; private set; }
    private static Vector2 _lastMouse;

    private static bool Pad => Raylib.IsGamepadAvailable(0);

    public static void Update(float dt)
    {
        _prevStickLeft = _stickLeft; _prevStickRight = _stickRight; _prevStickUp = _stickUp; _prevStickDown = _stickDown;
        if (Pad)
        {
            float x = Raylib.GetGamepadAxisMovement(0, GamepadAxis.LeftX);
            float y = Raylib.GetGamepadAxisMovement(0, GamepadAxis.LeftY);
            _stickLeft = x < -StickDeadzone; _stickRight = x > StickDeadzone;
            _stickUp = y < -StickDeadzone; _stickDown = y > StickDeadzone;
        }
        else _stickLeft = _stickRight = _stickUp = _stickDown = false;

        MouseMoved = Vector2.DistanceSquared(Mouse, _lastMouse) > 1f;
        _lastMouse = Mouse;

        // key repeat for menus
        int dir = RawUp ? 1 : RawDown ? 2 : RawLeft ? 3 : RawRight ? 4 : 0;
        if (dir != _repeatDir) { _repeatDir = dir; _repeatTimer = 0.4f; Repeated = false; }
        else if (dir != 0)
        {
            _repeatTimer -= dt;
            Repeated = _repeatTimer <= 0;
            if (Repeated) _repeatTimer = 0.12f;
        }
        else Repeated = false;
    }

    private static bool Repeated;

    private static bool Key(params KeyboardKey[] keys) => keys.Any(k => (bool)Raylib.IsKeyDown(k));
    private static bool KeyPressed(params KeyboardKey[] keys) => keys.Any(k => (bool)Raylib.IsKeyPressed(k));
    private static bool Btn(params GamepadButton[] b) => Pad && b.Any(x => Raylib.IsGamepadButtonDown(0, x));
    private static bool BtnPressed(params GamepadButton[] b) => Pad && b.Any(x => Raylib.IsGamepadButtonPressed(0, x));

    // ----- gameplay -----
    public static bool Left => Key(KeyboardKey.Left, KeyboardKey.A) || Btn(GamepadButton.LeftFaceLeft) || _stickLeft;
    public static bool Right => Key(KeyboardKey.Right, KeyboardKey.D) || Btn(GamepadButton.LeftFaceRight) || _stickRight;
    public static bool Down => Key(KeyboardKey.Down, KeyboardKey.S) || Btn(GamepadButton.LeftFaceDown) || _stickDown;

    public static bool JumpPressed => KeyPressed(KeyboardKey.Space, KeyboardKey.Up, KeyboardKey.W, KeyboardKey.K)
                                      || BtnPressed(GamepadButton.RightFaceDown);

    public static bool JumpHeld => Key(KeyboardKey.Space, KeyboardKey.Up, KeyboardKey.W, KeyboardKey.K)
                                   || Btn(GamepadButton.RightFaceDown);

    public static bool RunHeld => Key(KeyboardKey.LeftShift, KeyboardKey.RightShift, KeyboardKey.X, KeyboardKey.J)
                                  || Btn(GamepadButton.RightFaceLeft, GamepadButton.RightFaceRight, GamepadButton.RightTrigger2);

    public static bool ActionPressed => KeyPressed(KeyboardKey.LeftShift, KeyboardKey.RightShift, KeyboardKey.X, KeyboardKey.J)
                                        || BtnPressed(GamepadButton.RightFaceLeft, GamepadButton.RightFaceRight);

    public static bool PausePressed => KeyPressed(KeyboardKey.Escape, KeyboardKey.P, KeyboardKey.Enter)
                                       || BtnPressed(GamepadButton.MiddleRight);

    // ----- menus -----
    private static bool RawUp => Key(KeyboardKey.Up, KeyboardKey.W) || Btn(GamepadButton.LeftFaceUp) || _stickUp;
    private static bool RawDown => Key(KeyboardKey.Down, KeyboardKey.S) || Btn(GamepadButton.LeftFaceDown) || _stickDown;
    private static bool RawLeft => Key(KeyboardKey.Left, KeyboardKey.A) || Btn(GamepadButton.LeftFaceLeft) || _stickLeft;
    private static bool RawRight => Key(KeyboardKey.Right, KeyboardKey.D) || Btn(GamepadButton.LeftFaceRight) || _stickRight;

    public static bool MenuUp => KeyPressed(KeyboardKey.Up, KeyboardKey.W) || BtnPressed(GamepadButton.LeftFaceUp) || (_stickUp && !_prevStickUp) || (Repeated && _repeatDir == 1);
    public static bool MenuDown => KeyPressed(KeyboardKey.Down, KeyboardKey.S) || BtnPressed(GamepadButton.LeftFaceDown) || (_stickDown && !_prevStickDown) || (Repeated && _repeatDir == 2);
    public static bool MenuLeft => KeyPressed(KeyboardKey.Left, KeyboardKey.A) || BtnPressed(GamepadButton.LeftFaceLeft) || (_stickLeft && !_prevStickLeft) || (Repeated && _repeatDir == 3);
    public static bool MenuRight => KeyPressed(KeyboardKey.Right, KeyboardKey.D) || BtnPressed(GamepadButton.LeftFaceRight) || (_stickRight && !_prevStickRight) || (Repeated && _repeatDir == 4);

    public static bool Confirm => KeyPressed(KeyboardKey.Enter, KeyboardKey.Space, KeyboardKey.KpEnter)
                                  || BtnPressed(GamepadButton.RightFaceDown, GamepadButton.MiddleRight);

    public static bool Back => KeyPressed(KeyboardKey.Escape, KeyboardKey.Backspace) || BtnPressed(GamepadButton.RightFaceRight);

    public static bool Click => Raylib.IsMouseButtonPressed(MouseButton.Left);
}
