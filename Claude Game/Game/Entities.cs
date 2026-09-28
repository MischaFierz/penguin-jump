using System.Numerics;
using Raylib_cs;

namespace Platformer.Game;

/// <summary>Physics tuning. The web version (web/js/game.js) uses the same numbers.</summary>
public static class Phys
{
    public const float Tile = 48;
    public const float Walk = 250, Run = 400;
    public const float AccelGround = 2000, AccelAir = 1300, Friction = 2200;
    public const float JumpV = 780, JumpVRun = 860, DoubleJumpV = 720;
    public const float GravityUp = 1800, Gravity = 2800, MaxFall = 1000;
    public const float Coyote = 0.1f, JumpBuffer = 0.12f;
    public const float StompBounce = 460, StompBounceHeld = 740;
    public const float SpringV = 1250, SpringVHeld = 1420;
    public const float PlayerW = 28, PlayerH = 40;
}

public sealed class Player
{
    public Vector2 Pos; // top-left of hitbox
    public Vector2 Vel;
    public int Facing = 1;
    public bool OnGround;
    public float CoyoteTimer, BufferTimer;
    public int Power;      // 0 none, 1 fish (extra hit + break bricks), 2 snowflake (also throw)
    public bool Wings, DoubleUsed;
    public float Invuln;
    public float Anim;
    public float PrevBottom;
    public MovingPlatform? Riding;
    public bool Dead;
    public float DeadTimer;
    public bool Hidden;

    public Rectangle Rect => new(Pos.X, Pos.Y, Phys.PlayerW, Phys.PlayerH);
    public Vector2 Center => Pos + new Vector2(Phys.PlayerW / 2, Phys.PlayerH / 2);
    public float Bottom => Pos.Y + Phys.PlayerH;
}

public enum EnemyKind { Walker, Spiky, Bird, Hopper }

public sealed class Enemy
{
    public EnemyKind Kind;
    public Vector2 Pos, Vel, Origin;
    public float W, H;
    public int Facing = -1;
    public bool Active, OnGround;
    public bool Squashed, Flipped;
    public float DeathTimer, T, HopTimer = 1f;
    public bool Alive => !Squashed && !Flipped;
    public bool Stompable => Kind != EnemyKind.Spiky;
    public Rectangle Rect => new(Pos.X, Pos.Y, W, H);
    public Vector2 BottomCenter => new(Pos.X + W / 2, Pos.Y + H);

    public static Enemy Create(EnemyKind kind, float tx, float ty)
    {
        var (w, h) = kind switch
        {
            EnemyKind.Walker => (40f, 32f),
            EnemyKind.Spiky => (40f, 34f),
            EnemyKind.Bird => (40f, 28f),
            _ => (36f, 30f)
        };
        var pos = new Vector2(tx * Phys.Tile + (Phys.Tile - w) / 2, ty * Phys.Tile + Phys.Tile - h);
        return new Enemy { Kind = kind, W = w, H = h, Pos = pos, Origin = pos };
    }
}

public sealed class MovingPlatform
{
    public Vector2 Origin, Pos, Delta;
    public int WidthTiles;
    public bool Vertical;
    public float Phase;
    public const float Height = 20;
    public const float Range = 3 * Phys.Tile;
    public const float Period = 4.5f;
    public Rectangle Rect => new(Pos.X, Pos.Y, WidthTiles * Phys.Tile, Height);

    public void Update(float time)
    {
        var prev = Pos;
        float s = MathF.Sin(time * MathF.Tau / Period + Phase) * Range;
        Pos = Vertical ? Origin + new Vector2(0, s) : Origin + new Vector2(s, 0);
        Delta = Pos - prev;
    }
}

public sealed class Icicle
{
    public Vector2 Pos;
    public int State; // 0 hanging, 1 shaking, 2 falling, 3 gone
    public float Timer, Vy;
    public Rectangle Rect => new(Pos.X + 12, Pos.Y, 24, 40);
}

public enum ItemKind { Fish, Snowflake, Wing, Heart }

public sealed class Item
{
    public ItemKind Kind;
    public Vector2 Pos, Vel; // center
    public float Emerge = 0.5f, T;
    public Rectangle Rect => new(Pos.X - 16, Pos.Y - 16, 32, 32);
}

public sealed class Snowball
{
    public Vector2 Pos, Vel;
    public float Life = 2f;
}

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
    public int Tx, Ty, Score, Coins;
    public float Time;
}
