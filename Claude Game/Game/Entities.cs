using System.Numerics;
using Raylib_cs;

namespace Platformer.Game;

/// <summary>
/// Physics tuning. The web version (web/js/stage.js) and the server replay check
/// (server/src/Replay/Sim.php) use the same numbers and the same order of operations:
/// everything that influences gameplay is computed in double precision so all three
/// implementations produce bit-identical results for the same inputs.
/// </summary>
public static class Phys
{
    public const double Tile = 48;
    public const double Walk = 250, Run = 400;
    public const double AccelGround = 2000, AccelAir = 1300, Friction = 2200;
    public const double JumpV = 780, JumpVRun = 860, DoubleJumpV = 720;
    public const double GravityUp = 1800, Gravity = 2800, MaxFall = 1000;
    public const double Coyote = 0.1, JumpBuffer = 0.12;
    public const double StompBounce = 460, StompBounceHeld = 740;
    public const double SpringV = 1250, SpringVHeld = 1420;
    public const double PlayerW = 28, PlayerH = 40;
    public const double View = 1280; // camera width, decides when enemies wake up

    /// <summary>Simulation rate: every tick advances the game by exactly 1/120 s.</summary>
    public const int TicksPerSecond = 120;
    public const double Step = 1.0 / TicksPerSecond;
}

/// <summary>Deterministic math: same result in C#, JavaScript and PHP (plain IEEE double operations only).</summary>
public static class DetMath
{
    private const double Pi = 3.141592653589793, HalfPi = 1.5707963267948966, Tau = 6.283185307179586;

    public static double Sin(double x)
    {
        double k = Math.Floor(x / Tau + 0.5);
        double r = x - k * Tau;
        if (r > HalfPi) r = Pi - r;
        else if (r < -HalfPi) r = -Pi - r;
        double r2 = r * r;
        return r * (1 + r2 * (-0.16666666666666666 + r2 * (0.008333333333333333 + r2 * (-0.0001984126984126984
            + r2 * (2.7557319223985893e-6 + r2 * (-2.505210838544172e-8 + r2 * 1.6059043836821613e-10))))));
    }

    public static double Approach(double v, double target, double step) =>
        v < target ? Math.Min(v + step, target) : Math.Max(v - step, target);

    public static int Floor(double v) => (int)Math.Floor(v);
}

/// <summary>Double-precision 2D vector for the simulation (converted to float only for drawing).</summary>
public struct Vec(double x, double y)
{
    public double X = x, Y = y;
    public static Vec operator +(Vec a, Vec b) => new(a.X + b.X, a.Y + b.Y);
    public static Vec operator -(Vec a, Vec b) => new(a.X - b.X, a.Y - b.Y);
    public static implicit operator Vector2(Vec v) => new((float)v.X, (float)v.Y);
}

/// <summary>Axis-aligned box; overlap test is strict like raylib's CheckCollisionRecs.</summary>
public readonly record struct Box(double X, double Y, double W, double H)
{
    public bool Overlaps(Box o) => X < o.X + o.W && X + W > o.X && Y < o.Y + o.H && Y + H > o.Y;
}

/// <summary>The player's input for one simulation tick. Six bits, recorded for replays.</summary>
public readonly record struct TickInput(bool Left, bool Right, bool Run, bool JumpHeld, bool JumpPressed, bool ActionPressed)
{
    public byte Bits => (byte)((Left ? 1 : 0) | (Right ? 2 : 0) | (Run ? 4 : 0) | (JumpHeld ? 8 : 0) | (JumpPressed ? 16 : 0) | (ActionPressed ? 32 : 0));

    public static TickInput FromBits(int b) =>
        new((b & 1) != 0, (b & 2) != 0, (b & 4) != 0, (b & 8) != 0, (b & 16) != 0, (b & 32) != 0);

    public static readonly TickInput None = default;
}

public sealed class Player
{
    public Vec Pos; // top-left of hitbox
    public Vec Vel;
    public int Facing = 1;
    public bool OnGround;
    public double CoyoteTimer, BufferTimer;
    public int Power;      // 0 none, 1 fish (extra hit + break bricks), 2 snowflake (also throw)
    public bool Wings, DoubleUsed;
    public double Invuln;
    public double Anim;
    public double PrevBottom;
    public MovingPlatform? Riding;
    public bool Dead;
    public double DeadTimer;
    public bool Hidden;

    public Box Rect => new(Pos.X, Pos.Y, Phys.PlayerW, Phys.PlayerH);
    public Vec Center => new(Pos.X + Phys.PlayerW / 2, Pos.Y + Phys.PlayerH / 2);
    public double Bottom => Pos.Y + Phys.PlayerH;
}

public enum EnemyKind { Walker, Spiky, Bird, Hopper }

public sealed class Enemy
{
    public EnemyKind Kind;
    public Vec Pos, Vel, Origin;
    public double W, H;
    public int Facing = -1;
    public bool Active, OnGround;
    public bool Squashed, Flipped;
    public double DeathTimer, T, HopTimer = 1;
    public bool Alive => !Squashed && !Flipped;
    public bool Stompable => Kind != EnemyKind.Spiky;
    public Box Rect => new(Pos.X, Pos.Y, W, H);
    public Vector2 BottomCenter => new((float)(Pos.X + W / 2), (float)(Pos.Y + H));

    public static Enemy Create(EnemyKind kind, int tx, int ty)
    {
        var (w, h) = kind switch
        {
            EnemyKind.Walker => (40.0, 32.0),
            EnemyKind.Spiky => (40.0, 34.0),
            EnemyKind.Bird => (40.0, 28.0),
            _ => (36.0, 30.0)
        };
        var pos = new Vec(tx * Phys.Tile + (Phys.Tile - w) / 2, ty * Phys.Tile + Phys.Tile - h);
        return new Enemy { Kind = kind, W = w, H = h, Pos = pos, Origin = pos };
    }
}

public sealed class MovingPlatform
{
    public Vec Origin, Pos, Delta;
    public int WidthTiles;
    public bool Vertical;
    public double Phase;
    public const double Height = 20;
    public const double Range = 3 * Phys.Tile;
    public const double Period = 4.5;

    public void Update(double time)
    {
        var prev = Pos;
        double s = DetMath.Sin(time * 6.283185307179586 / Period + Phase) * Range;
        Pos = Vertical ? new Vec(Origin.X, Origin.Y + s) : new Vec(Origin.X + s, Origin.Y);
        Delta = Pos - prev;
    }
}

public sealed class Icicle
{
    public Vec Pos;
    public int State; // 0 hanging, 1 shaking, 2 falling, 3 gone
    public double Timer, Vy;
    public Box Rect => new(Pos.X + 12, Pos.Y, 24, 40);
}

public enum ItemKind { Fish, Snowflake, Wing, Heart }

public sealed class Item
{
    public ItemKind Kind;
    public Vec Pos, Vel; // center
    public double Emerge = 0.5, T;
    public Box Rect => new(Pos.X - 16, Pos.Y - 16, 32, 32);
}

public sealed class Snowball
{
    public Vec Pos, Vel;
    public double Life = 2;
    public Box Rect => new(Pos.X - 10, Pos.Y - 10, 20, 20);
}

// ----- purely cosmetic (never influence gameplay, so float/random is fine) -----

public sealed class Particle
{
    public Vector2 Pos, Vel;
    public float Life, MaxLife, Size;
    public Color Color;
    public bool Gravity;
    public int Shape; // 0 circle, 1 square
}

public sealed class FloatText
{
    public Vector2 Pos;
    public string Text = "";
    public float Life = 1f;
    public Color Color = Color.White;
}

public sealed class CoinPop
{
    public Vector2 Pos;
    public float T;
}

public sealed class Checkpoint
{
    public int Tx, Ty;
    public bool Active;
}

public sealed class Sign
{
    public int Tx, Ty;
    public string Key = "";
}

/// <summary>Snapshot taken when a checkpoint is reached; used to respawn.</summary>
public sealed class CheckpointState
{
    public int Tx, Ty, Score, Coins, TimeTicks;
}
