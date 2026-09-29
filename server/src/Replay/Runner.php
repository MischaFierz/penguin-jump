<?php
declare(strict_types=1);

namespace App\Replay;

/** Result of replaying a run, as the server computes it (the client's claims are never trusted). */
final class RunResult
{
    public function __construct(
        public readonly bool $completed,
        public readonly int $ticks,
        public readonly int $timeTicks,
        public readonly int $score,
        public readonly int $coins,
    ) {
    }

    public static function timeBonus(int $timeTicks): int
    {
        return max(0, 300 - intdiv($timeTicks, Sim::TPS)) * 10;
    }

    public function finalScore(): int
    {
        return $this->completed ? $this->score + self::timeBonus($this->timeTicks) : $this->score;
    }
}

/** Plays tick inputs like the game's PlayScene: respawn at the last checkpoint after dying. */
final class Runner
{
    /** @param list<int> $ticks  @param (callable(Sim): void)|null $afterTick */
    public static function run(Level $level, array $ticks, ?callable $afterTick = null): RunResult
    {
        $sim = new Sim($level, null);
        $n = 0;
        foreach ($ticks as $bits) {
            $sim->update(Sim::STEP, $bits);
            $n++;
            if ($afterTick !== null) $afterTick($sim);
            if ($sim->completed) return new RunResult(true, $n, $sim->timeTicks, $sim->finalScore(), $sim->coins);
            if ($sim->diedEvent) $sim = new Sim($level, $sim->lastCheckpoint);
        }
        return new RunResult(false, $n, $sim->timeTicks, $sim->finalScore(), $sim->coins);
    }
}
