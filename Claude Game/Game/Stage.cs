using System.Numerics;
using Platformer.Core;
using Raylib_cs;
using static Platformer.Game.DetMath;

namespace Platformer.Game;

/// <summary>
/// Runtime state and simulation of one level.
/// The gameplay part is deterministic and mirrored 1:1 in web/js/stage.js and server/src/Replay/Sim.php
/// (same operations in the same order, double precision, no randomness) so the server can replay a
/// recorded run and verify a highscore. Particles, sounds and messages are cosmetic and may differ.
/// </summary>
public sealed class Stage
{
    private const double T = Phys.Tile;

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
    private readonly Dictionary<(int, int), double> _bumps = new();
    private readonly Dictionary<(int, int), double> _crumbleTimer = new();
    private readonly Dictionary<(int, int), double> _crumbleFallen = new();
    private readonly Dictionary<(int, int), double> _springAnim = new();
    public (int x, int y) Goal;

    public int TimeTicks;                                   // level timer in simulation ticks
    public double Time => TimeTicks / (double)Phys.TicksPerSecond;
    public double Clock;                                    // animation / platform clock
    public int Score, Coins, TotalCoins;
    public double CamX;
    public float Shake;
    public int StompCombo;

    public bool Completed;
    public double CompleteTimer;
    private int _scoreAtGoal;
    /// <summary>Score when the goal was reached (knock-outs during the exit animation don't count).</summary>
    public int FinalScore => Completed ? _scoreAtGoal : Score;
    public string? Message;
    public float MessageTimer;
    public CheckpointState? LastCheckpoint;

    private TickInput _in;

    public event Action? PlayerDied;
    public event Action? LevelCompleted;
    public event Action? ExtraLife;

    public Stage(LevelData data, CheckpointState? cp)
    {
        Data = data;
        Theme = Art.ThemeFor(data.World);
        _tiles = (char[,])data.Tiles.Clone();
        var signPositions = new List<(int, int)>();

        for (int x = 0; x < W; x++)
        for (int y = 0; y < H; y++)
        {
            char c = _tiles[x, y];
            switch (c)
            {
                case '@':
                    Player.Pos = new Vec(x * T + (T - Phys.PlayerW) / 2, y * T + T - Phys.PlayerH);
                    _tiles[x, y] = ' ';
                    break;
                case 'e': Enemies.Add(Enemy.Create(EnemyKind.Walker, x, y)); _tiles[x, y] = ' '; break;
                case 's': Enemies.Add(Enemy.Create(EnemyKind.Spiky, x, y)); _tiles[x, y] = ' '; break;
                case 'b': Enemies.Add(Enemy.Create(EnemyKind.Bird, x, y)); _tiles[x, y] = ' '; break;
                case 'h': Enemies.Add(Enemy.Create(EnemyKind.Hopper, x, y)); _tiles[x, y] = ' '; break;
                case 'i': Icicles.Add(new Icicle { Pos = new Vec(x * T, y * T) }); _tiles[x, y] = ' '; break;
                case 'C': Checkpoints.Add(new Checkpoint { Tx = x, Ty = y }); _tiles[x, y] = ' '; break;
                case 'G': Goal = (x, y); _tiles[x, y] = ' '; break;
                case '!': signPositions.Add((x, y)); _tiles[x, y] = ' '; break;
                case 'M':
                case 'V':
                    if (x > 0 && data.Tiles[x - 1, y] == c) { _tiles[x, y] = ' '; break; }
                    int len = 1;
                    while (x + len < W && data.Tiles[x + len, y] == c) len++;
                    var o = new Vec(x * T, y * T + T - MovingPlatform.Height - 8);
                    Platforms.Add(new MovingPlatform { Origin = o, Pos = o, WidthTiles = len, Vertical = c == 'V', Phase = x * 0.37 });
                    _tiles[x, y] = ' ';
                    break;
                case 'o':
                case '?':
                    TotalCoins++;
                    break;
            }
        }

        int signIndex = 0;
        foreach (var (sx, sy) in signPositions.OrderBy(p => p.Item1).ThenBy(p => p.Item2))
            Signs.Add(new Sign { Tx = sx, Ty = sy, Key = signIndex < data.Signs.Length ? data.Signs[signIndex++] : "" });

        if (cp != null)
        {
            LastCheckpoint = cp;
            Player.Pos = new Vec(cp.Tx * T + (T - Phys.PlayerW) / 2, cp.Ty * T + T - Phys.PlayerH);
            Score = cp.Score; Coins = cp.Coins; TimeTicks = cp.TimeTicks;
            foreach (var c in Checkpoints) if (c.Tx <= cp.Tx) c.Active = true;
        }

        Player.PrevBottom = Player.Bottom;
        CamX = Math.Max(0, Math.Min(Math.Max(0, W * T - Phys.View), Player.Center.X - Phys.View * 0.4));
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

    private static int Sign(double v) => v > 0 ? 1 : v < 0 ? -1 : 0;

    // ------------------------------------------------------------------ update
    /// <summary>Advances the level by dt. During play dt is always Phys.Step (one tick).</summary>
    public void Update(double dt, TickInput input)
    {
        _in = input;
        Clock += dt;
        if (dt > 0 && !Completed && !Player.Dead) TimeTicks++;
        if (MessageTimer > 0) MessageTimer -= (float)dt;
        if (Shake > 0) Shake -= (float)dt;

        foreach (var p in Platforms) p.Update(Clock);

        if (Player.Dead) UpdateDeadPlayer(dt);
        else if (Completed) UpdateCompletion(dt);
        else UpdatePlayer(dt);

        UpdateCrumbles(dt);
        UpdateEnemies(dt);
        UpdateIcicles(dt);
        UpdateItems(dt);
        UpdateSnowballs(dt);
        UpdateEffects((float)dt);
        UpdateCamera(dt);
    }

    private void UpdatePlayer(double dt)
    {
        var p = Player;
        p.Anim += dt;
        if (p.Invuln > 0) p.Invuln -= dt;

        if (p.Riding != null)
        {
            p.Pos += p.Riding.Delta;
            p.Riding = null;
        }

        if (_in.JumpPressed) p.BufferTimer = Phys.JumpBuffer; else p.BufferTimer -= dt;
        if (p.OnGround) { p.CoyoteTimer = Phys.Coyote; p.DoubleUsed = false; } else p.CoyoteTimer -= dt;

        // horizontal movement
        int target = (_in.Right ? 1 : 0) - (_in.Left ? 1 : 0);
        double maxSpeed = _in.Run ? Phys.Run : Phys.Walk;
        if (target != 0)
        {
            p.Facing = target;
            double accel = p.OnGround ? Phys.AccelGround : Phys.AccelAir;
            if (Sign(p.Vel.X) != target && p.OnGround) accel *= 1.6; // quick turn
            p.Vel.X = Approach(p.Vel.X, target * maxSpeed, accel * dt);
        }
        else if (p.OnGround) p.Vel.X = Approach(p.Vel.X, 0, Phys.Friction * dt);
        else p.Vel.X = Approach(p.Vel.X, 0, Phys.Friction * 0.25 * dt);

        // jumping
        if (p.BufferTimer > 0 && p.CoyoteTimer > 0)
        {
            double runFactor = Math.Max(0, Math.Min(1, (Math.Abs(p.Vel.X) - Phys.Walk) / (Phys.Run - Phys.Walk)));
            p.Vel.Y = -(Phys.JumpV + (Phys.JumpVRun - Phys.JumpV) * runFactor);
            p.OnGround = false;
            p.BufferTimer = 0; p.CoyoteTimer = 0;
            Audio.Play(Sfx.Jump);
            Dust(new Vector2((float)(p.Pos.X + Phys.PlayerW / 2), (float)(p.Pos.Y + Phys.PlayerH)), 5);
        }
        else if (p.BufferTimer > 0 && !p.OnGround && p.Wings && !p.DoubleUsed)
        {
            p.Vel.Y = -Phys.DoubleJumpV;
            p.DoubleUsed = true;
            p.BufferTimer = 0;
            Audio.Play(Sfx.DoubleJump);
            for (int i = 0; i < 8; i++)
                Spawn((Vector2)p.Center + new Vector2(0, 16), new Vector2(Rand(-120, 120), Rand(40, 140)), 0.5f, 4, new Color(255, 255, 255, 230), false);
        }

        // throw snowballs
        if (_in.ActionPressed && p.Power == 2 && Snowballs.Count < 2)
        {
            Snowballs.Add(new Snowball
            {
                Pos = new Vec(p.Pos.X + Phys.PlayerW / 2 + p.Facing * 16, p.Pos.Y + Phys.PlayerH / 2 - 4),
                Vel = new Vec(p.Facing * 560 + p.Vel.X * 0.3, 120)
            });
            Audio.Play(Sfx.Throw);
        }

        double g = p.Vel.Y < 0 && _in.JumpHeld ? Phys.GravityUp : Phys.Gravity;
        p.Vel.Y = Math.Min(p.Vel.Y + g * dt, Phys.MaxFall);

        p.PrevBottom = p.Bottom;
        MovePlayerX(dt);
        MovePlayerY(dt, _in.JumpHeld);

        // fell out of the level
        if (p.Pos.Y > H * T + 60) KillPlayer();

        CheckHazards();
        CheckPickups();
        CheckCheckpoints();
        CheckGoal();
    }

    private void MovePlayerX(double dt)
    {
        var p = Player;
        p.Pos.X += p.Vel.X * dt;
        if (p.Pos.X < 0) { p.Pos.X = 0; p.Vel.X = 0; }
        if (p.Pos.X > W * T - Phys.PlayerW) { p.Pos.X = W * T - Phys.PlayerW; p.Vel.X = 0; }
        int y0 = Floor(p.Pos.Y / T), y1 = Floor((p.Pos.Y + Phys.PlayerH - 0.01) / T);
        if (p.Vel.X > 0)
        {
            int x = Floor((p.Pos.X + Phys.PlayerW) / T);
            for (int y = y0; y <= y1; y++)
                if (Solid(x, y)) { p.Pos.X = x * T - Phys.PlayerW; p.Vel.X = 0; break; }
        }
        else if (p.Vel.X < 0)
        {
            int x = Floor(p.Pos.X / T);
            for (int y = y0; y <= y1; y++)
                if (Solid(x, y)) { p.Pos.X = (x + 1) * T; p.Vel.X = 0; break; }
        }
    }

    private void MovePlayerY(double dt, bool jumpHeld)
    {
        var p = Player;
        p.Pos.Y += p.Vel.Y * dt;
        p.OnGround = false;
        int x0 = Floor((p.Pos.X + 1) / T), x1 = Floor((p.Pos.X + Phys.PlayerW - 1) / T);

        if (p.Vel.Y >= 0)
        {
            double bottom = p.Pos.Y + Phys.PlayerH;
            int y = Floor(bottom / T);
            double best = double.PositiveInfinity;
            int springX = -1;
            for (int x = x0; x <= x1; x++)
            {
                if (Solid(x, y)) best = Math.Min(best, y * T);
                else if (OneWay(x, y))
                {
                    double top = y * T + (At(x, y) == '*' ? 16 : 0);
                    if (p.PrevBottom <= top + 0.5 && bottom >= top)
                    {
                        best = Math.Min(best, top);
                        if (At(x, y) == '*') springX = x;
                    }
                }
            }

            foreach (var mp in Platforms)
            {
                if (p.Pos.X + Phys.PlayerW > mp.Pos.X + 2 && p.Pos.X < mp.Pos.X + mp.WidthTiles * T - 2)
                {
                    double top = mp.Pos.Y;
                    if (p.PrevBottom <= top + Math.Abs(mp.Delta.Y) + 1 && bottom >= top && top < best)
                    {
                        best = top;
                        p.Riding = mp;
                    }
                }
            }

            if (best < double.PositiveInfinity)
            {
                p.Pos.Y = best - Phys.PlayerH;
                if (springX >= 0)
                {
                    p.Vel.Y = -(jumpHeld ? Phys.SpringVHeld : Phys.SpringV);
                    _springAnim[(springX, y)] = 0.3;
                    Audio.Play(Sfx.Spring);
                    p.Riding = null;
                    return;
                }
                if (p.Vel.Y > 600) Dust(new Vector2((float)(p.Pos.X + Phys.PlayerW / 2), (float)(p.Pos.Y + Phys.PlayerH)), 4);
                p.Vel.Y = 0;
                p.OnGround = true;
                StompCombo = 0;
                // start crumbling all crumble tiles under the feet
                for (int x = x0; x <= x1; x++)
                    if (At(x, y) == 'x' && !_crumbleTimer.ContainsKey((x, y)) && !_crumbleFallen.ContainsKey((x, y)))
                        _crumbleTimer[(x, y)] = 0.45;
            }
            else p.Riding = null;
        }
        else
        {
            int y = Floor(p.Pos.Y / T);
            int hitX = -1;
            double bestOverlap = 0;
            for (int x = x0; x <= x1; x++)
            {
                if (!Solid(x, y)) continue;
                double overlap = Math.Min(p.Pos.X + Phys.PlayerW, (x + 1) * T) - Math.Max(p.Pos.X, x * T);
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
        var center = new Vector2((float)(x * T + T / 2), (float)(y * T));
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
                Items.Add(new Item { Kind = kind, Pos = new Vec(x * T + T / 2, y * T + T / 2), Vel = new Vec(kind == ItemKind.Snowflake ? 0 : 110, 0) });
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
                        Spawn(new Vector2((float)(x * T + 12 + (i % 2) * 24), (float)(y * T + 12 + (i / 2) * 24)),
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
        var above = new Box(x * T, y * T - 10, T, 12);
        foreach (var e in Enemies)
            if (e.Alive && e.Active && e.Rect.Overlaps(above)) KnockEnemy(e, x * T + T / 2 < e.Pos.X + e.W / 2 ? 1 : -1);
        if (At(x, y - 1) == 'o')
        {
            _tiles[x, y - 1] = ' ';
            AddCoin();
            CoinPops.Add(new CoinPop { Pos = center - new Vector2(0, (float)T) });
        }
    }

    private void Bump(int x, int y) => _bumps[(x, y)] = 0.2;

    public float BumpOffset(int x, int y) =>
        _bumps.TryGetValue((x, y), out var t) ? -MathF.Sin(MathF.PI * (1 - (float)t / 0.2f)) * 12 : 0;

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
        int x0 = Floor(r.X / T), x1 = Floor((r.X + r.W) / T);
        int y0 = Floor(r.Y / T), y1 = Floor((r.Y + r.H) / T);
        for (int x = x0; x <= x1; x++)
        for (int y = y0; y <= y1; y++)
        {
            char c = At(x, y);
            if (c == '^' && r.Overlaps(new Box(x * T + 6, y * T + 20, T - 12, T - 20)))
            {
                HurtPlayer();
                if (!p.Dead) p.Vel.Y = -520;
                return;
            }
            if (c == '~' && r.Overlaps(new Box(x * T, y * T + 18, T, T - 18)))
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
        int x0 = Floor(r.X / T), x1 = Floor((r.X + r.W) / T);
        int y0 = Floor(r.Y / T), y1 = Floor((r.Y + r.H) / T);
        for (int x = x0; x <= x1; x++)
        for (int y = y0; y <= y1; y++)
        {
            if (At(x, y) != 'o') continue;
            if (!r.Overlaps(new Box(x * T + 10, y * T + 6, T - 20, T - 12))) continue;
            _tiles[x, y] = ' ';
            AddCoin();
            for (int i = 0; i < 6; i++)
                Spawn(new Vector2((float)(x * T + T / 2), (float)(y * T + T / 2)), new Vector2(Rand(-100, 100), Rand(-160, 40)), 0.4f, 3, new Color(255, 230, 120, 255), false);
        }

        for (int i = Items.Count - 1; i >= 0; i--)
        {
            var it = Items[i];
            if (it.Emerge > 0 || !r.Overlaps(it.Rect)) continue;
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
            if (!Player.Rect.Overlaps(new Box(c.Tx * T, c.Ty * T - T, T, T * 2))) continue;
            c.Active = true;
            LastCheckpoint = new CheckpointState { Tx = c.Tx, Ty = c.Ty, Score = Score, Coins = Coins, TimeTicks = TimeTicks };
            Audio.Play(Sfx.Checkpoint);
            Texts.Add(new FloatText { Pos = new Vector2((float)(c.Tx * T + T / 2), (float)(c.Ty * T - 60)), Text = Loc.T("checkpoint"), Life = 1.6f, Color = new Color(120, 255, 170, 255) });
            for (int k = 0; k < 16; k++)
                Spawn(new Vector2((float)(c.Tx * T + 40), (float)(c.Ty * T - 30)), new Vector2(Rand(-150, 150), Rand(-250, 50)), 0.8f, 4, new Color(120, 255, 170, 255), true);
        }
    }

    private void CheckGoal()
    {
        var door = new Box(Goal.x * T - 4, Goal.y * T - 16, T + 8, T + 16);
        if (!Player.Rect.Overlaps(door)) return;
        Completed = true;
        _scoreAtGoal = Score;
        CompleteTimer = 0;
        Player.Vel = new Vec(0, 0);
        Audio.PlayMusic(-1);
        Audio.Play(Sfx.Complete);
    }

    private void UpdateCompletion(double dt)
    {
        var p = Player;
        CompleteTimer += dt;
        p.Anim += dt;
        double doorX = Goal.x * T + T / 2 - Phys.PlayerW / 2;
        p.Pos.X = Approach(p.Pos.X, doorX, 120 * dt);
        p.Vel.Y = Math.Min(p.Vel.Y + Phys.Gravity * dt, Phys.MaxFall);
        p.PrevBottom = p.Bottom;
        MovePlayerY(dt, false);
        if (CompleteTimer > 0.9) p.Hidden = true;
        if (CompleteTimer > 1.2 && CompleteTimer - dt <= 1.2)
            for (int k = 0; k < 30; k++)
                Spawn(new Vector2((float)(Goal.x * T + T / 2), (float)(Goal.y * T - 60)), new Vector2(Rand(-260, 260), Rand(-420, -80)), 1.4f, 5,
                    Art.Mix(new Color(255, 200, 60, 255), new Color(120, 220, 255, 255), Rand(0, 1)), true, 1);
        if (CompleteTimer > 2.4 && CompleteTimer - dt <= 2.4) LevelCompleted?.Invoke();
    }

    public void HurtPlayer()
    {
        var p = Player;
        if (p.Invuln > 0 || p.Dead || Completed) return;
        if (p.Power > 0 || p.Wings)
        {
            p.Power = 0;
            p.Wings = false;
            p.Invuln = 2;
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
        p.Vel = new Vec(0, -700);
        Audio.PlayMusic(-1);
        Audio.Play(Sfx.Die);
        Shake = 0.3f;
    }

    private void UpdateDeadPlayer(double dt)
    {
        var p = Player;
        p.DeadTimer += dt;
        if (p.DeadTimer < 0.4) return;
        p.Vel.Y = Math.Min(p.Vel.Y + Phys.Gravity * 0.6 * dt, Phys.MaxFall);
        p.Pos.Y += p.Vel.Y * dt;
        if (p.DeadTimer > 2.2 && p.DeadTimer - dt <= 2.2) PlayerDied?.Invoke();
    }

    // ------------------------------------------------------------------ crumbles
    private void UpdateCrumbles(double dt)
    {
        foreach (var key in _crumbleTimer.Keys.ToList())
        {
            double t = _crumbleTimer[key] - dt;
            if (t > 0) { _crumbleTimer[key] = t; continue; }
            _crumbleTimer.Remove(key);
            _crumbleFallen[key] = 4;
            Audio.Play(Sfx.Crumble);
            for (int i = 0; i < 5; i++)
                Spawn(new Vector2((float)(key.Item1 * T) + Rand(6, 42), (float)(key.Item2 * T) + Rand(4, 24)), new Vector2(Rand(-40, 40), Rand(0, 100)), 1f, 8,
                    Art.Mix(Theme.Brick, Color.White, 0.3f), true, 1);
        }

        foreach (var key in _crumbleFallen.Keys.ToList())
        {
            double t = _crumbleFallen[key] - dt;
            _crumbleFallen[key] = t;
            if (t > 0) continue;
            if (new Box(key.Item1 * T, key.Item2 * T, T, T).Overlaps(Player.Rect)) continue;
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
    public float CrumbleShake(int x, int y) => _crumbleTimer.TryGetValue((x, y), out var t) ? 0.45f - (float)t : 0;
    public float SpringCompress(int x, int y) => _springAnim.TryGetValue((x, y), out var t) ? MathF.Sin((float)t / 0.3f * MathF.PI) : 0;

    // ------------------------------------------------------------------ enemies
    private void UpdateEnemies(double dt)
    {
        double activeL = CamX - 2 * T, activeR = CamX + Phys.View + 2 * T;
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
                if (e.DeathTimer > 0.5) Enemies.RemoveAt(i);
                continue;
            }
            if (e.Flipped)
            {
                e.Vel.Y += Phys.Gravity * dt;
                e.Pos.X += e.Vel.X * dt;
                e.Pos.Y += e.Vel.Y * dt;
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
                            double dx = Player.Pos.X + Phys.PlayerW / 2 - (e.Pos.X + e.W / 2);
                            if (Math.Abs(dx) < 8 * T) e.Facing = dx > 0 ? 1 : -1;
                            e.Vel = new Vec(e.Facing * 150, -640);
                            e.HopTimer = 1.1;
                            e.OnGround = false;
                        }
                    }
                    MoveEnemy(e, dt, false);
                    break;
                case EnemyKind.Bird:
                    double nx = e.Origin.X + DetMath.Sin(e.T * 0.9) * 2.2 * T;
                    double ny = e.Origin.Y + DetMath.Sin(e.T * 2.4) * 0.5 * T;
                    e.Facing = nx > e.Pos.X ? 1 : -1;
                    e.Pos = new Vec(nx, ny);
                    break;
            }

            if (e.Pos.Y > H * T + 100) { Enemies.RemoveAt(i); continue; }
            if (!Player.Dead && !Completed) PlayerVsEnemy(e);
        }
    }

    private bool BlocksEnemy(int x, int y) => Solid(x, y) || At(x, y) is '^' or '~';

    private void MoveEnemy(Enemy e, double dt, bool turnAtEdges)
    {
        e.Vel.Y = Math.Min(e.Vel.Y + Phys.Gravity * dt, Phys.MaxFall);
        // horizontal
        e.Pos.X += e.Vel.X * dt;
        int y0 = Floor(e.Pos.Y / T), y1 = Floor((e.Pos.Y + e.H - 0.01) / T);
        if (e.Vel.X > 0)
        {
            int x = Floor((e.Pos.X + e.W) / T);
            for (int y = y0; y <= y1; y++)
                if (BlocksEnemy(x, y) || x >= W) { e.Pos.X = x * T - e.W; e.Facing = -1; if (e.Kind == EnemyKind.Hopper) e.Vel.X = -e.Vel.X; break; }
        }
        else if (e.Vel.X < 0)
        {
            int x = Floor(e.Pos.X / T);
            for (int y = y0; y <= y1; y++)
                if (BlocksEnemy(x, y) || x < 0) { e.Pos.X = (x + 1) * T; e.Facing = 1; if (e.Kind == EnemyKind.Hopper) e.Vel.X = -e.Vel.X; break; }
        }

        // vertical
        double prevBottom = e.Pos.Y + e.H;
        e.Pos.Y += e.Vel.Y * dt;
        e.OnGround = false;
        int x0 = Floor((e.Pos.X + 2) / T), x1 = Floor((e.Pos.X + e.W - 2) / T);
        if (e.Vel.Y >= 0)
        {
            int y = Floor((e.Pos.Y + e.H) / T);
            for (int x = x0; x <= x1; x++)
            {
                if (Solid(x, y) || (At(x, y) == '-' && prevBottom <= y * T + 0.5))
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
            int y = Floor(e.Pos.Y / T);
            for (int x = x0; x <= x1; x++)
                if (Solid(x, y)) { e.Pos.Y = (y + 1) * T; e.Vel.Y = 0; break; }
        }

        if (turnAtEdges && e.OnGround)
        {
            int fx = Floor((e.Facing > 0 ? e.Pos.X + e.W + 1 : e.Pos.X - 1) / T);
            int fy = Floor((e.Pos.Y + e.H + 1) / T);
            if (!Solid(fx, fy) && At(fx, fy) != '-') e.Facing = -e.Facing;
        }
    }

    private void PlayerVsEnemy(Enemy e)
    {
        var p = Player;
        if (!p.Rect.Overlaps(new Box(e.Pos.X + 4, e.Pos.Y + 4, e.W - 8, e.H - 4))) return;

        bool fromAbove = p.Vel.Y > 0 && p.PrevBottom <= e.Pos.Y + 14;
        if (fromAbove && e.Stompable)
        {
            StompCombo++;
            int pts = 100 * Math.Min(StompCombo, 8);
            Score += pts;
            Texts.Add(new FloatText { Pos = new Vector2((float)(e.Pos.X + e.W / 2), (float)e.Pos.Y), Text = pts.ToString() });
            p.Vel.Y = -(_in.JumpHeld ? Phys.StompBounceHeld : Phys.StompBounce);
            p.Pos.Y = e.Pos.Y - Phys.PlayerH;
            Audio.Play(Sfx.Stomp);
            for (int i = 0; i < 8; i++)
                Spawn(new Vector2((float)(e.Pos.X + e.W / 2), (float)(e.Pos.Y + e.H / 2)), new Vector2(Rand(-160, 160), Rand(-200, 0)), 0.5f, 4, new Color(255, 255, 255, 220), true);
            if (e.Kind == EnemyKind.Bird) KnockEnemy(e, p.Facing);
            else { e.Squashed = true; e.DeathTimer = 0; }
        }
        else HurtPlayer();
    }

    public void KnockEnemy(Enemy e, int dir)
    {
        if (!e.Alive) return;
        e.Flipped = true;
        e.Vel = new Vec(dir * 140, -480);
        Score += 200;
        Texts.Add(new FloatText { Pos = new Vector2((float)(e.Pos.X + e.W / 2), (float)e.Pos.Y), Text = "200" });
        Audio.Play(Sfx.Kick);
    }

    // ------------------------------------------------------------------ icicles
    private void UpdateIcicles(double dt)
    {
        var p = Player;
        foreach (var ic in Icicles)
        {
            switch (ic.State)
            {
                case 0:
                    double pcx = p.Pos.X + Phys.PlayerW / 2;
                    if (!p.Dead && pcx > ic.Pos.X - 1.2 * T && pcx < ic.Pos.X + 2.2 * T && p.Pos.Y > ic.Pos.Y)
                    {
                        ic.State = 1;
                        ic.Timer = 0.45;
                    }
                    break;
                case 1:
                    ic.Timer -= dt;
                    if (ic.Timer <= 0) ic.State = 2;
                    break;
                case 2:
                    ic.Vy = Math.Min(ic.Vy + 1800 * dt, 1100);
                    ic.Pos.Y += ic.Vy * dt;
                    int tx = Floor((ic.Pos.X + T / 2) / T), ty = Floor((ic.Pos.Y + 40) / T);
                    if (Solid(tx, ty) || OneWay(tx, ty) || ic.Pos.Y > H * T)
                    {
                        ic.State = 3;
                        Audio.Play(Sfx.Break);
                        for (int i = 0; i < 8; i++)
                            Spawn(new Vector2((float)(ic.Pos.X + T / 2), (float)(ic.Pos.Y + 36)), new Vector2(Rand(-180, 180), Rand(-300, -80)), 0.7f, 5, new Color(190, 230, 255, 255), true, 1);
                    }
                    foreach (var e in Enemies)
                        if (e.Alive && ic.Rect.Overlaps(e.Rect)) KnockEnemy(e, 1);
                    break;
            }
            if (ic.State < 3 && !p.Dead && p.Rect.Overlaps(ic.Rect)) HurtPlayer();
        }
    }

    // ------------------------------------------------------------------ items / projectiles
    private void UpdateItems(double dt)
    {
        for (int i = Items.Count - 1; i >= 0; i--)
        {
            var it = Items[i];
            it.T += dt;
            if (it.Emerge > 0)
            {
                it.Emerge -= dt;
                it.Pos.Y -= T / 0.5 * dt;
                continue;
            }
            if (it.Kind == ItemKind.Snowflake) continue; // floats in place

            it.Vel.Y = Math.Min(it.Vel.Y + Phys.Gravity * 0.8 * dt, Phys.MaxFall);
            it.Pos.X += it.Vel.X * dt;
            if (Solid(Floor((it.Pos.X + Sign(it.Vel.X) * 16) / T), Floor(it.Pos.Y / T))) it.Vel.X = -it.Vel.X;
            it.Pos.Y += it.Vel.Y * dt;
            int by = Floor((it.Pos.Y + 16) / T), bx = Floor(it.Pos.X / T);
            if (it.Vel.Y > 0 && (Solid(bx, by) || OneWay(bx, by)))
            {
                it.Pos.Y = by * T - 16;
                it.Vel.Y = it.Kind == ItemKind.Wing ? -420 : 0;
            }
            if (it.Pos.Y > H * T + 50) Items.RemoveAt(i);
        }
    }

    private void UpdateSnowballs(double dt)
    {
        for (int i = Snowballs.Count - 1; i >= 0; i--)
        {
            var s = Snowballs[i];
            s.Life -= dt;
            s.Vel.Y = Math.Min(s.Vel.Y + 1600 * dt, 900);
            s.Pos.X += s.Vel.X * dt;
            bool dead = s.Life <= 0 || s.Pos.Y > H * T;
            if (Solid(Floor((s.Pos.X + Sign(s.Vel.X) * 9) / T), Floor(s.Pos.Y / T))) dead = true;
            s.Pos.Y += s.Vel.Y * dt;
            int bx = Floor(s.Pos.X / T), by = Floor((s.Pos.Y + 9) / T);
            if (s.Vel.Y > 0 && (Solid(bx, by) || OneWay(bx, by)))
            {
                s.Pos.Y = by * T - 9;
                s.Vel.Y = -380;
            }
            foreach (var e in Enemies)
            {
                if (!e.Alive || !e.Active) continue;
                if (s.Rect.Overlaps(e.Rect)) { KnockEnemy(e, s.Vel.X >= 0 ? 1 : -1); dead = true; break; }
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

    private void UpdateCamera(double dt)
    {
        if (Player.Dead) return;
        double target = Player.Pos.X + Phys.PlayerW / 2 - Phys.View * 0.4 + Player.Facing * 60;
        CamX += (target - CamX) * Math.Min(1, dt * 5);
        CamX = Math.Max(0, Math.Min(Math.Max(0, W * T - Phys.View), CamX));
    }

    // ------------------------------------------------------------------ helpers
    private static readonly Random Rng = new();
    public static float Rand(float a, float b) => a + (float)Rng.NextDouble() * (b - a);

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
            var c = new Vector2((float)(s.Tx * T + T / 2), (float)(s.Ty * T + T / 2));
            if (Vector2.Distance(c, Player.Center) < 110) return s;
        }
        return null;
    }

    /// <summary>Hash of the gameplay state, used by the cross-language determinism test.</summary>
    public string StateHash()
    {
        static string B(double d) => BitConverter.DoubleToInt64Bits(d).ToString("x16");
        var p = Player;
        var sb = new System.Text.StringBuilder();
        sb.Append($"{TimeTicks} {Score} {Coins} {(Completed ? 1 : 0)} {(p.Dead ? 1 : 0)} {B(p.Pos.X)} {B(p.Pos.Y)} {B(p.Vel.X)} {B(p.Vel.Y)} {B(CamX)} {Enemies.Count}");
        foreach (var e in Enemies) sb.Append($" {B(e.Pos.X)},{B(e.Pos.Y)}");
        return sb.ToString();
    }
}
