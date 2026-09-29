namespace Platformer.Game;

/// <summary>
/// A recorded run: one input byte (6 bits, see <see cref="TickInput"/>) per simulation tick.
/// Encoded as run-length pairs (value byte, LEB128 count) in base64url - identical in
/// web/js/replay.js and server/src/Replay/ReplayCodec.php.
/// </summary>
public sealed class Replay
{
    public readonly List<byte> Ticks = new();

    public void Add(TickInput input) => Ticks.Add(input.Bits);

    public string Encode()
    {
        var bytes = new List<byte>();
        int i = 0;
        while (i < Ticks.Count)
        {
            byte v = Ticks[i];
            int n = 1;
            while (i + n < Ticks.Count && Ticks[i + n] == v) n++;
            bytes.Add(v);
            uint c = (uint)n;
            while (c >= 0x80) { bytes.Add((byte)(c | 0x80)); c >>= 7; }
            bytes.Add((byte)c);
            i += n;
        }
        return Convert.ToBase64String(bytes.ToArray()).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public static Replay Decode(string s, int maxTicks = 20 * 60 * Phys.TicksPerSecond)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
        var data = Convert.FromBase64String(s);
        var r = new Replay();
        int i = 0;
        while (i < data.Length)
        {
            byte v = data[i++];
            if (v > 63) throw new FormatException("bad input byte");
            uint c = 0;
            int shift = 0;
            while (true)
            {
                if (i >= data.Length || shift > 28) throw new FormatException("bad count");
                byte b = data[i++];
                c |= (uint)(b & 0x7f) << shift;
                if ((b & 0x80) == 0) break;
                shift += 7;
            }
            if (c == 0 || r.Ticks.Count + c > maxTicks) throw new FormatException("bad length");
            for (int k = 0; k < c; k++) r.Ticks.Add(v);
        }
        return r;
    }
}

/// <summary>Result of playing a replay: what the server calculates for the leaderboard.</summary>
public readonly record struct RunResult(bool Completed, int Ticks, int TimeTicks, int Score, int Coins)
{
    /// <summary>Same bonus the game shows on the level-complete screen.</summary>
    public static int TimeBonus(int timeTicks) => Math.Max(0, 300 - timeTicks / Phys.TicksPerSecond) * 10;
    public int FinalScore => Completed ? Score + TimeBonus(TimeTicks) : Score;
}

/// <summary>Plays a replay without graphics: respawns at checkpoints exactly like PlayScene does.</summary>
public static class ReplayRunner
{
    public static RunResult Run(LevelData level, Replay replay, Action<Stage>? afterTick = null)
    {
        var stage = new Stage(level, null);
        bool died = false;
        stage.PlayerDied += () => died = true;
        int n = 0;
        foreach (var bits in replay.Ticks)
        {
            stage.Update(Phys.Step, TickInput.FromBits(bits));
            n++;
            afterTick?.Invoke(stage);
            if (stage.Completed) return new RunResult(true, n, stage.TimeTicks, stage.FinalScore, stage.Coins);
            if (died)
            {
                died = false;
                stage = new Stage(level, stage.LastCheckpoint);
                stage.PlayerDied += () => died = true;
            }
        }
        return new RunResult(false, n, stage.TimeTicks, stage.FinalScore, stage.Coins);
    }
}
