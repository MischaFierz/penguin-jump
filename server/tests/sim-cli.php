<?php
// Determinism test helper: php tests/sim-cli.php <level.txt> <inputs.txt>
// Prints the same per-tick state lines as "PenguinJump --simtest" and tests/js-sim.mjs.
declare(strict_types=1);
require __DIR__ . '/../src/Replay/Level.php';
require __DIR__ . '/../src/Replay/Sim.php';
require __DIR__ . '/../src/Replay/ReplayCodec.php';
require __DIR__ . '/../src/Replay/Runner.php';

use App\Replay\{Level, ReplayCodec, Runner};

[, $levelFile, $inputFile] = $argv;
$level = Level::parse(file_get_contents($levelFile), basename($levelFile));
$ticks = array_map('intval', array_values(array_filter(explode("\n", file_get_contents($inputFile)), fn($l) => trim($l) !== '')));
$out = fopen('php://stdout', 'w');
$r = Runner::run($level, $ticks, function ($sim) use ($out) { fwrite($out, $sim->stateHash() . "\n"); });
fwrite($out, 'RESULT ' . ($r->completed ? 1 : 0) . " {$r->ticks} {$r->timeTicks} {$r->finalScore()} {$r->coins}\n");
fwrite($out, 'ENCODED ' . ReplayCodec::encode($ticks) . "\n");
