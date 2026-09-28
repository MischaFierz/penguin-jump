using System.Numerics;
using Platformer.Core;
using Raylib_cs;

namespace Platformer.Game;

/// <summary>Draws a Stage (world + HUD).</summary>
public static class StageView
{
    private const float T = Phys.Tile;

    public static void Draw(Stage s, int lives)
    {
        var th = s.Theme;
        Art.Background(th, s.CamX, s.Clock);
        WeatherParticles(th, s.CamX, s.Clock);

        float shake = s.Shake > 0 ? MathF.Sin(s.Clock * 90) * 5 * (s.Shake / 0.3f) : 0;
        var cam = new Camera2D { Offset = new Vector2(-MathF.Round(s.CamX) + shake, 0), Zoom = 1 };
        Raylib.BeginMode2D(cam);

        int x0 = Math.Max(0, (int)(s.CamX / T) - 2), x1 = Math.Min(s.W - 1, (int)((s.CamX + Ui.Width) / T) + 2);

        // igloo behind everything else
        Art.Igloo(s.Goal.x * T, s.Goal.y * T, s.Clock);

        for (int x = x0; x <= x1; x++)
        for (int y = 0; y < s.H; y++)
        {
            char c = s.At(x, y);
            float px = x * T, py = y * T;
            switch (c)
            {
                case '#':
                    Art.Ground(x, y, th, s.At(x, y - 1) != '#' && y > 0 || (y == 0 && !th.Ceiling), s.At(x - 1, y) != '#' && x > 0, s.At(x + 1, y) != '#' && x < s.W - 1);
                    break;
                case 'B': Art.Brick(px, py + s.BumpOffset(x, y), th); break;
                case '?' or 'F' or 'S' or 'W' or 'H': Art.PrizeBlock(px, py + s.BumpOffset(x, y), s.Clock, false); break;
                case 'E': Art.PrizeBlock(px, py + s.BumpOffset(x, y), s.Clock, true); break;
                case 'x': if (!s.CrumbleFallen(x, y)) Art.Crumble(px, py, s.CrumbleShake(x, y), th); break;
                case '-': Art.OneWay(px, py, th, s.At(x - 1, y) != '-', s.At(x + 1, y) != '-'); break;
                case '^': Art.Spikes(px, py, th); break;
                case '~': Art.Liquid(px, py, s.At(x, y - 1) != '~', th, s.Clock); break;
                case 'o': Art.Coin(new Vector2(px + T / 2, py + T / 2), s.Clock); break;
                case '*': Art.Spring(px, py, s.SpringCompress(x, y)); break;
            }
        }

        foreach (var sg in s.Signs) Art.Sign(sg.Tx * T, sg.Ty * T);
        foreach (var cp in s.Checkpoints) Art.Checkpoint(cp.Tx * T, cp.Ty * T, cp.Active, s.Clock);
        foreach (var mp in s.Platforms) Art.MovingPlatform(mp.Pos.X, mp.Pos.Y, mp.WidthTiles, th);

        foreach (var cp in s.CoinPops)
            Art.Coin(cp.Pos + new Vector2(0, -20 - MathF.Sin(cp.T / 0.5f * MathF.PI) * 60), s.Clock * 3, 1 - cp.T);

        foreach (var it in s.Items)
        {
            switch (it.Kind)
            {
                case ItemKind.Fish: Art.Fish(it.Pos, it.T); break;
                case ItemKind.Snowflake: Art.Snowflake(it.Pos + new Vector2(0, MathF.Sin(it.T * 3) * 4), it.T); break;
                case ItemKind.Wing: Art.WingItem(it.Pos, it.T); break;
                case ItemKind.Heart: Art.Heart(it.Pos, 1 + MathF.Sin(it.T * 8) * 0.08f); break;
            }
        }

        foreach (var e in s.Enemies)
        {
            var bc = e.BottomCenter;
            if (e.Flipped)
            {
                // draw upside down by mirroring around the center
                Raylib.DrawEllipse((int)bc.X, (int)(bc.Y - e.H / 2), e.W / 2, e.H / 2, Art.Fade(Color.Black, 0.2f));
            }
            switch (e.Kind)
            {
                case EnemyKind.Walker: Art.Walker(bc, e.Facing, e.T, e.Squashed, e.Flipped ? new Color(150, 110, 200, 255) : new Color(170, 120, 230, 255)); break;
                case EnemyKind.Spiky: Art.Spiky(bc, e.Facing, e.T); break;
                case EnemyKind.Bird: Art.Bird(new Vector2(bc.X, bc.Y - e.H / 2), e.Facing, e.T); break;
                case EnemyKind.Hopper: Art.Hopper(bc, e.Facing, e.T, !e.OnGround); break;
            }
            if (e.Flipped) DrawStars(bc - new Vector2(0, e.H + 6), s.Clock);
        }

        foreach (var ic in s.Icicles)
            if (ic.State < 3) Art.Icicle(ic.Pos.X, ic.Pos.Y, ic.State == 1 ? ic.Timer : 0);

        // player
        var p = s.Player;
        if (!p.Hidden)
        {
            bool blink = p.Invuln > 0 && (int)(p.Invuln * 20) % 2 == 0;
            if (!blink)
            {
                float speed01 = MathF.Min(1, MathF.Abs(p.Vel.X) / Phys.Walk);
                Art.Penguin(p.Pos.X + Phys.PlayerW / 2, p.Pos.Y + Phys.PlayerH, p.Facing, p.Anim, speed01, !p.OnGround, p.Vel.Y,
                    p.Dead ? 0 : p.Power, p.Wings && !p.Dead, 1, p.Dead);
            }
        }

        foreach (var sb in s.Snowballs)
        {
            Raylib.DrawCircleV(sb.Pos + new Vector2(2, 3), 10, new Color(0, 0, 0, 60));
            Raylib.DrawCircleV(sb.Pos, 10, new Color(250, 252, 255, 255));
            Raylib.DrawCircleV(sb.Pos + new Vector2(-3, -3), 4, new Color(200, 225, 255, 255));
        }

        foreach (var pt in s.Particles)
        {
            var col = Art.Fade(pt.Color, pt.Life / pt.MaxLife);
            if (pt.Shape == 1) Raylib.DrawRectanglePro(new Rectangle(pt.Pos.X, pt.Pos.Y, pt.Size, pt.Size), new Vector2(pt.Size / 2, pt.Size / 2), pt.Life * 400, col);
            else Raylib.DrawCircleV(pt.Pos, pt.Size, col);
        }

        foreach (var ft in s.Texts)
            Ui.Text(ft.Text, ft.Pos.X, ft.Pos.Y, 26, Art.Fade(ft.Color, MathF.Min(1, ft.Life * 2)), Align.Center);

        // tutorial sign bubble
        var sign = s.NearbySign();
        if (sign != null && !string.IsNullOrEmpty(sign.Key)) SignBubble(Loc.T(sign.Key), sign.Tx * T + T / 2, sign.Ty * T - 12, s.CamX);

        Raylib.EndMode2D();

        Hud(s, lives);
    }

    private static void DrawStars(Vector2 c, float t)
    {
        for (int i = 0; i < 3; i++)
        {
            float a = t * 5 + i * MathF.Tau / 3;
            Art.Star(c + new Vector2(MathF.Cos(a) * 14, MathF.Sin(a) * 5), 5, 2.2f, new Color(255, 230, 90, 255));
        }
    }

    private static void SignBubble(string text, float cx, float bottomY, float camX)
    {
        const float size = 24, maxW = 420;
        var lines = Ui.Wrap(text, size, maxW);
        float w = lines.Max(l => Ui.Measure(l, size).X) + 36;
        float h = lines.Count * size * 1.2f + 24;
        float x = Math.Clamp(cx - w / 2, camX + 10, camX + Ui.Width - w - 10);
        float y = bottomY - h - 14;
        var r = new Rectangle(x, y, w, h);
        Raylib.DrawRectangleRounded(new Rectangle(r.X + 4, r.Y + 5, r.Width, r.Height), 0.25f, 8, new Color(0, 0, 0, 70));
        Raylib.DrawRectangleRounded(r, 0.25f, 8, new Color(255, 252, 240, 250));
        Raylib.DrawRectangleRoundedLinesEx(r, 0.25f, 8, 3, new Color(120, 80, 50, 255));
        Art.Tri(new Vector2(cx - 10, y + h - 1), new Vector2(cx + 10, y + h - 1), new Vector2(cx, y + h + 12), new Color(255, 252, 240, 250));
        for (int i = 0; i < lines.Count; i++)
            Ui.Text(lines[i], x + w / 2, y + 12 + i * size * 1.2f, size, Ui.Ink, Align.Center, shadow: false);
    }

    private static void WeatherParticles(Theme th, float camX, float t)
    {
        int n = th.Weather switch { 0 => 60, 2 => 40, 1 => 25, _ => 45 };
        for (int i = 0; i < n; i++)
        {
            float speed = 30 + Art.Hash(i) * 50;
            float x = (Art.Hash(i * 7) * 1400 - camX * (0.3f + Art.Hash(i * 3) * 0.5f) + MathF.Sin(t + i) * 20) % 1400;
            if (x < 0) x += 1400;
            x -= 60;
            if (th.Weather == 3)
            {
                float y = 720 - (Art.Hash(i * 11) * 720 + t * speed * 1.5f) % 760;
                Raylib.DrawCircleV(new Vector2(x, y), 1.5f + Art.Hash(i * 5) * 2, new Color(255, (int)(140 + Art.Hash(i) * 80), 60, 200));
            }
            else if (th.Weather == 1)
            {
                float y = (Art.Hash(i * 11) * 720 + MathF.Sin(t * 0.5f + i) * 30) % 720;
                Raylib.DrawCircleV(new Vector2(x, y), 1.5f + MathF.Sin(t * 3 + i) * 1f, new Color(200, 180, 255, 160));
            }
            else
            {
                float y = (Art.Hash(i * 11) * 760 + t * speed) % 760 - 20;
                Raylib.DrawCircleV(new Vector2(x, y), 1.5f + Art.Hash(i * 5) * 2.5f, new Color(255, 255, 255, 200));
            }
        }
    }

    private static void Hud(Stage s, int lives)
    {
        // left: lives + coins + power
        Raylib.DrawRectangleRounded(new Rectangle(12, 10, 300, 56), 0.4f, 8, new Color(10, 20, 45, 170));
        Art.PenguinHead(new Vector2(40, 38), 1.1f);
        Ui.Text($"× {Math.Max(0, lives)}", 60, 22, 30, Color.White);
        Art.Coin(new Vector2(150, 38), 0, 0.8f);
        Ui.Text($"× {s.Coins}", 168, 22, 30, Color.White);
        float px = 262;
        if (s.Player.Power >= 1)
        {
            Raylib.DrawRectangleRounded(new Rectangle(px - 16, 24, 32, 10), 1, 4, s.Player.Power == 2 ? new Color(120, 220, 255, 255) : new Color(230, 50, 60, 255));
            px += 30;
        }
        if (s.Player.Wings) Art.WingItem(new Vector2(px, 38), s.Clock);

        // center: level name
        string title = $"{Loc.T("world." + s.Data.World)}  {s.Data.Id}";
        var tw = Ui.Measure(title, 26).X;
        Raylib.DrawRectangleRounded(new Rectangle(640 - tw / 2 - 20, 10, tw + 40, 44), 0.5f, 8, new Color(10, 20, 45, 170));
        Ui.Text(title, 640, 19, 26, Color.White, Align.Center);

        // right: score + time
        Raylib.DrawRectangleRounded(new Rectangle(Ui.Width - 322, 10, 310, 56), 0.4f, 8, new Color(10, 20, 45, 170));
        Ui.Text(Loc.T("hud.score"), Ui.Width - 306, 14, 18, new Color(170, 200, 240, 255));
        Ui.Text(s.Score.ToString("D6"), Ui.Width - 306, 32, 28, Color.White);
        Ui.Text(Loc.T("hud.time"), Ui.Width - 24, 14, 18, new Color(170, 200, 240, 255), Align.Right);
        Ui.Text(FormatTime(s.Time), Ui.Width - 24, 32, 28, Color.White, Align.Right);

        // power-up / info message
        if (s.MessageTimer > 0 && s.Message != null)
        {
            float a = MathF.Min(1, s.MessageTimer * 2);
            float w = MathF.Min(900, Ui.Measure(s.Message, 26).X + 50);
            float h = Ui.TextBlockHeight(s.Message, 26, w - 40) + 22;
            var r = new Rectangle(640 - w / 2, 78, w, h);
            Raylib.DrawRectangleRounded(r, 0.4f, 8, Art.Fade(new Color(255, 196, 64, 255), a * 0.95f));
            var lines = Ui.Wrap(s.Message, 26, w - 40);
            for (int i = 0; i < lines.Count; i++)
                Ui.Text(lines[i], 640, r.Y + 11 + i * 26 * 1.2f, 26, Art.Fade(Ui.Ink, a), Align.Center, shadow: false);
        }
    }

    public static string FormatTime(float seconds)
    {
        int s = (int)seconds;
        return $"{s / 60}:{s % 60:D2}";
    }
}
