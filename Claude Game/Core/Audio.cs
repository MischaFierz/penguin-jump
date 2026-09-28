using Raylib_cs;

namespace Platformer.Core;

public enum Sfx
{
    Jump, DoubleJump, Coin, Stomp, Hurt, PowerUp, Break, Bump, Die, Checkpoint, Spring, Throw, OneUp, Complete,
    MenuMove, MenuSelect, GameOver, Kick, Crumble
}

/// <summary>All sounds and music are synthesized at startup - no audio files needed.</summary>
public static class Audio
{
    private const int Rate = 44100;
    private static readonly Dictionary<Sfx, Sound> Sounds = new();
    private static readonly Music[] Tunes = new Music[5]; // 0 = menu, 1..4 = worlds
    private static int _currentTune = -1;
    private static bool _ready;

    public static float SfxVolume { get; set; } = 0.8f;
    public static float MusicVolume { get; set; } = 0.5f;

    public static void Init()
    {
        Raylib.InitAudioDevice();
        _ready = Raylib.IsAudioDeviceReady();
        if (!_ready) return;

        Add(Sfx.Jump, Synth(0.16f, t => Square(Lerp(330, 660, t / 0.16f), t) * Env(t, 0.16f), 0.35f));
        Add(Sfx.DoubleJump, Synth(0.18f, t => Square(Lerp(500, 1000, t / 0.18f), t) * Env(t, 0.18f), 0.3f));
        Add(Sfx.Coin, Synth(0.22f, t => Square(t < 0.06f ? 988 : 1319, t) * Env(t, 0.22f), 0.3f));
        Add(Sfx.Stomp, Synth(0.14f, t => Tri(Lerp(420, 120, t / 0.14f), t) * Env(t, 0.14f), 0.7f));
        Add(Sfx.Kick, Synth(0.12f, t => (Square(Lerp(800, 300, t / 0.12f), t) * 0.6f + Noise() * 0.4f) * Env(t, 0.12f), 0.4f));
        Add(Sfx.Hurt, Synth(0.35f, t => Square(Lerp(600, 150, t / 0.35f), t) * Env(t, 0.35f) * (((int)(t * 30) % 2 == 0) ? 1 : 0.5f), 0.35f));
        Add(Sfx.PowerUp, Synth(0.6f, t => Square(Arp(t, 0.05f, 523, 659, 784, 1047, 784, 1047, 1319, 1568), t) * Env(t, 0.6f), 0.3f));
        Add(Sfx.OneUp, Synth(0.7f, t => Tri(Arp(t, 0.1f, 659, 784, 1319, 1047, 1175, 1568), t) * Env(t, 0.7f), 0.6f));
        Add(Sfx.Break, Synth(0.25f, t => Noise() * Env(t, 0.25f) * 0.9f + Tri(Lerp(200, 60, t / 0.25f), t) * 0.3f, 0.5f));
        Add(Sfx.Crumble, Synth(0.3f, t => Noise() * Env(t, 0.3f) * 0.6f, 0.35f));
        Add(Sfx.Bump, Synth(0.1f, t => Tri(Lerp(180, 90, t / 0.1f), t) * Env(t, 0.1f), 0.7f));
        Add(Sfx.Die, Synth(1.0f, t => Square(Arp(t, 0.12f, 784, 740, 698, 659, 523, 494, 440, 392), t) * Env(t, 1.0f), 0.3f));
        Add(Sfx.Checkpoint, Synth(0.45f, t => Tri(Arp(t, 0.09f, 523, 659, 784, 1047, 1047), t) * Env(t, 0.45f), 0.6f));
        Add(Sfx.Spring, Synth(0.3f, t => Tri(Lerp(200, 900, t / 0.3f) + MathF.Sin(t * 90) * 60, t) * Env(t, 0.3f), 0.6f));
        Add(Sfx.Throw, Synth(0.1f, t => Noise() * Env(t, 0.1f) * 0.4f + Square(Lerp(900, 500, t / 0.1f), t) * 0.2f, 0.5f));
        Add(Sfx.Complete, Synth(1.6f, t => (Square(Arp(t, 0.13f, 523, 659, 784, 1047, 784, 1047, 1319, 1319, 1568, 1568, 1568, 1568), t) * 0.6f
                                            + Tri(Arp(t, 0.26f, 262, 330, 392, 523, 392, 523), t) * 0.5f) * Env(t, 1.6f), 0.35f));
        Add(Sfx.GameOver, Synth(1.4f, t => Tri(Arp(t, 0.25f, 392, 370, 349, 330, 262, 196), t) * Env(t, 1.4f), 0.6f));
        Add(Sfx.MenuMove, Synth(0.05f, t => Square(880, t) * Env(t, 0.05f), 0.2f));
        Add(Sfx.MenuSelect, Synth(0.14f, t => Square(t < 0.05f ? 880 : 1320, t) * Env(t, 0.14f), 0.25f));

        for (int i = 0; i < Tunes.Length; i++)
        {
            var wav = MusicGen.Generate(i);
            Tunes[i] = Raylib.LoadMusicStreamFromMemory(".wav", wav);
            Tunes[i].Looping = true;
        }
    }

    public static void Play(Sfx sfx)
    {
        if (!_ready || !Sounds.TryGetValue(sfx, out var s)) return;
        Raylib.SetSoundVolume(s, SfxVolume);
        Raylib.PlaySound(s);
    }

    public static void PlayMusic(int tune)
    {
        if (!_ready || tune == _currentTune) return;
        if (_currentTune >= 0) Raylib.StopMusicStream(Tunes[_currentTune]);
        _currentTune = tune;
        if (tune >= 0) Raylib.PlayMusicStream(Tunes[tune]);
    }

    public static void Update()
    {
        if (!_ready || _currentTune < 0) return;
        Raylib.SetMusicVolume(Tunes[_currentTune], MusicVolume * 0.6f);
        Raylib.UpdateMusicStream(Tunes[_currentTune]);
    }

    public static void Shutdown()
    {
        if (!_ready) return;
        foreach (var s in Sounds.Values) Raylib.UnloadSound(s);
        foreach (var m in Tunes) Raylib.UnloadMusicStream(m);
        Raylib.CloseAudioDevice();
    }

    private static void Add(Sfx id, byte[] wav)
    {
        var wave = Raylib.LoadWaveFromMemory(".wav", wav);
        Sounds[id] = Raylib.LoadSoundFromWave(wave);
        Raylib.UnloadWave(wave);
    }

    // ---------- tiny synthesizer ----------
    private static readonly Random Rng = new(1234);
    private static float Lerp(float a, float b, float t) => a + (b - a) * Math.Clamp(t, 0, 1);
    private static float Env(float t, float len) => Math.Clamp(Math.Min(t / 0.005f, 1f) * (1 - t / len), 0, 1);
    private static float Square(float f, float t) => (t * f % 1f) < 0.5f ? 1f : -1f;
    private static float Tri(float f, float t) { float p = t * f % 1f; return 4f * MathF.Abs(p - 0.5f) - 1f; }
    private static float Noise() => (float)(Rng.NextDouble() * 2 - 1);
    private static float Arp(float t, float step, params float[] notes) => notes[Math.Min((int)(t / step), notes.Length - 1)];

    private static byte[] Synth(float seconds, Func<float, float> fn, float volume)
    {
        int n = (int)(seconds * Rate);
        var samples = new short[n];
        for (int i = 0; i < n; i++)
            samples[i] = (short)(Math.Clamp(fn(i / (float)Rate) * volume, -1f, 1f) * 32000);
        return Wav.Encode(samples, Rate);
    }
}

public static class Wav
{
    public static byte[] Encode(short[] samples, int rate)
    {
        using var ms = new MemoryStream();
        using var w = new BinaryWriter(ms);
        int dataLen = samples.Length * 2;
        w.Write("RIFF"u8); w.Write(36 + dataLen); w.Write("WAVE"u8);
        w.Write("fmt "u8); w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
        w.Write("data"u8); w.Write(dataLen);
        foreach (var s in samples) w.Write(s);
        w.Flush();
        return ms.ToArray();
    }
}

/// <summary>Generates a small looping chiptune per world (deterministic).</summary>
public static class MusicGen
{
    private const int Rate = 22050;

    public static byte[] Generate(int tune)
    {
        // (root midi note, bpm, minor?)
        var (root, bpm, minor) = tune switch
        {
            0 => (60, 100, false),
            1 => (62, 132, false),
            2 => (57, 112, true),
            3 => (64, 124, false),
            _ => (55, 144, true),
        };
        int[] major = [0, 2, 4, 5, 7, 9, 11], minorScale = [0, 2, 3, 5, 7, 8, 10];
        var scale = minor ? minorScale : major;
        int[] progression = minor ? [0, 5, 3, 4] : [0, 4, 5, 3]; // scale degrees of chords

        var rng = new Random(tune * 7919 + 17);
        float beat = 60f / bpm;
        int bars = 8;
        int stepsPerBar = 8; // eighth notes
        float step = beat / 2;
        int total = (int)(bars * stepsPerBar * step * Rate);
        var buf = new float[total];

        int Note(int degree, int octave) { int oct = degree / 7 + (degree < 0 ? -1 : 0); int d = ((degree % 7) + 7) % 7; return root + scale[d] + 12 * (oct + octave); }
        float Freq(int midi) => 440f * MathF.Pow(2, (midi - 69) / 12f);

        void AddNote(float start, float len, float freq, float vol, int wave)
        {
            int s0 = (int)(start * Rate), n = (int)(len * Rate);
            for (int i = 0; i < n && s0 + i < total; i++)
            {
                float t = i / (float)Rate;
                float p = t * freq % 1f;
                float v = wave switch
                {
                    0 => p < 0.5f ? 1 : -1,           // square
                    1 => 4 * MathF.Abs(p - 0.5f) - 1, // triangle
                    _ => p < 0.25f ? 1 : -1           // thin pulse
                };
                float env = Math.Min(1, t / 0.01f) * MathF.Max(0, 1 - t / len);
                buf[s0 + i] += v * vol * env;
            }
        }

        // melody motif (repeats with variation)
        var motif = new int[stepsPerBar * 2];
        for (int i = 0; i < motif.Length; i++) motif[i] = rng.Next(100) < 70 ? rng.Next(0, 6) : -99;

        for (int bar = 0; bar < bars; bar++)
        {
            int chord = progression[bar % progression.Length];
            float barStart = bar * stepsPerBar * step;
            // bass: root on beats, fifth offbeats
            for (int s = 0; s < stepsPerBar; s++)
            {
                int deg = chord + (s % 2 == 0 ? 0 : 4);
                AddNote(barStart + s * step, step * 0.9f, Freq(Note(deg, -2)), 0.22f, 1);
            }
            // arpeggio pad
            for (int s = 0; s < stepsPerBar * 2; s++)
            {
                int deg = chord + new[] { 0, 2, 4, 2 }[s % 4];
                AddNote(barStart + s * step / 2, step / 2 * 0.8f, Freq(Note(deg, 0)), 0.045f, 2);
            }
            // lead
            if (tune == 0 && bar % 2 == 1) continue; // calmer menu tune
            for (int s = 0; s < stepsPerBar; s++)
            {
                int m = motif[(bar % 2) * stepsPerBar + s];
                if (m == -99) continue;
                int deg = chord + new[] { 0, 2, 4, 7, 4, 2 }[m];
                if (bar >= 4 && s == 0) deg += 1;
                AddNote(barStart + s * step, step * 0.85f, Freq(Note(deg, 1)), 0.09f, 0);
            }
        }

        var samples = new short[total];
        for (int i = 0; i < total; i++) samples[i] = (short)(Math.Clamp(buf[i], -1, 1) * 30000);
        return Wav.Encode(samples, Rate);
    }
}
