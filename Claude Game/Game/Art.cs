using System.Numerics;
using Raylib_cs;

namespace Platformer.Game;

public sealed record Theme(
    Color SkyTop, Color SkyBottom, Color Far, Color Near, Color GroundCap, Color GroundFill, Color GroundDark,
    Color Brick, Color Liquid, Color LiquidTop, bool Ceiling, int Weather);

/// <summary>All graphics are drawn with shapes - no image files.</summary>
public static class Art
{
    public const int T = 48;

    public static Theme ThemeFor(int world) => world switch
    {
        2 => new Theme(new(24, 16, 48, 255), new(58, 34, 92, 255), new(44, 30, 78, 255), new(66, 44, 110, 255),
            new(170, 150, 255, 255), new(70, 58, 110, 255), new(46, 36, 78, 255), new(120, 190, 255, 255),
            new(40, 90, 150, 255), new(110, 180, 240, 255), true, 1),
        3 => new Theme(new(8, 12, 40, 255), new(28, 50, 96, 255), new(34, 52, 92, 255), new(48, 72, 120, 255),
            new(240, 248, 255, 255), new(70, 84, 120, 255), new(44, 54, 84, 255), new(150, 210, 255, 255),
            new(30, 60, 120, 255), new(120, 180, 255, 255), false, 2),
        4 => new Theme(new(40, 8, 8, 255), new(120, 36, 16, 255), new(70, 20, 16, 255), new(96, 32, 20, 255),
            new(90, 70, 70, 255), new(58, 40, 44, 255), new(36, 24, 28, 255), new(160, 110, 100, 255),
            new(240, 90, 20, 255), new(255, 200, 60, 255), true, 3),
        _ => new Theme(new(110, 180, 245, 255), new(210, 236, 255, 255), new(170, 200, 235, 255), new(130, 175, 220, 255),
            new(250, 252, 255, 255), new(96, 130, 180, 255), new(70, 96, 140, 255), new(150, 210, 250, 255),
            new(40, 110, 170, 255), new(150, 210, 250, 255), false, 0),
    };

    /// <summary>raylib only draws counter-clockwise triangles; this accepts any winding.</summary>
    public static void Tri(Vector2 a, Vector2 b, Vector2 c, Color col)
    {
        float cross = (b.X - a.X) * (c.Y - a.Y) - (b.Y - a.Y) * (c.X - a.X);
        if (cross > 0) (b, c) = (c, b);
        Raylib.DrawTriangle(a, b, c, col);
    }

    public static Color Fade(Color c, float a) => new(c.R, c.G, c.B, (byte)(c.A * Math.Clamp(a, 0, 1)));
    public static Color Mix(Color a, Color b, float t) => new(
        (byte)(a.R + (b.R - a.R) * t), (byte)(a.G + (b.G - a.G) * t), (byte)(a.B + (b.B - a.B) * t), (byte)(a.A + (b.A - a.A) * t));

    // ---------------------------------------------------------------- background
    public static void Background(Theme th, float camX, float time, int screenW = 1280, int screenH = 720)
    {
        Raylib.DrawRectangleGradientV(0, 0, screenW, screenH, th.SkyTop, th.SkyBottom);

        if (th.Weather == 2) // aurora + stars
        {
            for (int i = 0; i < 70; i++)
            {
                float sx = (i * 137.5f - camX * 0.05f) % screenW; if (sx < 0) sx += screenW;
                float sy = (i * 71.3f) % 380;
                float tw = 0.5f + 0.5f * MathF.Sin(time * 2 + i);
                Raylib.DrawCircleV(new Vector2(sx, sy), 1.2f + tw, Fade(Color.White, 0.4f + tw * 0.6f));
            }
            for (int band = 0; band < 3; band++)
            {
                var col = band == 1 ? new Color(160, 90, 255, 255) : new Color(80, 255, 170, 255);
                for (int x = 0; x < screenW; x += 8)
                {
                    float y = 120 + band * 50 + MathF.Sin((x + camX * 0.1f) * 0.006f + time * 0.6f + band) * 40;
                    float h = 60 + MathF.Sin(x * 0.02f + time + band * 2) * 30;
                    Raylib.DrawRectangleGradientV(x, (int)y, 8, (int)h, Fade(col, 0.22f), Fade(col, 0));
                }
            }
        }
        else if (th.Weather == 0) // sun + clouds
        {
            Raylib.DrawCircle(1040, 110, 60, new Color(255, 250, 220, 120));
            Raylib.DrawCircle(1040, 110, 44, new Color(255, 250, 230, 255));
            for (int i = 0; i < 6; i++)
            {
                float cx = ((i * 330 - camX * 0.12f + time * 8) % (screenW + 300) + screenW + 300) % (screenW + 300) - 150;
                float cy = 70 + (i * 53) % 150;
                Cloud(cx, cy, 1 + (i % 3) * 0.3f);
            }
        }
        else if (th.Weather is 1 or 3) // cave glow
        {
            var glow = th.Weather == 1 ? new Color(150, 120, 255, 255) : new Color(255, 120, 40, 255);
            for (int i = 0; i < 5; i++)
            {
                float gx = ((i * 400 - camX * 0.15f) % 1600 + 1600) % 1600 - 160;
                Raylib.DrawCircleGradient(new Vector2(gx, 360 + (i % 2) * 120), 220, Fade(glow, 0.15f), Fade(glow, 0));
            }
        }

        // far mountains
        Mountains(camX * 0.2f, 470, 180, 260, th.Far, time, th.Weather == 0 || th.Weather == 2, screenW, screenH);
        // near hills
        Hills(camX * 0.45f, 560, th.Near, screenW, screenH, th.Weather);
    }

    private static void Cloud(float x, float y, float s)
    {
        var c = new Color(255, 255, 255, 220);
        Raylib.DrawCircleV(new Vector2(x, y), 26 * s, c);
        Raylib.DrawCircleV(new Vector2(x + 30 * s, y - 12 * s), 32 * s, c);
        Raylib.DrawCircleV(new Vector2(x + 64 * s, y), 24 * s, c);
        Raylib.DrawRectangleRounded(new Rectangle(x - 20 * s, y, 104 * s, 24 * s), 1, 8, c);
    }

    private static void Mountains(float offset, float baseY, float spacing, float height, Color c, float time, bool snowCaps, int w, int h)
    {
        float start = -(offset % spacing) - spacing;
        int idx = (int)MathF.Floor(offset / spacing);
        for (float x = start; x < w + spacing; x += spacing, idx++)
        {
            float hh = height * (0.6f + 0.4f * Hash(idx));
            var top = new Vector2(x + spacing * 0.5f, baseY - hh);
            var l = new Vector2(x - spacing * 0.3f, baseY + 40);
            var r = new Vector2(x + spacing * 1.3f, baseY + 40);
            Tri(top, l, r, c);
            if (snowCaps)
            {
                var t1 = Vector2.Lerp(top, l, 0.25f); var t2 = Vector2.Lerp(top, r, 0.25f);
                Tri(top, t1, t2, new Color(245, 250, 255, 230));
            }
        }
        Raylib.DrawRectangle(0, (int)baseY + 39, w, h - (int)baseY, c);
    }

    private static void Hills(float offset, float baseY, Color c, int w, int h, int weather)
    {
        for (int x = 0; x <= w; x += 6)
        {
            float wx = x + offset;
            float y = baseY + MathF.Sin(wx * 0.004f) * 40 + MathF.Sin(wx * 0.011f) * 18;
            Raylib.DrawRectangle(x, (int)y, 6, h - (int)y, c);
        }
        if (weather == 0 || weather == 2)
        {
            // pine trees
            for (int i = -1; i < 12; i++)
            {
                float tx = i * 140 - (offset % 140);
                int id = (int)MathF.Floor(offset / 140) + i;
                if (Hash(id) < 0.4f) continue;
                float wx = tx + offset;
                float ty = baseY + MathF.Sin(wx * 0.004f) * 40 + MathF.Sin(wx * 0.011f) * 18;
                Pine(tx, ty + 10, 0.8f + Hash(id * 3) * 0.5f, Mix(c, Color.Black, 0.25f));
            }
        }
    }

    private static void Pine(float x, float y, float s, Color c)
    {
        Raylib.DrawRectangle((int)(x - 4 * s), (int)(y - 14 * s), (int)(8 * s), (int)(16 * s), Mix(c, Color.Black, 0.3f));
        for (int i = 0; i < 3; i++)
        {
            float yy = y - 12 * s - i * 20 * s;
            float ww = (34 - i * 8) * s;
            Tri(new Vector2(x, yy - 34 * s), new Vector2(x - ww, yy), new Vector2(x + ww, yy), c);
            Tri(new Vector2(x, yy - 34 * s), new Vector2(x - ww * 0.5f, yy - 17 * s), new Vector2(x + ww * 0.5f, yy - 17 * s), new Color(240, 248, 255, 200));
        }
    }

    public static float Hash(int n)
    {
        uint x = (uint)n * 747796405u + 2891336453u;
        x = ((x >> (int)((x >> 28) + 4u)) ^ x) * 277803737u;
        return ((x >> 22) ^ x) % 1000 / 1000f;
    }

    // ---------------------------------------------------------------- tiles
    public static void Ground(int tx, int ty, Theme th, bool capTop, bool edgeL, bool edgeR, float bumpY = 0)
    {
        int x = tx * T, y = ty * T;
        Raylib.DrawRectangle(x, y, T, T, th.GroundFill);
        // texture specks
        float h = Hash(tx * 31 + ty * 17);
        Raylib.DrawCircle(x + 10 + (int)(h * 26), y + 20 + (int)(h * 17) % 20, 4, th.GroundDark);
        Raylib.DrawCircle(x + 34 - (int)(h * 18), y + 36, 3, th.GroundDark);
        if (edgeL) Raylib.DrawRectangle(x, y, 4, T, th.GroundDark);
        if (edgeR) Raylib.DrawRectangle(x + T - 4, y, 4, T, th.GroundDark);
        if (capTop)
        {
            Raylib.DrawRectangle(x, y, T, 12, th.GroundCap);
            for (int i = 0; i < 3; i++) Raylib.DrawCircle(x + 8 + i * 16, y + 12, 7 + (int)(Hash(tx * 7 + i) * 3), th.GroundCap);
            Raylib.DrawRectangle(x, y, T, 3, Mix(th.GroundCap, Color.White, 0.6f));
        }
    }

    public static void Brick(float x, float y, Theme th)
    {
        var c = th.Brick;
        Raylib.DrawRectangleRec(new Rectangle(x, y, T, T), Mix(c, Color.Black, 0.35f));
        Raylib.DrawRectangleRec(new Rectangle(x + 2, y + 2, T - 4, T - 4), c);
        var line = Mix(c, Color.Black, 0.3f);
        Raylib.DrawRectangle((int)x, (int)y + 23, T, 3, line);
        Raylib.DrawRectangle((int)x + 22, (int)y, 3, 24, line);
        Raylib.DrawRectangle((int)x + 10, (int)y + 24, 3, 24, line);
        Raylib.DrawRectangle((int)x + 34, (int)y + 24, 3, 24, line);
        Raylib.DrawRectangle((int)x + 5, (int)y + 5, 12, 4, new Color(255, 255, 255, 140));
    }

    public static void PrizeBlock(float x, float y, float time, bool used)
    {
        if (used)
        {
            Raylib.DrawRectangleRounded(new Rectangle(x, y, T, T), 0.15f, 4, new Color(90, 80, 100, 255));
            Raylib.DrawRectangleRounded(new Rectangle(x + 3, y + 3, T - 6, T - 6), 0.15f, 4, new Color(130, 118, 140, 255));
            return;
        }
        float glow = 0.5f + 0.5f * MathF.Sin(time * 4 + x * 0.01f);
        Raylib.DrawRectangleRounded(new Rectangle(x, y, T, T), 0.15f, 4, new Color(200, 110, 20, 255));
        Raylib.DrawRectangleRounded(new Rectangle(x + 3, y + 3, T - 6, T - 6), 0.15f, 4, Mix(new Color(255, 190, 40, 255), new Color(255, 225, 110, 255), glow));
        // star emblem
        Star(new Vector2(x + T / 2f, y + T / 2f + 1), 15, 6.5f, new Color(255, 255, 255, 240), time * 0.8f);
        Raylib.DrawCircle((int)x + 7, (int)y + 7, 2.5f, new Color(160, 80, 10, 255));
        Raylib.DrawCircle((int)x + T - 7, (int)y + 7, 2.5f, new Color(160, 80, 10, 255));
        Raylib.DrawCircle((int)x + 7, (int)y + T - 7, 2.5f, new Color(160, 80, 10, 255));
        Raylib.DrawCircle((int)x + T - 7, (int)y + T - 7, 2.5f, new Color(160, 80, 10, 255));
    }

    public static void Star(Vector2 c, float r1, float r2, Color col, float rot = 0)
    {
        for (int i = 0; i < 5; i++)
        {
            float a0 = rot + i * MathF.Tau / 5 - MathF.PI / 2;
            float a1 = a0 + MathF.Tau / 10;
            float a2 = a0 - MathF.Tau / 10;
            var p0 = c + new Vector2(MathF.Cos(a0), MathF.Sin(a0)) * r1;
            var p1 = c + new Vector2(MathF.Cos(a1), MathF.Sin(a1)) * r2;
            var p2 = c + new Vector2(MathF.Cos(a2), MathF.Sin(a2)) * r2;
            Tri(p0, p2, c, col);
            Tri(p0, c, p1, col);
        }
    }

    public static void Crumble(float x, float y, float shake, Theme th)
    {
        float ox = shake > 0 ? MathF.Sin(shake * 80) * 2 : 0;
        var c = Mix(th.Brick, Color.White, 0.3f);
        Raylib.DrawRectangleRounded(new Rectangle(x + ox, y, T, T * 0.6f), 0.3f, 4, Mix(c, Color.Black, 0.25f));
        Raylib.DrawRectangleRounded(new Rectangle(x + ox + 2, y + 2, T - 4, T * 0.6f - 6), 0.3f, 4, c);
        var crack = Mix(c, Color.Black, 0.4f);
        Raylib.DrawLineEx(new Vector2(x + ox + 12, y + 3), new Vector2(x + ox + 20, y + 16), 2, crack);
        Raylib.DrawLineEx(new Vector2(x + ox + 20, y + 16), new Vector2(x + ox + 30, y + 10), 2, crack);
        Raylib.DrawLineEx(new Vector2(x + ox + 34, y + 20), new Vector2(x + ox + 40, y + 26), 2, crack);
    }

    public static void OneWay(float x, float y, Theme th, bool left, bool right)
    {
        var wood = th.Weather == 4 ? new Color(90, 70, 60, 255) : new Color(150, 100, 60, 255);
        Raylib.DrawRectangleRounded(new Rectangle(x, y, T, 16), 0.4f, 4, Mix(wood, Color.Black, 0.3f));
        Raylib.DrawRectangleRounded(new Rectangle(x + 1, y + 1, T - 2, 11), 0.4f, 4, wood);
        Raylib.DrawRectangle((int)x, (int)y, T, 4, th.GroundCap);
        if (left) Raylib.DrawRectangle((int)x + 6, (int)y + 14, 6, 10, Mix(wood, Color.Black, 0.3f));
        if (right) Raylib.DrawRectangle((int)x + T - 12, (int)y + 14, 6, 10, Mix(wood, Color.Black, 0.3f));
    }

    public static void MovingPlatform(float x, float y, int widthTiles, Theme th)
    {
        float w = widthTiles * T;
        Raylib.DrawRectangleRounded(new Rectangle(x, y + 3, w, 20), 0.5f, 6, new Color(0, 0, 0, 70));
        Raylib.DrawRectangleRounded(new Rectangle(x, y, w, 20), 0.5f, 6, new Color(70, 90, 130, 255));
        Raylib.DrawRectangleRounded(new Rectangle(x + 2, y + 2, w - 4, 12), 0.5f, 6, new Color(130, 160, 210, 255));
        Raylib.DrawRectangle((int)x + 6, (int)y, (int)w - 12, 4, th.GroundCap);
        for (int i = 0; i < widthTiles; i++)
            Raylib.DrawCircle((int)(x + i * T + T / 2f), (int)y + 12, 3, new Color(60, 70, 100, 255));
    }

    public static void Spikes(float x, float y, Theme th)
    {
        var c = th.Weather == 3 ? new Color(60, 50, 50, 255) : new Color(200, 225, 245, 255);
        var d = Mix(c, Color.Black, 0.35f);
        for (int i = 0; i < 3; i++)
        {
            float sx = x + i * 16;
            Tri(new Vector2(sx + 8, y + 14), new Vector2(sx, y + T), new Vector2(sx + 16, y + T), d);
            Tri(new Vector2(sx + 8, y + 16), new Vector2(sx + 3, y + T), new Vector2(sx + 11, y + T), c);
        }
    }

    public static void Liquid(float x, float y, bool top, Theme th, float time)
    {
        if (!top) { Raylib.DrawRectangleRec(new Rectangle(x, y, T, T), th.Liquid); return; }
        Raylib.DrawRectangleRec(new Rectangle(x, y + 12, T, T - 12), th.Liquid);
        for (int i = 0; i < T; i += 4)
        {
            float wy = y + 10 + MathF.Sin((x + i) * 0.08f + time * 3) * 3;
            Raylib.DrawRectangleRec(new Rectangle(x + i, wy, 4, y + 14 - wy + 2), th.LiquidTop);
        }
        if (th.Weather == 3 && Hash((int)x + (int)(time * 2)) > 0.9f)
            Raylib.DrawCircle((int)x + 24, (int)y + 8, 4, new Color(255, 230, 120, 200));
    }

    public static void Coin(Vector2 c, float time, float scale = 1)
    {
        float w = MathF.Abs(MathF.Cos(time * 4 + c.X * 0.02f));
        float rx = MathF.Max(3, 13 * w) * scale, ry = 16 * scale;
        Raylib.DrawEllipse((int)c.X, (int)c.Y, rx + 2, ry + 2, new Color(170, 110, 10, 255));
        Raylib.DrawEllipse((int)c.X, (int)c.Y, rx, ry, new Color(255, 205, 50, 255));
        Raylib.DrawEllipse((int)c.X, (int)c.Y, rx * 0.55f, ry * 0.6f, new Color(255, 235, 140, 255));
        if (w > 0.5f) Raylib.DrawRectangle((int)(c.X - rx * 0.15f), (int)(c.Y - ry * 0.35f), (int)MathF.Max(2, rx * 0.3f), (int)(ry * 0.7f), new Color(220, 150, 20, 255));
    }

    public static void Spring(float x, float y, float compress)
    {
        float top = y + 14 + compress * 16;
        var coil = new Color(220, 60, 60, 255);
        for (int i = 0; i < 3; i++)
        {
            float yy = top + 8 + i * (T - 8 - (top - y)) / 3f;
            Raylib.DrawRectangleRounded(new Rectangle(x + 10, yy, T - 20, 6), 1, 4, coil);
        }
        Raylib.DrawRectangleRounded(new Rectangle(x + 4, top, T - 8, 10), 0.6f, 4, new Color(240, 240, 250, 255));
        Raylib.DrawRectangleRounded(new Rectangle(x + 6, y + T - 8, T - 12, 8), 0.6f, 4, new Color(90, 90, 110, 255));
    }

    public static void Checkpoint(float x, float y, bool active, float time)
    {
        Raylib.DrawRectangle((int)x + 20, (int)y - 48, 6, 96, new Color(200, 200, 210, 255));
        Raylib.DrawCircle((int)x + 23, (int)y - 50, 6, new Color(255, 210, 60, 255));
        var col = active ? new Color(60, 220, 120, 255) : new Color(200, 70, 70, 255);
        float wave = MathF.Sin(time * 6) * 4;
        float fy = active ? y - 44 : y + 10;
        var p1 = new Vector2(x + 26, fy);
        var p2 = new Vector2(x + 26, fy + 26);
        var p3 = new Vector2(x + 60, fy + 13 + wave);
        Tri(p1, p2, p3, col);
        Raylib.DrawRectangle((int)x + 10, (int)y + 40, 26, 8, new Color(120, 120, 140, 255));
    }

    public static void Igloo(float x, float y, float time)
    {
        // x,y = tile of 'G'. igloo is 3 tiles wide, sits on ground below.
        float cx = x + T / 2f, by = y + T;
        var ice = new Color(240, 248, 255, 255);
        var line = new Color(170, 200, 230, 255);
        Raylib.DrawCircleSector(new Vector2(cx, by), 82, 180, 360, 40, new Color(170, 200, 230, 255));
        Raylib.DrawCircleSector(new Vector2(cx, by), 78, 180, 360, 40, ice);
        for (int i = 1; i < 4; i++)
        {
            float r = 78 - i * 0;
            float yy = by - i * 19;
            float half = MathF.Sqrt(MathF.Max(0, r * r - (by - yy) * (by - yy)));
            Raylib.DrawLineEx(new Vector2(cx - half, yy), new Vector2(cx + half, yy), 2, line);
        }
        for (int i = -2; i <= 2; i++) Raylib.DrawLineEx(new Vector2(cx + i * 28, by - 19), new Vector2(cx + i * 28 + 8, by - 38), 2, line);
        // door
        Raylib.DrawRectangle((int)cx - 22, (int)by - 36, 44, 36, new Color(30, 40, 70, 255));
        Raylib.DrawCircleSector(new Vector2(cx, by - 36), 22, 180, 360, 20, new Color(30, 40, 70, 255));
        Raylib.DrawCircleSector(new Vector2(cx, by - 36), 14, 180, 360, 20, new Color(255, 200, 90, 90));
        // flag
        Raylib.DrawRectangle((int)cx - 2, (int)by - 130, 4, 56, new Color(200, 200, 210, 255));
        float w = MathF.Sin(time * 5) * 4;
        Tri(new Vector2(cx + 2, by - 130), new Vector2(cx + 2, by - 106), new Vector2(cx + 34, by - 118 + w), new Color(255, 196, 64, 255));
    }

    public static void Sign(float x, float y)
    {
        Raylib.DrawRectangle((int)x + 21, (int)y + 20, 6, 28, new Color(120, 80, 50, 255));
        Raylib.DrawRectangleRounded(new Rectangle(x + 4, y + 2, 40, 28), 0.25f, 4, new Color(120, 80, 50, 255));
        Raylib.DrawRectangleRounded(new Rectangle(x + 7, y + 5, 34, 22), 0.25f, 4, new Color(200, 150, 95, 255));
        Raylib.DrawRectangle((int)x + 22, (int)y + 8, 4, 10, new Color(90, 50, 30, 255));
        Raylib.DrawRectangle((int)x + 22, (int)y + 20, 4, 4, new Color(90, 50, 30, 255));
    }

    // ---------------------------------------------------------------- characters
    /// <summary>Draws the penguin. (x, y) = bottom center of the hitbox.</summary>
    public static void Penguin(float x, float y, int facing, float anim, float speed01, bool air, float vy,
        int power, bool wings, float alpha = 1, bool dead = false, float scale = 1)
    {
        var body = Fade(power == 2 ? new Color(30, 60, 110, 255) : new Color(30, 36, 58, 255), alpha);
        var belly = Fade(new Color(250, 250, 255, 255), alpha);
        var orange = Fade(new Color(255, 150, 30, 255), alpha);
        float s = scale;
        float bob = air ? 0 : MathF.Abs(MathF.Sin(anim * 14)) * 3 * speed01;
        float lean = air ? 0 : facing * speed01 * 3;
        var c = new Vector2(x + lean, y - 25 * s - bob);

        // feet
        float step = air ? 0 : MathF.Sin(anim * 14) * 6 * speed01;
        float fy = y - 3;
        if (dead) fy = c.Y + 22 * s;
        Raylib.DrawEllipse((int)(x - 8 * s + step), (int)fy, 9 * s, 4 * s, orange);
        Raylib.DrawEllipse((int)(x + 8 * s - step), (int)fy, 9 * s, 4 * s, orange);

        // wings power-up (feathered wings on the back)
        if (wings)
        {
            float flap = MathF.Sin(anim * (air ? 26 : 6)) * (air ? 0.6f : 0.2f);
            var wc = Fade(new Color(255, 255, 255, 235), alpha);
            for (int side = -1; side <= 1; side += 2)
            {
                var root = c + new Vector2(-facing * 6 * s + side * 6 * s, -6 * s);
                var tip = root + new Vector2(side * 22 * s, -14 * s - flap * 16 * s);
                var tip2 = root + new Vector2(side * 18 * s, 2 * s - flap * 8 * s);
                if (side < 0) Tri(root, tip2, tip, wc); else Tri(root, tip, tip2, wc);
            }
        }

        // body
        Raylib.DrawEllipse((int)c.X, (int)c.Y, 19 * s, 24 * s, body);
        Raylib.DrawEllipse((int)(c.X + facing * 4 * s), (int)(c.Y + 4 * s), 13 * s, 18 * s, belly);

        // flippers
        float flip = air ? (vy < 0 ? -0.9f : 0.6f) : MathF.Sin(anim * 14) * 0.5f * speed01;
        var shoulder = c + new Vector2(-facing * 12 * s, -2 * s);
        var tipF = shoulder + new Vector2(-facing * (8 + flip * 6) * s, (14 - flip * 12) * s);
        Raylib.DrawLineEx(shoulder, tipF, 8 * s, body);
        Raylib.DrawCircleV(tipF, 4 * s, body);

        // eyes
        var eye = c + new Vector2(facing * 7 * s, -11 * s);
        if (dead)
        {
            Raylib.DrawLineEx(eye + new Vector2(-4, -4), eye + new Vector2(4, 4), 2.5f, belly);
            Raylib.DrawLineEx(eye + new Vector2(-4, 4), eye + new Vector2(4, -4), 2.5f, belly);
        }
        else
        {
            Raylib.DrawCircleV(eye, 6 * s, belly);
            Raylib.DrawCircleV(eye + new Vector2(facing * 2 * s, 0), 3.2f * s, Fade(new Color(20, 20, 30, 255), alpha));
            Raylib.DrawCircleV(eye + new Vector2(facing * 3 * s, -1.5f * s), 1.2f * s, belly);
            var eye2 = c + new Vector2(-facing * 3 * s, -11 * s);
            Raylib.DrawCircleV(eye2, 4.5f * s, belly);
            Raylib.DrawCircleV(eye2 + new Vector2(facing * 1.5f * s, 0), 2.5f * s, Fade(new Color(20, 20, 30, 255), alpha));
        }

        // beak
        var bk = c + new Vector2(facing * 14 * s, -5 * s);
        if (facing > 0) Tri(bk + new Vector2(-4, -4) * s, bk + new Vector2(-4, 4) * s, bk + new Vector2(8, 1) * s, orange);
        else Tri(bk + new Vector2(4, -4) * s, bk + new Vector2(-8, 1) * s, bk + new Vector2(4, 4) * s, orange);

        // cheeks
        Raylib.DrawCircleV(c + new Vector2(facing * 12 * s, -2 * s), 3 * s, Fade(new Color(255, 140, 160, 160), alpha));

        // scarf for power-ups
        if (power >= 1)
        {
            var scarf = Fade(power == 2 ? new Color(120, 220, 255, 255) : new Color(230, 50, 60, 255), alpha);
            Raylib.DrawRectangleRounded(new Rectangle(c.X - 16 * s, c.Y + 1 * s, 32 * s, 7 * s), 1, 6, scarf);
            float flutter = MathF.Sin(anim * 10) * 3;
            var sp = new Vector2(c.X - facing * 12 * s, c.Y + 5 * s);
            Raylib.DrawLineEx(sp, sp + new Vector2(-facing * 14 * s, 8 * s + flutter), 6 * s, scarf);
            if (power == 2) Star(c + new Vector2(0, -26 * s), 5 * s, 2.5f * s, Fade(Color.White, alpha), anim * 3);
        }
    }

    public static void Walker(Vector2 bc, int facing, float t, bool squashed, Color col)
    {
        if (squashed)
        {
            Raylib.DrawEllipse((int)bc.X, (int)bc.Y - 6, 22, 7, col);
            return;
        }
        float bob = MathF.Abs(MathF.Sin(t * 10)) * 3;
        var c = new Vector2(bc.X, bc.Y - 17 - bob);
        float step = MathF.Sin(t * 10) * 5;
        var dark = Mix(col, Color.Black, 0.4f);
        Raylib.DrawEllipse((int)(bc.X - 9 + step), (int)bc.Y - 3, 8, 4, dark);
        Raylib.DrawEllipse((int)(bc.X + 9 - step), (int)bc.Y - 3, 8, 4, dark);
        Raylib.DrawEllipse((int)c.X, (int)c.Y, 22, 17, col);
        Raylib.DrawEllipse((int)c.X, (int)c.Y + 6, 15, 8, Mix(col, Color.White, 0.35f));
        var e = c + new Vector2(facing * 7, -5);
        Raylib.DrawCircleV(e + new Vector2(-5, 0), 5, Color.White);
        Raylib.DrawCircleV(e + new Vector2(5, 0), 5, Color.White);
        Raylib.DrawCircleV(e + new Vector2(-5 + facing * 2, 1), 2.5f, Color.Black);
        Raylib.DrawCircleV(e + new Vector2(5 + facing * 2, 1), 2.5f, Color.Black);
        Raylib.DrawLineEx(e + new Vector2(-10, -7), e + new Vector2(-2, -4), 3, dark);
        Raylib.DrawLineEx(e + new Vector2(10, -7), e + new Vector2(2, -4), 3, dark);
    }

    public static void Spiky(Vector2 bc, int facing, float t)
    {
        float bob = MathF.Abs(MathF.Sin(t * 8)) * 2;
        var c = new Vector2(bc.X, bc.Y - 18 - bob);
        var spike = new Color(180, 230, 255, 255);
        for (int i = 0; i < 9; i++)
        {
            float a = MathF.PI + i / 8f * MathF.PI;
            var dir = new Vector2(MathF.Cos(a), MathF.Sin(a));
            var p = c + dir * 30;
            var perp = new Vector2(-dir.Y, dir.X) * 7;
            Tri(p, c + dir * 16 - perp, c + dir * 16 + perp, spike);
        }
        Raylib.DrawEllipse((int)c.X, (int)c.Y, 21, 17, new Color(60, 90, 140, 255));
        Raylib.DrawEllipse((int)(c.X + facing * 10), (int)c.Y + 4, 10, 9, new Color(230, 200, 170, 255));
        Raylib.DrawCircleV(c + new Vector2(facing * 12, -3), 3, Color.Black);
        Raylib.DrawCircleV(c + new Vector2(facing * 20, 4), 3, new Color(40, 20, 20, 255));
        float step = MathF.Sin(t * 8) * 4;
        Raylib.DrawEllipse((int)(bc.X - 8 + step), (int)bc.Y - 3, 6, 3, new Color(40, 50, 80, 255));
        Raylib.DrawEllipse((int)(bc.X + 8 - step), (int)bc.Y - 3, 6, 3, new Color(40, 50, 80, 255));
    }

    public static void Bird(Vector2 c, int facing, float t)
    {
        float flap = MathF.Sin(t * 14);
        var white = new Color(245, 245, 250, 255);
        var grey = new Color(150, 160, 180, 255);
        Tri(c + new Vector2(-4, -2), c + new Vector2(-26, -4 - flap * 18), c + new Vector2(4, -2), grey);
        Tri(c + new Vector2(4, -2), c + new Vector2(-26, -4 - flap * 18), c + new Vector2(-4, -2), grey);
        Raylib.DrawEllipse((int)c.X, (int)c.Y, 20, 12, white);
        Raylib.DrawCircleV(c + new Vector2(facing * 14, -6), 9, white);
        Raylib.DrawCircleV(c + new Vector2(facing * 17, -8), 2.5f, Color.Black);
        var bk = c + new Vector2(facing * 22, -5);
        Tri(bk, bk + new Vector2(facing * 10, 3), bk + new Vector2(0, 5), new Color(255, 190, 40, 255));
        if (facing < 0) Tri(bk, bk + new Vector2(0, 5), bk + new Vector2(facing * 10, 3), new Color(255, 190, 40, 255));
        Tri(c + new Vector2(8, -2), c + new Vector2(30, -14 + flap * 16), c + new Vector2(-8, -2), white);
        Tri(c + new Vector2(-8, -2), c + new Vector2(30, -14 + flap * 16), c + new Vector2(8, -2), white);
    }

    public static void Hopper(Vector2 bc, int facing, float t, bool air)
    {
        var col = new Color(90, 200, 120, 255);
        var c = new Vector2(bc.X, bc.Y - (air ? 22 : 16));
        var dark = Mix(col, Color.Black, 0.35f);
        if (air)
        {
            Raylib.DrawLineEx(c + new Vector2(-10, 8), c + new Vector2(-16, 22), 5, dark);
            Raylib.DrawLineEx(c + new Vector2(10, 8), c + new Vector2(16, 22), 5, dark);
        }
        else
        {
            Raylib.DrawEllipse((int)bc.X - 14, (int)bc.Y - 5, 9, 5, dark);
            Raylib.DrawEllipse((int)bc.X + 14, (int)bc.Y - 5, 9, 5, dark);
        }
        Raylib.DrawEllipse((int)c.X, (int)c.Y, 20, 15, col);
        Raylib.DrawEllipse((int)c.X, (int)c.Y + 5, 13, 8, new Color(220, 250, 200, 255));
        Raylib.DrawCircleV(c + new Vector2(-8, -12), 7, col);
        Raylib.DrawCircleV(c + new Vector2(8, -12), 7, col);
        Raylib.DrawCircleV(c + new Vector2(-8 + facing * 2, -13), 4, Color.White);
        Raylib.DrawCircleV(c + new Vector2(8 + facing * 2, -13), 4, Color.White);
        Raylib.DrawCircleV(c + new Vector2(-7 + facing * 3, -13), 2, Color.Black);
        Raylib.DrawCircleV(c + new Vector2(9 + facing * 3, -13), 2, Color.Black);
    }

    public static void Icicle(float x, float y, float shake)
    {
        float ox = shake > 0 ? MathF.Sin(shake * 90) * 2 : 0;
        Tri(new Vector2(x + 8 + ox, y), new Vector2(x + 24 + ox, y + 44), new Vector2(x + 40 + ox, y), new Color(150, 210, 255, 255));
        Tri(new Vector2(x + 16 + ox, y), new Vector2(x + 24 + ox, y + 30), new Vector2(x + 26 + ox, y), new Color(235, 250, 255, 255));
    }

    public static void Fish(Vector2 c, float t)
    {
        var col = new Color(255, 120, 90, 255);
        Raylib.DrawEllipse((int)c.X, (int)c.Y, 16, 10, col);
        float w = MathF.Sin(t * 12) * 3;
        Tri(c + new Vector2(-12, 0), c + new Vector2(-24, -9 + w), c + new Vector2(-24, 9 + w), col);
        Raylib.DrawCircleV(c + new Vector2(8, -2), 2.5f, Color.Black);
        Raylib.DrawEllipse((int)c.X - 2, (int)c.Y + 3, 8, 3, new Color(255, 200, 170, 255));
    }

    public static void Snowflake(Vector2 c, float t)
    {
        var col = new Color(200, 240, 255, 255);
        Raylib.DrawCircleGradient(new Vector2(c.X, c.Y), 24, new Color(160, 220, 255, 120), new Color(160, 220, 255, 0));
        for (int i = 0; i < 6; i++)
        {
            float a = t * 1.5f + i * MathF.Tau / 6;
            var d = new Vector2(MathF.Cos(a), MathF.Sin(a));
            Raylib.DrawLineEx(c, c + d * 16, 4, col);
            var m = c + d * 10;
            var p = new Vector2(-d.Y, d.X);
            Raylib.DrawLineEx(m, m + (d + p) * 5, 3, col);
            Raylib.DrawLineEx(m, m + (d - p) * 5, 3, col);
        }
        Raylib.DrawCircleV(c, 4, Color.White);
    }

    public static void WingItem(Vector2 c, float t)
    {
        float flap = MathF.Sin(t * 10) * 6;
        var w = new Color(255, 255, 255, 255);
        Raylib.DrawCircleGradient(new Vector2(c.X, c.Y), 26, new Color(255, 240, 180, 120), new Color(255, 240, 180, 0));
        Tri(c, c + new Vector2(-22, -10 - flap), c + new Vector2(-16, 10), w);
        Tri(c, c + new Vector2(16, 10), c + new Vector2(22, -10 - flap), w);
        Raylib.DrawCircleV(c, 6, new Color(255, 210, 80, 255));
    }

    public static void Heart(Vector2 c, float scale = 1, Color? color = null)
    {
        var col = color ?? new Color(255, 70, 110, 255);
        float s = scale;
        Raylib.DrawCircleV(c + new Vector2(-7, -4) * s, 9 * s, col);
        Raylib.DrawCircleV(c + new Vector2(7, -4) * s, 9 * s, col);
        Tri(c + new Vector2(-15.5f, -1) * s, c + new Vector2(0, 16) * s, c + new Vector2(15.5f, -1) * s, col);
        Raylib.DrawCircleV(c + new Vector2(-9, -7) * s, 3 * s, new Color(255, 255, 255, 170));
    }

    public static void PenguinHead(Vector2 c, float s = 1)
    {
        Raylib.DrawCircleV(c, 14 * s, new Color(30, 36, 58, 255));
        Raylib.DrawEllipse((int)c.X + 2, (int)(c.Y + 4 * s), 9 * s, 9 * s, Color.White);
        Raylib.DrawCircleV(c + new Vector2(4, -3) * s, 4 * s, Color.White);
        Raylib.DrawCircleV(c + new Vector2(5, -3) * s, 2 * s, Color.Black);
        Tri(c + new Vector2(8, 0) * s, c + new Vector2(8, 5) * s, c + new Vector2(17, 2) * s, new Color(255, 150, 30, 255));
    }
}
