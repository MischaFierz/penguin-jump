using System.Numerics;
using Platformer.Core;
using Raylib_cs;

namespace Platformer.Game;

/// <summary>Runtime state and simulation of one level.</summary>
public sealed class Stage
{
    private const float T = Phys.Tile;

    public readonly LevelData Data;
    public readonly Theme Theme;
    private readonly char[,] _tiles;
    public int W => _tiles.GetLength(0);
    public int H => _tiles.GetLength(1);

    public readonly Player Player = new();
    public readonly List<Enemy> Enemies = new();
    public readonly List<MovingPlatform> Platforms = new();
    public readonly List<Icicle> Icicles = new();
    public readonly List<Item> Items = new();
    public readonly List<Snowball> Snowballs = new();
    public readonly List<Particle> Particles = new();
    public readonly List<FloatText> Texts = new();
    public readonly List<CoinPop> CoinPops = new();
    public readonly List<Checkpoint> Checkpoints = new();
    public readonly List<Sign> Signs = new();
    private readonly Dictionary<(int, int), float> _bumps = new();
    private readonly Dictionary<(int, int), float> _crumbleTimer = new();
    private readonly Dictionary<(int, int), float> _crumbleFallen = new();
    private readonly Dictionary<(int, int), float> _springAnim = new();
    public (int x, int y) Goal;

    public float Time;       // level timer (seconds)
    public float Clock;      // animation clock
    public int Score, Coins, TotalCoins;
    public float CamX;
    public float Shake;
    public int StompCombo;

    /// <summary>Button presses latched by the scene each frame and consumed by the next physics sub-step.</summary>
    public bool PendingJump, PendingAction;

    public bool Completed;
    public float CompleteTimer;
    public string? Message;
    public float MessageTimer;
    public CheckpointState? LastCheckpoint;

    public event Action? PlayerDied;
    public event Action? LevelCompleted;
    public event Action? ExtraLife;

    public Stage(LevelData data, CheckpointState? cp)
    {
        Data = data;
        Theme = Art.ThemeFor(data.World);
        _tiles = (char[,])data.Tiles.Clone();
        int signIndex = 0;
        var signPositions = new List<(int, int)>();

        for (int x = 0; x < W; x++)
        for (int y = 0; y < H; y++)
        {
            char c = _tiles[x, y];
            switch (c)
            {
                case '@':
                    Player.Pos = new Vector2(x * T + (T - Phys.PlayerW) / 2, y * T + T - Phys.PlayerH);
                    _tiles[x, y] = ' ';
                    break;
                case 'e': Enemies.Add(Enemy.Create(EnemyKind.Walker, x, y)); _tiles[x, y] = ' '; break;
                case 's': Enemies.Add(Enemy.Create(EnemyKind.Spiky, x, y)); _tiles[x, y] = ' '; break;
                case 'b': Enemies.Add(Enemy.Create(EnemyKind.Bird, x, y)); _tiles[x, y] = ' '; break;
                case 'h': Enemies.Add(Enemy.Create(EnemyKind.Hopper, x, y)); _tiles[x, y] = ' '; break;
                case 'i': Icicles.Add(new Icicle { Pos = new Vector2(x * T, y * T) }); _tiles[x, y] = ' '; break;
                case 'C': Checkpoints.Add(new Checkpoint { Tx = x, Ty = y }); _tiles[x, y] = ' '; break;
                case 'G': Goal = (x, y); _tiles[x, y] = ' '; break;
                case '!': signPositions.Add((x, y)); _tiles[x, y] = ' '; break;
                case 'M':
                case 'V':
                    if (x > 0 && data.Tiles[x - 1, y] == c) { _tiles[x, y] = ' '; break; }
                    int len = 1;
                    while (x + len < W && data.Tiles[x + len, y] == c) len++;
                    var o = new Vector2(x * T, y * T + T - MovingPlatform.Height - 8);
                    Platforms.Add(new MovingPlatform { Origin = o, Pos = o, WidthTiles = len, Vertical = c == 'V', Phase = x * 0.37f });
                    _tiles[x, y] = ' ';
                    break;
                case 'o':
                case '?':
                    TotalCoins++;
                    break;
            }
        }

        foreach (var (sx, sy) in signPositions.OrderBy(p => p.Item1).ThenBy(p => p.Item2))
            Signs.Add(new Sign { Tx = sx, Ty = sy, Key = signIndex < data.Signs.Length ? data.Signs[signIndex++] : "" });

        if (cp != null)
        {
            LastCheckpoint = cp;
            Player.Pos = new Vector2(cp.Tx * T + (T - Phys.PlayerW) / 2, cp.Ty * T + T - Phys.PlayerH);
            Score = cp.Score; Coins = cp.Coins; Time = cp.Time;
            foreach (var c in Checkpoints) if (c.Tx <= cp.Tx) c.Active = true;
        }

        Player.PrevBottom = Player.Bottom;
        CamX = Math.Clamp(Player.Center.X - Ui.Width * 0.4f, 0, MathF.Max(0, W * T - Ui.Width));
    }

    // ------------------------------------------------------------------ tiles
    public char At(int x, int y) => x < 0 || x >= W ? '#' : y < 0 || y >= H ? ' ' : _tiles[x, y];

    private static bool IsSolidChar(char c) => c is '#' or 'B' or '?' or 'F' or 'S' or 'W' or 'H' or 'E' or 'x';

    public bool Solid(int x, int y)
    {
        char c = At(x, y);
        if (c == 'x' && _crumbleFallen.ContainsKey((x, y))) return false;
        return IsSolidChar(c);
    }

    private bool OneWay(int x, int y) => At(x, y) is '-' or '*';
    private static float OneWayTop(char c) => c == '*' ? 16 : 0;

    // ------------------------------------------------------------------ update
    public void Update(float dt, bool controls)
    {
        Clock += dt;
        if (!Completed && !Player.Dead) Time += dt;
        if (MessageTimer > 0) MessageTimer -= dt;
        if (Shake > 0) Shake -= dt;

        foreach (var p in Platforms) p.Update(Clock);

        if (Player.Dead) UpdateDeadPlayer(dt);
        else if (Completed) UpdateCompletion(dt);
        else UpdatePlayer(dt, controls);

        UpdateCrumbles(dt);
        UpdateEnemies(dt);
        UpdateIcicles(dt);
        UpdateItems(dt);
        UpdateSnowballs(dt);
        UpdateEffects(dt);
        UpdateCamera(dt);
    }

    private void UpdatePlayer(float dt, bool controls)
    {
        var p = Player;
        p.Anim += dt;
        if (p.Invuln > 0) p.Invuln -= dt;

        if (p.Riding != null)
        {
            p.Pos += p.Riding.Delta;
            p.Riding = null;
        }

        bool left = controls && Input.Left, right = controls && Input.Right;
        bool run = controls && Input.RunHeld;
        bool jumpHeld = controls && Input.JumpHeld;
        bool jumpPressed = controls && PendingJump;
        bool actionPressed = controls && PendingAction;
        PendingJump = PendingAction = false;
        if (jumpPressed) p.BufferTimer = Phys.JumpBuffer; else p.BufferTimer -= dt;
        if (p.OnGround) { p.CoyoteTimer = Phys.Coyote; p.DoubleUsed = false; } else p.CoyoteTimer -= dt;

        // horizontal movement
        float target = (right ? 1 : 0) - (left ? 1 : 0);
        float maxSpeed = run ? Phys.Run : Phys.Walk;
        if (target != 0)
        {
            p.Facing = target > 0 ? 1 : -1;
            float accel = p.OnGround ? Phys.AccelGround : Phys.AccelAir;
            if (MathF.Sign(p.Vel.X) != MathF.Sign(target) && p.OnGround) accel *= 1.6f; // quick turn
            p.Vel.X = Approach(p.Vel.X, target * maxSpeed, accel * dt);
        }
        else if (p.OnGround) p.Vel.X = Approach(p.Vel.X, 0, Phys.Friction * dt);
        else p.Vel.X = Approach(p.Vel.X, 0, Phys.Friction * 0.25f * dt);

        // jumping
        if (p.BufferTimer > 0 && p.CoyoteTimer > 0)
        {
            float runFactor = Math.Clamp((MathF.Abs(p.Vel.X) - Phys.Walk) / (Phys.Run - Phys.Walk), 0, 1);
            p.Vel.Y = -(Phys.JumpV + (Phys.JumpVRun - Phys.JumpV) * runFactor);
            p.OnGround = false;
            p.BufferTimer = 0; p.CoyoteTimer = 0;
            Audio.Play(Sfx.Jump);
            Dust(p.Pos + new Vector2(Phys.PlayerW / 2, Phys.PlayerH), 5);
        }
        else if (p.BufferTimer > 0 && !p.OnGround && p.Wings && !p.DoubleUsed)
        {
            p.Vel.Y = -Phys.DoubleJumpV;
            p.DoubleUsed = true;
            p.BufferTimer = 0;
            Audio.Play(Sfx.DoubleJump);
            for (int i = 0; i < 8; i++)
                Spawn(p.Center + new Vector2(0, 16), new Vector2(Rand(-120, 120), Rand(40, 140)), 0.5f, 4, new Color(255, 255, 255, 230), false);
        }

        // throw snowballs
        if (actionPressed && p.Power == 2 && Snowballs.Count < 2)
        {
            Snowballs.Add(new Snowball { Pos = p.Center + new Vector2(p.Facing * 16, -4), Vel = new Vector2(p.Facing * 560 + p.Vel.X * 0.3f, 120) });
            Audio.Play(Sfx.Throw);
        }

        float g = p.Vel.Y < 0 && jumpHeld ? Phys.GravityUp : Phys.Gravity;
        p.Vel.Y = MathF.Min(p.Vel.Y + g * dt, Phys.MaxFall);

        p.PrevBottom = p.Bottom;
        MovePlayerX(dt);
        MovePlayerY(dt, jumpHeld);

        // fell out of the level
        if (p.Pos.Y > H * T + 60) KillPlayer();

        CheckHazards();
        CheckPickups();
        CheckCheckpoints();
        CheckGoal();
    }

    private void MovePlayerX(float dt)
    {
        var p = Player;
        p.Pos.X += p.Vel.X * dt;
        if (p.Pos.X < 0) { p.Pos.X = 0; p.Vel.X = 0; }
        if (p.Pos.X > W * T - Phys.PlayerW) { p.Pos.X = W * T - Phys.PlayerW; p.Vel.X = 0; }
        int y0 = (int)MathF.Floor(p.Pos.Y / T), y1 = (int)MathF.Floor((p.Pos.Y + Phys.PlayerH - 0.01f) / T);
        if (p.Vel.X > 0)
        {
            int x = (int)MathF.Floor((p.Pos.X + Phys.PlayerW) / T);
            for (int y = y0; y <= y1; y++)
                if (Solid(x, y)) { p.Pos.X = x * T - Phys.PlayerW; p.Vel.X = 0; break; }
        }
        else if (p.Vel.X < 0)
        {
            int x = (int)MathF.Floor(p.Pos.X / T);
            for (int y = y0; y <= y1; y++)
                if (Solid(x, y)) { p.Pos.X = (x + 1) * T; p.Vel.X = 0; break; }
        }
    }

    private void MovePlayerY(float dt, bool jumpHeld)
    {
        var p = Player;
        p.Pos.Y += p.Vel.Y * dt;
        p.OnGround = false;
        int x0 = (int)MathF.Floor((p.Pos.X + 1) / T), x1 = (int)MathF.Floor((p.Pos.X + Phys.PlayerW - 1) / T);

        if (p.Vel.Y >= 0)
        {
            int y = (int)MathF.Floor(p.Bottom / T);
            float best = float.MaxValue;
            int springX = -1;
            int crumbleX = -1;
            for (int x = x0; x <= x1; x++)
            {
                if (Solid(x, y))
                {
                    best = MathF.Min(best, y * T);
                    if (At(x, y) == 'x') crumbleX = x;
                }
                else if (OneWay(x, y))
                {
                    float top = y * T + OneWayTop(At(x, y));
                    if (p.PrevBottom <= top + 0.5f && p.Bottom >= top)
                    {
                        best = MathF.Min(best, top);
                        if (At(x, y) == '*') springX = x;
                    }
                }
            }

            foreach (var mp in Platforms)
            {
                var r = mp.Rect;
                if (p.Pos.X + Phys.PlayerW > r.X + 2 && p.Pos.X < r.X + r.Width - 2)
                {
                    float top = r.Y;
                    if (p.PrevBottom <= top + MathF.Abs(mp.Delta.Y) + 1f && p.Bottom >= top && top < best)
                    {
                        best = top;
                        p.Riding = mp;
                    }
                }
            }

            if (best < float.MaxValue)
            {
                p.Pos.Y = best - Phys.PlayerH;
                if (springX >= 0)
                {
                    p.Vel.Y = -(jumpHeld ? Phys.SpringVHeld : Phys.SpringV);
                    _springAnim[(springX, y)] = 0.3f;
                    Audio.Play(Sfx.Spring);
                    p.Riding = null;
                    return;
                }
                if (p.Vel.Y > 600) Dust(p.Pos + new Vector2(Phys.PlayerW / 2, Phys.PlayerH), 4);
                p.Vel.Y = 0;
                p.OnGround = true;
                StompCombo = 0;
                if (crumbleX >= 0 && !_crumbleTimer.ContainsKey((crumbleX, y)))
                    _crumbleTimer[(crumbleX, y)] = 0.45f;
                // mark all crumbles under the feet
                for (int x = x0; x <= x1; x++)
                    if (At(x, y) == 'x' && !_crumbleTimer.ContainsKey((x, y)) && !_crumbleFallen.ContainsKey((x, y)))
                        _crumbleTimer[(x, y)] = 0.45f;
            }
            else p.Riding = null;
        }
        else
        {
            int y = (int)MathF.Floor(p.Pos.Y / T);
            int hitX = -1;
            float bestOverlap = 0;
            for (int x = x0; x <= x1; x++)
            {
                if (!Solid(x, y)) continue;
                float overlap = MathF.Min(p.Pos.X + Phys.PlayerW, (x + 1) * T) - MathF.Max(p.Pos.X, x * T);
                if (overlap > bestOverlap) { bestOverlap = overlap; hitX = x; }
            }
            if (hitX >= 0)
            {
                p.Pos.Y = (y + 1) * T;
                p.Vel.Y = 40;
                HitBlock(hitX, y);
            }
        }
    }

    private void HitBlock(int x, int y)
    {
        char c = At(x, y);
        var center = new Vector2(x * T + T / 2, y * T);
        switch (c)
        {
            case '?':
                _tiles[x, y] = 'E';
                Bump(x, y);
                AddCoin();
                CoinPops.Add(new CoinPop { Pos = center });
                break;
            case 'F' or 'S' or 'W' or 'H':
                _tiles[x, y] = 'E';
                Bump(x, y);
                var kind = c switch { 'F' => ItemKind.Fish, 'S' => ItemKind.Snowflake, 'W' => ItemKind.Wing, _ => ItemKind.Heart };
                Items.Add(new Item { Kind = kind, Pos = center + new Vector2(0, T / 2), Vel = new Vector2(kind is ItemKind.Fish or ItemKind.Heart or ItemKind.Wing ? 110 : 0, 0) });
                Audio.Play(Sfx.PowerUp);
                break;
            case 'B':
                if (Player.Power >= 1)
                {
                    _tiles[x, y] = ' ';
                    Score += 50;
                    Audio.Play(Sfx.Break);
                    Shake = 0.1f;
                    for (int i = 0; i < 4; i++)
                        Spawn(new Vector2(x * T + 12 + (i % 2) * 24, y * T + 12 + (i / 2) * 24),
                            new Vector2((i % 2 == 0 ? -1 : 1) * Rand(80, 160), Rand(-520, -320)), 1.2f, 12, Theme.Brick, true, 1);
                }
                else
                {
                    Bump(x, y);
                    Audio.Play(Sfx.Bump);
                }
                break;
            default:
                Audio.Play(Sfx.Bump);
                break;
        }

        // things standing on the bumped block get knocked
        var above = new Rectangle(x * T, y * T - 10, T, 12);
        foreach (var e in Enemies)
            if (e.Alive && e.Active && Raylib.CheckCollisionRecs(e.Rect, above)) KnockEnemy(e, x * T + T / 2 < e.Pos.X + e.W / 2 ? 1 : -1);
        if (At(x, y - 1) == 'o')
        {
            _tiles[x, y - 1] = ' ';
            AddCoin();
            CoinPops.Add(new CoinPop { Pos = center - new Vector2(0, T) });
        }
    }

    private void Bump(int x, int y) => _bumps[(x, y)] = 0.2f;

    public float BumpOffset(int x, int y) =>
        _bumps.TryGetValue((x, y), out var t) ? -MathF.Sin(MathF.PI * (1 - t / 0.2f)) * 12 : 0;

    private void AddCoin()
    {
        Coins++;
        Score += 100;
        Audio.Play(Sfx.Coin);
        if (Coins % 100 == 0) GrantExtraLife();
    }

    private void GrantExtraLife()
    {
        ExtraLife?.Invoke();
        Audio.Play(Sfx.OneUp);
        ShowMessage(Loc.T("power.heart"));
    }

    public void ShowMessage(string text)
    {
        Message = text;
        MessageTimer = 3.2f;
    }

    private void CheckHazards()
    {
        var p = Player;
        var r = p.Rect;
        int x0 = (int)(r.X / T), x1 = (int)((r.X + r.Width) / T);
        int y0 = (int)(r.Y / T), y1 = (int)((r.Y + r.Height) / T);
        for (int x = x0; x <= x1; x++)
        for (int y = y0; y <= y1; y++)
        {
            char c = At(x, y);
            if (c == '^' && Raylib.CheckCollisionRecs(r, new Rectangle(x * T + 6, y * T + 20, T - 12, T - 20)))
            {
                HurtPlayer();
                if (!p.Dead) p.Vel.Y = -520;
                return;
            }
            if (c == '~' && Raylib.CheckCollisionRecs(r, new Rectangle(x * T, y * T + 18, T, T - 18)))
            {
                KillPlayer();
                return;
            }
        }
    }

    private void CheckPickups()
    {
        var p = Player;
        var r = p.Rect;
        int x0 = (int)(r.X / T), x1 = (int)((r.X + r.Width) / T);
        int y0 = (int)(r.Y / T), y1 = (int)((r.Y + r.Height) / T);
        for (int x = x0; x <= x1; x++)
        for (int y = y0; y <= y1; y++)
        {
            if (At(x, y) != 'o') continue;
            if (!Raylib.CheckCollisionRecs(r, new Rectangle(x * T + 10, y * T + 6, T - 20, T - 12))) continue;
            _tiles[x, y] = ' ';
            AddCoin();
            for (int i = 0; i < 6; i++)
                Spawn(new Vector2(x * T + T / 2, y * T + T / 2), new Vector2(Rand(-100, 100), Rand(-160, 40)), 0.4f, 3, new Color(255, 230, 120, 255), false);
        }

        for (int i = Items.Count - 1; i >= 0; i--)
        {
            var it = Items[i];
            if (it.Emerge > 0 || !Raylib.CheckCollisionRecs(r, it.Rect)) continue;
            Items.RemoveAt(i);
            Score += 1000;
            Texts.Add(new FloatText { Pos = it.Pos, Text = "1000", Color = Ui.Accent });
            switch (it.Kind)
            {
                case ItemKind.Fish:
                    p.Power = Math.Max(p.Power, 1);
                    ShowMessage(Loc.T("power.fish"));
                    Audio.Play(Sfx.PowerUp);
                    break;
                case ItemKind.Snowflake:
                    p.Power = 2;
                    ShowMessage(Loc.T("power.snowflake"));
                    Audio.Play(Sfx.PowerUp);
                    break;
                case ItemKind.Wing:
                    p.Wings = true;
                    ShowMessage(Loc.T("power.wing"));
                    Audio.Play(Sfx.PowerUp);
                    break;
                case ItemKind.Heart:
                    GrantExtraLife();
                    break;
            }
            for (int k = 0; k < 14; k++)
                Spawn(it.Pos, new Vector2(Rand(-200, 200), Rand(-200, 200)), 0.6f, 4, new Color(255, 240, 150, 255), false);
        }
    }

    private void CheckCheckpoints()
    {
        foreach (var c in Checkpoints)
        {
            if (c.Active) continue;
            var rect = new Rectangle(c.Tx * T, c.Ty * T - T, T, T * 2);
            if (!Raylib.CheckCollisionRecs(Player.Rect, rect)) continue;
            c.Active = true;
            LastCheckpoint = new CheckpointState { Tx = c.Tx, Ty = c.Ty, Score = Score, Coins = Coins, Time = Time };
            Audio.Play(Sfx.Checkpoint);
            Texts.Add(new FloatText { Pos = new Vector2(c.Tx * T + T / 2, c.Ty * T - 60), Text = Loc.T("checkpoint"), Life = 1.6f, Color = new Color(120, 255, 170, 255) });
            for (int k = 0; k < 16; k++)
                Spawn(new Vector2(c.Tx * T + 40, c.Ty * T - 30), new Vector2(Rand(-150, 150), Rand(-250, 50)), 0.8f, 4, new Color(120, 255, 170, 255), true);
        }
    }

    private void CheckGoal()
    {
        var door = new Rectangle(Goal.x * T - 4, Goal.y * T - 16, T + 8, T + 16);
        if (!Raylib.CheckCollisionRecs(Player.Rect, door)) return;
        Completed = true;
        CompleteTimer = 0;
        Player.Vel = Vector2.Zero;
        Audio.PlayMusic(-1);
        Audio.Play(Sfx.Complete);
    }

    private void UpdateCompletion(float dt)
    {
        var p = Player;
        CompleteTimer += dt;
        p.Anim += dt;
        float doorX = Goal.x * T + T / 2 - Phys.PlayerW / 2;
        p.Pos.X = Approach(p.Pos.X, doorX, 120 * dt);
        p.Vel.Y = MathF.Min(p.Vel.Y + Phys.Gravity * dt, Phys.MaxFall);
        p.PrevBottom = p.Bottom;
        MovePlayerY(dt, false);
        if (CompleteTimer > 0.9f) p.Hidden = true;
        if (CompleteTimer > 1.2f && CompleteTimer - dt <= 1.2f)
            for (int k = 0; k < 30; k++)
                Spawn(new Vector2(Goal.x * T + T / 2, Goal.y * T - 60), new Vector2(Rand(-260, 260), Rand(-420, -80)), 1.4f, 5,
                    Art.Mix(new Color(255, 200, 60, 255), new Color(120, 220, 255, 255), Rand(0, 1)), true, 1);
        if (CompleteTimer > 2.4f && CompleteTimer - dt <= 2.4f) LevelCompleted?.Invoke();
    }

    public void HurtPlayer()
    {
        var p = Player;
        if (p.Invuln > 0 || p.Dead || Completed) return;
        if (p.Power > 0 || p.Wings)
        {
            p.Power = 0;
            p.Wings = false;
            p.Invuln = 2f;
            Audio.Play(Sfx.Hurt);
            Shake = 0.2f;
        }
        else KillPlayer();
    }

    public void KillPlayer()
    {
        var p = Player;
        if (p.Dead || Completed) return;
        p.Dead = true;
        p.DeadTimer = 0;
        p.Vel = new Vector2(0, -700);
        Audio.PlayMusic(-1);
        Audio.Play(Sfx.Die);
        Shake = 0.3f;
    }

    private void UpdateDeadPlayer(float dt)
    {
        var p = Player;
        p.DeadTimer += dt;
        if (p.DeadTimer < 0.4f) return;
        p.Vel.Y = MathF.Min(p.Vel.Y + Phys.Gravity * 0.6f * dt, Phys.MaxFall);
        p.Pos.Y += p.Vel.Y * dt;
        if (p.DeadTimer > 2.2f && p.DeadTimer - dt <= 2.2f) PlayerDied?.Invoke();
    }

    // ------------------------------------------------------------------ crumbles
    private void UpdateCrumbles(float dt)
    {
        foreach (var key in _crumbleTimer.Keys.ToList())
        {
            _crumbleTimer[key] -= dt;
            if (_crumbleTimer[key] > 0) continue;
            _crumbleTimer.Remove(key);
            _crumbleFallen[key] = 4f;
            Audio.Play(Sfx.Crumble);
            for (int i = 0; i < 5; i++)
                Spawn(new Vector2(key.Item1 * T + Rand(6, 42), key.Item2 * T + Rand(4, 24)), new Vector2(Rand(-40, 40), Rand(0, 100)), 1f, 8,
                    Art.Mix(Theme.Brick, Color.White, 0.3f), true, 1);
        }

        foreach (var key in _crumbleFallen.Keys.ToList())
        {
            _crumbleFallen[key] -= dt;
            if (_crumbleFallen[key] > 0) continue;
            var rect = new Rectangle(key.Item1 * T, key.Item2 * T, T, T);
            if (Raylib.CheckCollisionRecs(rect, Player.Rect)) continue;
            _crumbleFallen.Remove(key);
        }

        foreach (var key in _bumps.Keys.ToList())
        {
            _bumps[key] -= dt;
            if (_bumps[key] <= 0) _bumps.Remove(key);
        }

        foreach (var key in _springAnim.Keys.ToList())
        {
            _springAnim[key] -= dt;
            if (_springAnim[key] <= 0) _springAnim.Remove(key);
        }
    }

    public bool CrumbleFallen(int x, int y) => _crumbleFallen.ContainsKey((x, y));
    public float CrumbleShake(int x, int y) => _crumbleTimer.TryGetValue((x, y), out var t) ? 0.45f - t : 0;
    public float SpringCompress(int x, int y) => _springAnim.TryGetValue((x, y), out var t) ? MathF.Sin(t / 0.3f * MathF.PI) : 0;

    // ------------------------------------------------------------------ enemies
    private void UpdateEnemies(float dt)
    {
        float activeL = CamX - 2 * T, activeR = CamX + Ui.Width + 2 * T;
        for (int i = Enemies.Count - 1; i >= 0; i--)
        {
            var e = Enemies[i];
            if (!e.Active)
            {
                if (e.Pos.X + e.W > activeL && e.Pos.X < activeR) e.Active = true;
                else continue;
            }
            e.T += dt;

            if (e.Squashed)
            {
                e.DeathTimer += dt;
                if (e.DeathTimer > 0.5f) Enemies.RemoveAt(i);
                continue;
            }
            if (e.Flipped)
            {
                e.Vel.Y += Phys.Gravity * dt;
                e.Pos += e.Vel * dt;
                if (e.Pos.Y > H * T + 100) Enemies.RemoveAt(i);
                continue;
            }

            switch (e.Kind)
            {
                case EnemyKind.Walker:
                case EnemyKind.Spiky:
                    e.Vel.X = e.Facing * (e.Kind == EnemyKind.Walker ? 70 : 55);
                    MoveEnemy(e, dt, true);
                    break;
                case EnemyKind.Hopper:
                    if (e.OnGround)
                    {
                        e.Vel.X = 0;
                        e.HopTimer -= dt;
                        if (e.HopTimer <= 0)
                        {
                            float dx = Player.Center.X - (e.Pos.X + e.W / 2);
                            if (MathF.Abs(dx) < 8 * T) e.Facing = dx > 0 ? 1 : -1;
                            e.Vel = new Vector2(e.Facing * 150, -640);
                            e.HopTimer = 1.1f;
                            e.OnGround = false;
                        }
                    }
                    MoveEnemy(e, dt, false);
                    break;
                case EnemyKind.Bird:
                    float nx = e.Origin.X + MathF.Sin(e.T * 0.9f) * 2.2f * T;
                    float ny = e.Origin.Y + MathF.Sin(e.T * 2.4f) * 0.5f * T;
                    e.Facing = nx > e.Pos.X ? 1 : -1;
                    e.Pos = new Vector2(nx, ny);
                    break;
            }

            if (e.Pos.Y > H * T + 100) { Enemies.RemoveAt(i); continue; }
            if (!Player.Dead && !Completed) PlayerVsEnemy(e);
        }
    }

    private void MoveEnemy(Enemy e, float dt, bool turnAtEdges)
    {
        e.Vel.Y = MathF.Min(e.Vel.Y + Phys.Gravity * dt, Phys.MaxFall);
        // horizontal
        e.Pos.X += e.Vel.X * dt;
        int y0 = (int)MathF.Floor(e.Pos.Y / T), y1 = (int)MathF.Floor((e.Pos.Y + e.H - 0.01f) / T);
        if (e.Vel.X > 0)
        {
            int x = (int)MathF.Floor((e.Pos.X + e.W) / T);
            for (int y = y0; y <= y1; y++)
                if (Solid(x, y) || At(x, y) is '^' or '~' || x >= W) { e.Pos.X = x * T - e.W; e.Facing = -1; if (e.Kind == EnemyKind.Hopper) e.Vel.X = -e.Vel.X; break; }
        }
        else if (e.Vel.X < 0)
        {
            int x = (int)MathF.Floor(e.Pos.X / T);
            for (int y = y0; y <= y1; y++)
                if (Solid(x, y) || At(x, y) is '^' or '~' || x < 0) { e.Pos.X = (x + 1) * T; e.Facing = 1; if (e.Kind == EnemyKind.Hopper) e.Vel.X = -e.Vel.X; break; }
        }

        // vertical
        float prevBottom = e.Pos.Y + e.H;
        e.Pos.Y += e.Vel.Y * dt;
        e.OnGround = false;
        int x0 = (int)MathF.Floor((e.Pos.X + 2) / T), x1 = (int)MathF.Floor((e.Pos.X + e.W - 2) / T);
        if (e.Vel.Y >= 0)
        {
            int y = (int)MathF.Floor((e.Pos.Y + e.H) / T);
            for (int x = x0; x <= x1; x++)
            {
                if (Solid(x, y) || (OneWay(x, y) && At(x, y) == '-' && prevBottom <= y * T + 0.5f))
                {
                    e.Pos.Y = y * T - e.H;
                    e.Vel.Y = 0;
                    e.OnGround = true;
                    break;
                }
            }
        }
        else
        {
            int y = (int)MathF.Floor(e.Pos.Y / T);
            for (int x = x0; x <= x1; x++)
                if (Solid(x, y)) { e.Pos.Y = (y + 1) * T; e.Vel.Y = 0; break; }
        }

        if (turnAtEdges && e.OnGround)
        {
            float frontX = e.Facing > 0 ? e.Pos.X + e.W + 1 : e.Pos.X - 1;
            int fx = (int)MathF.Floor(frontX / T);
            int fy = (int)MathF.Floor((e.Pos.Y + e.H + 1) / T);
            if (!Solid(fx, fy) && At(fx, fy) != '-') e.Facing = -e.Facing;
        }
    }

    private void PlayerVsEnemy(Enemy e)
    {
        var p = Player;
        var er = new Rectangle(e.Pos.X + 4, e.Pos.Y + 4, e.W - 8, e.H - 4);
        if (!Raylib.CheckCollisionRecs(p.Rect, er)) return;

        bool fromAbove = p.Vel.Y > 0 && p.PrevBottom <= e.Pos.Y + 14;
        if (fromAbove && e.Stompable)
        {
            e.Squashed = true;
            e.DeathTimer = 0;
            StompCombo++;
            int pts = 100 * Math.Min(StompCombo, 8);
            Score += pts;
            Texts.Add(new FloatText { Pos = new Vector2(e.Pos.X + e.W / 2, e.Pos.Y), Text = pts.ToString() });
            p.Vel.Y = -(Input.JumpHeld ? Phys.StompBounceHeld : Phys.StompBounce);
            p.Pos.Y = e.Pos.Y - Phys.PlayerH;
            Audio.Play(Sfx.Stomp);
            for (int i = 0; i < 8; i++)
                Spawn(new Vector2(e.Pos.X + e.W / 2, e.Pos.Y + e.H / 2), new Vector2(Rand(-160, 160), Rand(-200, 0)), 0.5f, 4, new Color(255, 255, 255, 220), true);
            if (e.Kind == EnemyKind.Bird) { e.Squashed = false; KnockEnemy(e, p.Facing); }
        }
        else HurtPlayer();
    }

    public void KnockEnemy(Enemy e, int dir)
    {
        if (!e.Alive) return;
        e.Flipped = true;
        e.Vel = new Vector2(dir * 140, -480);
        Score += 200;
        Texts.Add(new FloatText { Pos = new Vector2(e.Pos.X + e.W / 2, e.Pos.Y), Text = "200" });
        Audio.Play(Sfx.Kick);
    }

    // ------------------------------------------------------------------ icicles
    private void UpdateIcicles(float dt)
    {
        foreach (var ic in Icicles)
        {
            switch (ic.State)
            {
                case 0:
                    float pcx = Player.Center.X;
                    if (!Player.Dead && pcx > ic.Pos.X - 1.2f * T && pcx < ic.Pos.X + 2.2f * T && Player.Pos.Y > ic.Pos.Y)
                    {
                        ic.State = 1;
                        ic.Timer = 0.45f;
                    }
                    break;
                case 1:
                    ic.Timer -= dt;
                    if (ic.Timer <= 0) ic.State = 2;
                    break;
                case 2:
                    ic.Vy = MathF.Min(ic.Vy + 1800 * dt, 1100);
                    ic.Pos.Y += ic.Vy * dt;
                    int tx = (int)((ic.Pos.X + T / 2) / T), ty = (int)((ic.Pos.Y + 40) / T);
                    if (Solid(tx, ty) || OneWay(tx, ty) || ic.Pos.Y > H * T)
                    {
                        ic.State = 3;
                        Audio.Play(Sfx.Break);
                        for (int i = 0; i < 8; i++)
                            Spawn(new Vector2(ic.Pos.X + T / 2, ic.Pos.Y + 36), new Vector2(Rand(-180, 180), Rand(-300, -80)), 0.7f, 5, new Color(190, 230, 255, 255), true, 1);
                    }
                    foreach (var e in Enemies)
                        if (e.Alive && Raylib.CheckCollisionRecs(ic.Rect, e.Rect)) KnockEnemy(e, 1);
                    break;
            }
            if (ic.State < 3 && !Player.Dead && Raylib.CheckCollisionRecs(Player.Rect, ic.Rect)) HurtPlayer();
        }
    }

    // ------------------------------------------------------------------ items / projectiles
    private void UpdateItems(float dt)
    {
        for (int i = Items.Count - 1; i >= 0; i--)
        {
            var it = Items[i];
            it.T += dt;
            if (it.Emerge > 0)
            {
                it.Emerge -= dt;
                it.Pos.Y -= T / 0.5f * dt;
                continue;
            }
            if (it.Kind == ItemKind.Snowflake) continue; // floats in place

            it.Vel.Y = MathF.Min(it.Vel.Y + Phys.Gravity * 0.8f * dt, Phys.MaxFall);
            it.Pos.X += it.Vel.X * dt;
            int tx = (int)MathF.Floor((it.Pos.X + MathF.Sign(it.Vel.X) * 16) / T), ty = (int)MathF.Floor(it.Pos.Y / T);
            if (Solid(tx, ty)) it.Vel.X = -it.Vel.X;
            it.Pos.Y += it.Vel.Y * dt;
            int by = (int)MathF.Floor((it.Pos.Y + 16) / T), bx = (int)MathF.Floor(it.Pos.X / T);
            if (it.Vel.Y > 0 && (Solid(bx, by) || OneWay(bx, by)))
            {
                it.Pos.Y = by * T - 16;
                it.Vel.Y = it.Kind == ItemKind.Wing ? -420 : 0;
            }
            if (it.Pos.Y > H * T + 50) Items.RemoveAt(i);
        }
    }

    private void UpdateSnowballs(float dt)
    {
        for (int i = Snowballs.Count - 1; i >= 0; i--)
        {
            var s = Snowballs[i];
            s.Life -= dt;
            s.Vel.Y = MathF.Min(s.Vel.Y + 1600 * dt, 900);
            s.Pos.X += s.Vel.X * dt;
            bool dead = s.Life <= 0 || s.Pos.Y > H * T;
            if (Solid((int)MathF.Floor((s.Pos.X + MathF.Sign(s.Vel.X) * 9) / T), (int)MathF.Floor(s.Pos.Y / T))) dead = true;
            s.Pos.Y += s.Vel.Y * dt;
            int bx = (int)MathF.Floor(s.Pos.X / T), by = (int)MathF.Floor((s.Pos.Y + 9) / T);
            if (s.Vel.Y > 0 && (Solid(bx, by) || OneWay(bx, by)))
            {
                s.Pos.Y = by * T - 9;
                s.Vel.Y = -380;
            }
            foreach (var e in Enemies)
            {
                if (!e.Alive || !e.Active) continue;
                if (Raylib.CheckCollisionCircleRec(s.Pos, 10, e.Rect)) { KnockEnemy(e, MathF.Sign(s.Vel.X) >= 0 ? 1 : -1); dead = true; break; }
            }
            if (dead)
            {
                for (int k = 0; k < 6; k++) Spawn(s.Pos, new Vector2(Rand(-120, 120), Rand(-160, 40)), 0.4f, 4, Color.White, true);
                Snowballs.RemoveAt(i);
            }
        }
    }

    private void UpdateEffects(float dt)
    {
        for (int i = Particles.Count - 1; i >= 0; i--)
        {
            var p = Particles[i];
            p.Life -= dt;
            if (p.Life <= 0) { Particles.RemoveAt(i); continue; }
            if (p.Gravity) p.Vel.Y += 1400 * dt;
            p.Pos += p.Vel * dt;
        }
        for (int i = Texts.Count - 1; i >= 0; i--)
        {
            Texts[i].Life -= dt;
            Texts[i].Pos.Y -= 50 * dt;
            if (Texts[i].Life <= 0) Texts.RemoveAt(i);
        }
        for (int i = CoinPops.Count - 1; i >= 0; i--)
        {
            CoinPops[i].T += dt;
            if (CoinPops[i].T > 0.5f) CoinPops.RemoveAt(i);
        }
    }

    private void UpdateCamera(float dt)
    {
        if (Player.Dead) return;
        float target = Player.Center.X - Ui.Width * 0.4f + Player.Facing * 60;
        CamX += (target - CamX) * MathF.Min(1, dt * 5);
        CamX = Math.Clamp(CamX, 0, MathF.Max(0, W * T - Ui.Width));
    }

    // ------------------------------------------------------------------ helpers
    private static readonly Random Rng = new();
    public static float Rand(float a, float b) => a + (float)Rng.NextDouble() * (b - a);
    private static float Approach(float v, float target, float step) => v < target ? MathF.Min(v + step, target) : MathF.Max(v - step, target);

    public void Spawn(Vector2 pos, Vector2 vel, float life, float size, Color c, bool gravity, int shape = 0) =>
        Particles.Add(new Particle { Pos = pos, Vel = vel, Life = life, MaxLife = life, Size = size, Color = c, Gravity = gravity, Shape = shape });

    private void Dust(Vector2 at, int n)
    {
        for (int i = 0; i < n; i++)
            Spawn(at + new Vector2(Rand(-10, 10), -2), new Vector2(Rand(-90, 90), Rand(-60, -10)), 0.35f, Rand(3, 6), new Color(255, 255, 255, 200), false);
    }

    public Sign? NearbySign()
    {
        foreach (var s in Signs)
        {
            var c = new Vector2(s.Tx * T + T / 2, s.Ty * T + T / 2);
            if (Vector2.Distance(c, Player.Center) < 110) return s;
        }
        return null;
    }
}
