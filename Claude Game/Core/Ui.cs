using System.Numerics;
using Raylib_cs;

namespace Platformer.Core;

public enum Align { Left, Center, Right }

/// <summary>Text and widget drawing helpers (all coordinates are in the 1280x720 virtual screen).</summary>
public static class Ui
{
    public const int Width = 1280, Height = 720;

    public static readonly Color Ink = new(24, 32, 56, 255);
    public static readonly Color Accent = new(255, 196, 64, 255);
    public static readonly Color PanelBg = new(18, 28, 54, 225);
    public static readonly Color PanelBorder = new(140, 200, 255, 255);

    private static float Spacing(float size) => size * 0.02f;

    public static Vector2 Measure(string text, float size, Font? font = null)
    {
        var f = font ?? Loc.Current.Font;
        return Raylib.MeasureTextEx(f, text, size, Spacing(size));
    }

    public static void Text(string text, float x, float y, float size, Color color, Align align = Align.Left,
        Font? font = null, bool shadow = true)
    {
        var f = font ?? Loc.Current.Font;
        var m = Raylib.MeasureTextEx(f, text, size, Spacing(size));
        float dx = align switch { Align.Center => -m.X / 2, Align.Right => -m.X, _ => 0 };
        var pos = new Vector2(MathF.Round(x + dx), MathF.Round(y));
        if (shadow)
        {
            var sc = new Color((byte)0, (byte)0, (byte)0, (byte)(color.A * 0.55f));
            Raylib.DrawTextEx(f, text, pos + new Vector2(size * 0.05f, size * 0.06f), size, Spacing(size), sc);
        }
        Raylib.DrawTextEx(f, text, pos, size, Spacing(size), color);
    }

    /// <summary>Big outlined title text.</summary>
    public static void Title(string text, float x, float y, float size, Color fill, Color outline, Font? font = null)
    {
        var f = font ?? Loc.Current.Font;
        var m = Raylib.MeasureTextEx(f, text, size, Spacing(size));
        var pos = new Vector2(x - m.X / 2, y);
        float o = MathF.Max(2, size / 22);
        for (int i = 0; i < 12; i++)
        {
            float a = i / 12f * MathF.Tau;
            Raylib.DrawTextEx(f, text, pos + new Vector2(MathF.Cos(a) * o, MathF.Sin(a) * o + o), size, Spacing(size), outline);
        }
        Raylib.DrawTextEx(f, text, pos, size, Spacing(size), fill);
    }

    /// <summary>Word wraps text; languages without spaces (CJK) are wrapped per character.</summary>
    public static List<string> Wrap(string text, float size, float maxWidth, Font? font = null)
    {
        var lines = new List<string>();
        var current = "";
        foreach (var word in SplitWords(text))
        {
            var candidate = current + word;
            if (current.Length > 0 && Measure(candidate.TrimEnd(), size, font).X > maxWidth)
            {
                lines.Add(current.TrimEnd());
                current = word.TrimStart();
            }
            else current = candidate;
        }
        if (current.Trim().Length > 0) lines.Add(current.TrimEnd());
        return lines;
    }

    private static IEnumerable<string> SplitWords(string text)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var ch in text)
        {
            bool cjk = ch >= 0x2E80 && ch <= 0xFFEF;
            if (cjk)
            {
                if (sb.Length > 0) { yield return sb.ToString(); sb.Clear(); }
                yield return ch.ToString();
            }
            else
            {
                sb.Append(ch);
                if (ch == ' ') { yield return sb.ToString(); sb.Clear(); }
            }
        }
        if (sb.Length > 0) yield return sb.ToString();
    }

    public static void TextBlock(string text, float x, float y, float size, float maxWidth, Color color, Align align = Align.Center)
    {
        var lines = Wrap(text, size, maxWidth);
        for (int i = 0; i < lines.Count; i++)
            Text(lines[i], x, y + i * size * 1.2f, size, color, align);
    }

    public static float TextBlockHeight(string text, float size, float maxWidth) => Wrap(text, size, maxWidth).Count * size * 1.2f;

    public static void Panel(Rectangle r, Color? bg = null, Color? border = null)
    {
        Raylib.DrawRectangleRounded(new Rectangle(r.X + 6, r.Y + 8, r.Width, r.Height), 0.12f, 8, new Color(0, 0, 0, 90));
        Raylib.DrawRectangleRounded(r, 0.12f, 8, bg ?? PanelBg);
        Raylib.DrawRectangleRoundedLinesEx(r, 0.12f, 8, 3, border ?? PanelBorder);
    }

    public static void Button(Rectangle r, string label, bool selected, float size = 34, bool enabled = true)
    {
        var t = (float)Raylib.GetTime();
        var bg = selected ? new Color(255, 196, 64, 255) : new Color(30, 48, 90, 235);
        var fg = selected ? Ink : enabled ? Color.White : new Color(140, 150, 170, 255);
        if (selected)
        {
            float grow = 4 + MathF.Sin(t * 6) * 2;
            r = new Rectangle(r.X - grow, r.Y - grow / 2, r.Width + grow * 2, r.Height + grow);
        }
        Raylib.DrawRectangleRounded(new Rectangle(r.X + 4, r.Y + 6, r.Width, r.Height), 0.35f, 8, new Color(0, 0, 0, 100));
        Raylib.DrawRectangleRounded(r, 0.35f, 8, bg);
        Raylib.DrawRectangleRoundedLinesEx(r, 0.35f, 8, 3, selected ? Color.White : new Color(120, 170, 230, 255));
        float s = size;
        while (s > 14 && Measure(label, s).X > r.Width - 24) s -= 2;
        Text(label, r.X + r.Width / 2, r.Y + (r.Height - s) / 2, s, fg, Align.Center, shadow: !selected);
    }

    public static bool Hover(Rectangle r) => Raylib.CheckCollisionPointRec(Input.Mouse, r);

    public static void ProgressBar(Rectangle r, float value)
    {
        Raylib.DrawRectangleRounded(r, 0.5f, 8, new Color(10, 16, 30, 255));
        var fill = new Rectangle(r.X + 3, r.Y + 3, (r.Width - 6) * Math.Clamp(value, 0, 1), r.Height - 6);
        if (fill.Width > 2) Raylib.DrawRectangleRounded(fill, 0.5f, 8, Accent);
    }
}

/// <summary>A vertical list menu supporting keyboard, gamepad and mouse.</summary>
public sealed class Menu
{
    public int Selected;
    public readonly List<Rectangle> Rects = new();

    /// <summary>Returns index of activated item or -1.</summary>
    public int Update(int count)
    {
        if (count == 0) return -1;
        if (Input.MenuUp) { Selected = (Selected - 1 + count) % count; Audio.Play(Sfx.MenuMove); }
        if (Input.MenuDown) { Selected = (Selected + 1) % count; Audio.Play(Sfx.MenuMove); }
        for (int i = 0; i < Rects.Count && i < count; i++)
        {
            if (Ui.Hover(Rects[i]))
            {
                if (Input.MouseMoved && Selected != i) { Selected = i; Audio.Play(Sfx.MenuMove); }
                if (Input.Click) { Selected = i; Audio.Play(Sfx.MenuSelect); return i; }
            }
        }
        if (Input.Confirm) { Audio.Play(Sfx.MenuSelect); return Selected; }
        return -1;
    }
}
