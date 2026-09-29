<?php
declare(strict_types=1);

namespace App\Replay;

/**
 * Server-side copy of the game simulation (Game/Stage.cs, web/js/stage.js).
 *
 * Only the gameplay-relevant part is ported (no particles, sounds, texts). Every operation is
 * performed in the same order with IEEE doubles, so a recorded run produces bit-identical
 * results here and in the game. tests/determinism.mjs checks this for every level in CI.
 */
final class Sim
{
    public const T = 48.0;
    public const TPS = 120;
    public const STEP = 1 / 120;

    private const WALK = 250.0, RUN = 400.0, ACCEL_GROUND = 2000.0, ACCEL_AIR = 1300.0, FRICTION = 2200.0;
    private const JUMP_V = 780.0, JUMP_V_RUN = 860.0, DOUBLE_JUMP_V = 720.0;
    private const GRAVITY_UP = 1800.0, GRAVITY = 2800.0, MAX_FALL = 1000.0;
    private const COYOTE = 0.1, JUMP_BUFFER = 0.12;
    private const STOMP_BOUNCE = 460.0, STOMP_BOUNCE_HELD = 740.0, SPRING_V = 1250.0, SPRING_V_HELD = 1420.0;
    private const PW = 28.0, PH = 40.0, VIEW = 1280.0;
    private const SOLID = ['#' => true, 'B' => true, '?' => true, 'F' => true, 'S' => true, 'W' => true, 'H' => true, 'E' => true, 'x' => true];

    /** @var array<int, array<int, string>> tiles[y][x] */
    private array $tiles;
    public int $w;
    public int $h;

    public SimPlayer $p;
    /** @var list<SimEnemy> */
    public array $enemies = [];
    /** @var list<SimPlatform> */
    private array $platforms = [];
    /** @var list<array{x: float, y: float, state: int, timer: float, vy: float}> */
    private array $icicles = [];
    /** @var list<array{kind: string, x: float, y: float, vx: float, vy: float, emerge: float}> */
    private array $items = [];
    /** @var list<array{x: float, y: float, vx: float, vy: float, life: float}> */
    private array $snowballs = [];
    /** @var list<array{tx: int, ty: int, active: bool}> */
    private array $checkpoints = [];
    /** @var array<string, float> */
    private array $crumbleTimer = [];
    /** @var array<string, float> */
    private array $crumbleFallen = [];
    private int $goalX = 0;
    private int $goalY = 0;

    public int $timeTicks = 0;
    public float $clock = 0.0;
    public int $score = 0;
    public int $coins = 0;
    public float $camX = 0.0;
    private int $combo = 0;
    public bool $completed = false;
    private int $scoreAtGoal = 0;
    public bool $diedEvent = false;
    /** @var array{tx: int, ty: int, score: int, coins: int, timeTicks: int}|null */
    public ?array $lastCheckpoint = null;

    private int $in = 0;

    /** @param array{tx: int, ty: int, score: int, coins: int, timeTicks: int}|null $cp */
    public function __construct(Level $level, ?array $cp)
    {
        $T = self::T;
        $this->tiles = $level->tiles;
        $this->w = $level->w;
        $this->h = $level->h;
        $this->p = new SimPlayer();
        $orig = $level->tiles;
        for ($x = 0; $x < $this->w; $x++) {
            for ($y = 0; $y < $this->h; $y++) {
                $c = $this->tiles[$y][$x];
                switch ($c) {
                    case '@':
                        $this->p->x = $x * $T + ($T - self::PW) / 2;
                        $this->p->y = $y * $T + $T - self::PH;
                        $this->tiles[$y][$x] = ' ';
                        break;
                    case 'e': $this->enemies[] = SimEnemy::create('walker', $x, $y); $this->tiles[$y][$x] = ' '; break;
                    case 's': $this->enemies[] = SimEnemy::create('spiky', $x, $y); $this->tiles[$y][$x] = ' '; break;
                    case 'b': $this->enemies[] = SimEnemy::create('bird', $x, $y); $this->tiles[$y][$x] = ' '; break;
                    case 'h': $this->enemies[] = SimEnemy::create('hopper', $x, $y); $this->tiles[$y][$x] = ' '; break;
                    case 'i': $this->icicles[] = ['x' => $x * $T, 'y' => $y * $T, 'state' => 0, 'timer' => 0.0, 'vy' => 0.0]; $this->tiles[$y][$x] = ' '; break;
                    case 'C': $this->checkpoints[] = ['tx' => $x, 'ty' => $y, 'active' => false]; $this->tiles[$y][$x] = ' '; break;
                    case 'G': $this->goalX = $x; $this->goalY = $y; $this->tiles[$y][$x] = ' '; break;
                    case '!': $this->tiles[$y][$x] = ' '; break;
                    case 'M':
                    case 'V':
                        if ($x > 0 && $orig[$y][$x - 1] === $c) { $this->tiles[$y][$x] = ' '; break; }
                        $len = 1;
                        while ($x + $len < $this->w && $orig[$y][$x + $len] === $c) $len++;
                        $this->platforms[] = new SimPlatform($x * $T, $y * $T + $T - 20.0 - 8.0, $len, $c === 'V', $x * 0.37);
                        $this->tiles[$y][$x] = ' ';
                        break;
                }
            }
        }
        if ($cp !== null) {
            $this->lastCheckpoint = $cp;
            $this->p->x = $cp['tx'] * $T + ($T - self::PW) / 2;
            $this->p->y = $cp['ty'] * $T + $T - self::PH;
            $this->score = $cp['score'];
            $this->coins = $cp['coins'];
            $this->timeTicks = $cp['timeTicks'];
            foreach ($this->checkpoints as &$c) if ($c['tx'] <= $cp['tx']) $c['active'] = true;
            unset($c);
        }
        $this->p->prevBottom = $this->p->y + self::PH;
        $this->camX = max(0.0, min(max(0.0, $this->w * $T - self::VIEW), $this->p->x + self::PW / 2 - self::VIEW * 0.4));
    }

    public function finalScore(): int
    {
        return $this->completed ? $this->scoreAtGoal : $this->score;
    }

    // ------------------------------------------------------------------ helpers
    public static function dsin(float $x): float
    {
        $k = floor($x / 6.283185307179586 + 0.5);
        $r = $x - $k * 6.283185307179586;
        if ($r > 1.5707963267948966) $r = 3.141592653589793 - $r;
        elseif ($r < -1.5707963267948966) $r = -3.141592653589793 - $r;
        $r2 = $r * $r;
        return $r * (1 + $r2 * (-0.16666666666666666 + $r2 * (0.008333333333333333 + $r2 * (-0.0001984126984126984
            + $r2 * (2.7557319223985893e-6 + $r2 * (-2.505210838544172e-8 + $r2 * 1.6059043836821613e-10))))));
    }

    private static function approach(float $v, float $t, float $s): float
    {
        return $v < $t ? min($v + $s, $t) : max($v - $s, $t);
    }

    private static function sign(float $v): int
    {
        return $v > 0 ? 1 : ($v < 0 ? -1 : 0);
    }

    private static function fl(float $v): int
    {
        return (int) floor($v);
    }

    private static function overlap(float $ax, float $ay, float $aw, float $ah, float $bx, float $by, float $bw, float $bh): bool
    {
        return $ax < $bx + $bw && $ax + $aw > $bx && $ay < $by + $bh && $ay + $ah > $by;
    }

    private function at(int $x, int $y): string
    {
        return $x < 0 || $x >= $this->w ? '#' : ($y < 0 || $y >= $this->h ? ' ' : $this->tiles[$y][$x]);
    }

    private function solid(int $x, int $y): bool
    {
        $c = $this->at($x, $y);
        if ($c === 'x' && isset($this->crumbleFallen[$x . ',' . $y])) return false;
        return isset(self::SOLID[$c]);
    }

    private function oneWay(int $x, int $y): bool
    {
        $c = $this->at($x, $y);
        return $c === '-' || $c === '*';
    }

    private function inp(int $bit): bool
    {
        return ($this->in & $bit) !== 0;
    }

    // ------------------------------------------------------------------ update
    public function update(float $dt, int $input): void
    {
        $this->in = $input;
        $this->clock += $dt;
        if ($dt > 0 && !$this->completed && !$this->p->dead) $this->timeTicks++;
        foreach ($this->platforms as $mp) $mp->update($this->clock);
        if ($this->p->dead) $this->updateDead($dt);
        elseif ($this->completed) $this->updateCompletion($dt);
        else $this->updatePlayer($dt);
        $this->updateCrumbles($dt);
        $this->updateEnemies($dt);
        $this->updateIcicles($dt);
        $this->updateItems($dt);
        $this->updateSnowballs($dt);
        if (!$this->p->dead) {
            $target = $this->p->x + self::PW / 2 - self::VIEW * 0.4 + $this->p->facing * 60;
            $this->camX += ($target - $this->camX) * min(1.0, $dt * 5);
            $this->camX = max(0.0, min(max(0.0, $this->w * self::T - self::VIEW), $this->camX));
        }
    }

    private function updatePlayer(float $dt): void
    {
        $p = $this->p;
        if ($p->invuln > 0) $p->invuln -= $dt;
        if ($p->riding !== null) {
            $p->x += $p->riding->dx;
            $p->y += $p->riding->dy;
            $p->riding = null;
        }
        if ($this->inp(16)) $p->buffer = self::JUMP_BUFFER; else $p->buffer -= $dt;
        if ($p->onGround) { $p->coyote = self::COYOTE; $p->doubleUsed = false; } else $p->coyote -= $dt;

        $target = ($this->inp(2) ? 1 : 0) - ($this->inp(1) ? 1 : 0);
        $max = $this->inp(4) ? self::RUN : self::WALK;
        if ($target !== 0) {
            $p->facing = $target;
            $acc = $p->onGround ? self::ACCEL_GROUND : self::ACCEL_AIR;
            if (self::sign($p->vx) !== $target && $p->onGround) $acc *= 1.6;
            $p->vx = self::approach($p->vx, $target * $max, $acc * $dt);
        } elseif ($p->onGround) {
            $p->vx = self::approach($p->vx, 0.0, self::FRICTION * $dt);
        } else {
            $p->vx = self::approach($p->vx, 0.0, self::FRICTION * 0.25 * $dt);
        }

        if ($p->buffer > 0 && $p->coyote > 0) {
            $rf = max(0.0, min(1.0, (abs($p->vx) - self::WALK) / (self::RUN - self::WALK)));
            $p->vy = -(self::JUMP_V + (self::JUMP_V_RUN - self::JUMP_V) * $rf);
            $p->onGround = false;
            $p->buffer = 0.0;
            $p->coyote = 0.0;
        } elseif ($p->buffer > 0 && !$p->onGround && $p->wings && !$p->doubleUsed) {
            $p->vy = -self::DOUBLE_JUMP_V;
            $p->doubleUsed = true;
            $p->buffer = 0.0;
        }
        if ($this->inp(32) && $p->power === 2 && count($this->snowballs) < 2) {
            $this->snowballs[] = ['x' => $p->x + self::PW / 2 + $p->facing * 16, 'y' => $p->y + self::PH / 2 - 4, 'vx' => $p->facing * 560 + $p->vx * 0.3, 'vy' => 120.0, 'life' => 2.0];
        }
        $held = $this->inp(8);
        $g = $p->vy < 0 && $held ? self::GRAVITY_UP : self::GRAVITY;
        $p->vy = min($p->vy + $g * $dt, self::MAX_FALL);
        $p->prevBottom = $p->y + self::PH;
        $this->moveX($dt);
        $this->moveY($dt, $held);
        if ($p->y > $this->h * self::T + 60) $this->kill();
        $this->checkHazards();
        $this->checkPickups();
        $this->checkCheckpoints();
        $this->checkGoal();
    }

    private function moveX(float $dt): void
    {
        $p = $this->p;
        $T = self::T;
        $p->x += $p->vx * $dt;
        if ($p->x < 0) { $p->x = 0.0; $p->vx = 0.0; }
        if ($p->x > $this->w * $T - self::PW) { $p->x = $this->w * $T - self::PW; $p->vx = 0.0; }
        $y0 = self::fl($p->y / $T);
        $y1 = self::fl(($p->y + self::PH - 0.01) / $T);
        if ($p->vx > 0) {
            $x = self::fl(($p->x + self::PW) / $T);
            for ($y = $y0; $y <= $y1; $y++) if ($this->solid($x, $y)) { $p->x = $x * $T - self::PW; $p->vx = 0.0; break; }
        } elseif ($p->vx < 0) {
            $x = self::fl($p->x / $T);
            for ($y = $y0; $y <= $y1; $y++) if ($this->solid($x, $y)) { $p->x = ($x + 1) * $T; $p->vx = 0.0; break; }
        }
    }

    private function moveY(float $dt, bool $held): void
    {
        $p = $this->p;
        $T = self::T;
        $p->y += $p->vy * $dt;
        $p->onGround = false;
        $x0 = self::fl(($p->x + 1) / $T);
        $x1 = self::fl(($p->x + self::PW - 1) / $T);
        if ($p->vy >= 0) {
            $bottom = $p->y + self::PH;
            $y = self::fl($bottom / $T);
            $best = INF;
            $springX = -1;
            for ($x = $x0; $x <= $x1; $x++) {
                if ($this->solid($x, $y)) {
                    $best = min($best, $y * $T);
                } elseif ($this->oneWay($x, $y)) {
                    $top = $y * $T + ($this->at($x, $y) === '*' ? 16 : 0);
                    if ($p->prevBottom <= $top + 0.5 && $bottom >= $top) {
                        $best = min($best, $top);
                        if ($this->at($x, $y) === '*') $springX = $x;
                    }
                }
            }
            foreach ($this->platforms as $mp) {
                if ($p->x + self::PW > $mp->x + 2 && $p->x < $mp->x + $mp->wt * $T - 2) {
                    $top = $mp->y;
                    if ($p->prevBottom <= $top + abs($mp->dy) + 1 && $bottom >= $top && $top < $best) {
                        $best = $top;
                        $p->riding = $mp;
                    }
                }
            }
            if ($best < INF) {
                $p->y = $best - self::PH;
                if ($springX >= 0) {
                    $p->vy = -($held ? self::SPRING_V_HELD : self::SPRING_V);
                    $p->riding = null;
                    return;
                }
                $p->vy = 0.0;
                $p->onGround = true;
                $this->combo = 0;
                for ($x = $x0; $x <= $x1; $x++) {
                    $k = $x . ',' . $y;
                    if ($this->at($x, $y) === 'x' && !isset($this->crumbleTimer[$k]) && !isset($this->crumbleFallen[$k])) $this->crumbleTimer[$k] = 0.45;
                }
            } else {
                $p->riding = null;
            }
        } else {
            $y = self::fl($p->y / $T);
            $hitX = -1;
            $bestO = 0.0;
            for ($x = $x0; $x <= $x1; $x++) {
                if (!$this->solid($x, $y)) continue;
                $o = min($p->x + self::PW, ($x + 1) * $T) - max($p->x, $x * $T);
                if ($o > $bestO) { $bestO = $o; $hitX = $x; }
            }
            if ($hitX >= 0) {
                $p->y = ($y + 1) * $T;
                $p->vy = 40.0;
                $this->hitBlock($hitX, $y);
            }
        }
    }

    private function hitBlock(int $x, int $y): void
    {
        $T = self::T;
        $c = $this->at($x, $y);
        if ($c === '?') {
            $this->tiles[$y][$x] = 'E';
            $this->addCoin();
        } elseif ($c === 'F' || $c === 'S' || $c === 'W' || $c === 'H') {
            $this->tiles[$y][$x] = 'E';
            $kind = ['F' => 'fish', 'S' => 'snowflake', 'W' => 'wing', 'H' => 'heart'][$c];
            $this->items[] = ['kind' => $kind, 'x' => $x * $T + $T / 2, 'y' => $y * $T + $T / 2, 'vx' => $kind === 'snowflake' ? 0.0 : 110.0, 'vy' => 0.0, 'emerge' => 0.5];
        } elseif ($c === 'B') {
            if ($this->p->power >= 1) {
                $this->tiles[$y][$x] = ' ';
                $this->score += 50;
            }
        }
        $ax = $x * $T;
        $ay = $y * $T - 10;
        foreach ($this->enemies as $e) {
            if (!$e->squashed && !$e->flipped && $e->active && self::overlap($e->x, $e->y, $e->w, $e->h, $ax, $ay, $T, 12.0)) {
                $this->knock($e, $x * $T + $T / 2 < $e->x + $e->w / 2 ? 1 : -1);
            }
        }
        if ($this->at($x, $y - 1) === 'o') {
            $this->tiles[$y - 1][$x] = ' ';
            $this->addCoin();
        }
    }

    private function addCoin(): void
    {
        $this->coins++;
        $this->score += 100;
    }

    private function checkHazards(): void
    {
        $p = $this->p;
        $T = self::T;
        $x0 = self::fl($p->x / $T); $x1 = self::fl(($p->x + self::PW) / $T);
        $y0 = self::fl($p->y / $T); $y1 = self::fl(($p->y + self::PH) / $T);
        for ($x = $x0; $x <= $x1; $x++) {
            for ($y = $y0; $y <= $y1; $y++) {
                $c = $this->at($x, $y);
                if ($c === '^' && self::overlap($p->x, $p->y, self::PW, self::PH, $x * $T + 6, $y * $T + 20, $T - 12, $T - 20)) {
                    $this->hurt();
                    if (!$p->dead) $p->vy = -520.0;
                    return;
                }
                if ($c === '~' && self::overlap($p->x, $p->y, self::PW, self::PH, $x * $T, $y * $T + 18, $T, $T - 18)) {
                    $this->kill();
                    return;
                }
            }
        }
    }

    private function checkPickups(): void
    {
        $p = $this->p;
        $T = self::T;
        $x0 = self::fl($p->x / $T); $x1 = self::fl(($p->x + self::PW) / $T);
        $y0 = self::fl($p->y / $T); $y1 = self::fl(($p->y + self::PH) / $T);
        for ($x = $x0; $x <= $x1; $x++) {
            for ($y = $y0; $y <= $y1; $y++) {
                if ($this->at($x, $y) !== 'o' || !self::overlap($p->x, $p->y, self::PW, self::PH, $x * $T + 10, $y * $T + 6, $T - 20, $T - 12)) continue;
                $this->tiles[$y][$x] = ' ';
                $this->addCoin();
            }
        }
        for ($i = count($this->items) - 1; $i >= 0; $i--) {
            $it = $this->items[$i];
            if ($it['emerge'] > 0 || !self::overlap($p->x, $p->y, self::PW, self::PH, $it['x'] - 16, $it['y'] - 16, 32.0, 32.0)) continue;
            array_splice($this->items, $i, 1);
            $this->score += 1000;
            if ($it['kind'] === 'fish') $p->power = max($p->power, 1);
            if ($it['kind'] === 'snowflake') $p->power = 2;
            if ($it['kind'] === 'wing') $p->wings = true;
        }
    }

    private function checkCheckpoints(): void
    {
        $T = self::T;
        foreach ($this->checkpoints as &$c) {
            if ($c['active'] || !self::overlap($this->p->x, $this->p->y, self::PW, self::PH, $c['tx'] * $T, $c['ty'] * $T - $T, $T, $T * 2)) continue;
            $c['active'] = true;
            $this->lastCheckpoint = ['tx' => $c['tx'], 'ty' => $c['ty'], 'score' => $this->score, 'coins' => $this->coins, 'timeTicks' => $this->timeTicks];
        }
        unset($c);
    }

    private function checkGoal(): void
    {
        $T = self::T;
        if (!self::overlap($this->p->x, $this->p->y, self::PW, self::PH, $this->goalX * $T - 4, $this->goalY * $T - 16, $T + 8, $T + 16)) return;
        $this->completed = true;
        $this->scoreAtGoal = $this->score;
        $this->p->vx = 0.0;
        $this->p->vy = 0.0;
    }

    private function updateCompletion(float $dt): void
    {
        // The replay ends at the tick the goal is reached; nothing after it counts.
    }

    private function hurt(): void
    {
        $p = $this->p;
        if ($p->invuln > 0 || $p->dead || $this->completed) return;
        if ($p->power > 0 || $p->wings) {
            $p->power = 0;
            $p->wings = false;
            $p->invuln = 2.0;
        } else {
            $this->kill();
        }
    }

    private function kill(): void
    {
        $p = $this->p;
        if ($p->dead || $this->completed) return;
        $p->dead = true;
        $p->deadTimer = 0.0;
        $p->vx = 0.0;
        $p->vy = -700.0;
    }

    private function updateDead(float $dt): void
    {
        $p = $this->p;
        $p->deadTimer += $dt;
        if ($p->deadTimer < 0.4) return;
        $p->vy = min($p->vy + self::GRAVITY * 0.6 * $dt, self::MAX_FALL);
        $p->y += $p->vy * $dt;
        if ($p->deadTimer > 2.2 && $p->deadTimer - $dt <= 2.2) $this->diedEvent = true;
    }

    private function updateCrumbles(float $dt): void
    {
        $T = self::T;
        foreach ($this->crumbleTimer as $k => $t0) {
            $t = $t0 - $dt;
            if ($t > 0) { $this->crumbleTimer[$k] = $t; continue; }
            unset($this->crumbleTimer[$k]);
            $this->crumbleFallen[$k] = 4.0;
        }
        foreach ($this->crumbleFallen as $k => $t0) {
            $t = $t0 - $dt;
            $this->crumbleFallen[$k] = $t;
            if ($t > 0) continue;
            [$x, $y] = array_map('intval', explode(',', (string) $k));
            if (self::overlap($x * $T, $y * $T, $T, $T, $this->p->x, $this->p->y, self::PW, self::PH)) continue;
            unset($this->crumbleFallen[$k]);
        }
    }

    private function updateEnemies(float $dt): void
    {
        $T = self::T;
        $L = $this->camX - 2 * $T;
        $R = $this->camX + self::VIEW + 2 * $T;
        for ($i = count($this->enemies) - 1; $i >= 0; $i--) {
            $e = $this->enemies[$i];
            if (!$e->active) {
                if ($e->x + $e->w > $L && $e->x < $R) $e->active = true; else continue;
            }
            $e->t += $dt;
            if ($e->squashed) {
                $e->deathTimer += $dt;
                if ($e->deathTimer > 0.5) array_splice($this->enemies, $i, 1);
                continue;
            }
            if ($e->flipped) {
                $e->vy += self::GRAVITY * $dt;
                $e->x += $e->vx * $dt;
                $e->y += $e->vy * $dt;
                if ($e->y > $this->h * $T + 100) array_splice($this->enemies, $i, 1);
                continue;
            }
            if ($e->kind === 'walker' || $e->kind === 'spiky') {
                $e->vx = (float) ($e->facing * ($e->kind === 'walker' ? 70 : 55));
                $this->moveEnemy($e, $dt, true);
            } elseif ($e->kind === 'hopper') {
                if ($e->onGround) {
                    $e->vx = 0.0;
                    $e->hopTimer -= $dt;
                    if ($e->hopTimer <= 0) {
                        $dx = $this->p->x + self::PW / 2 - ($e->x + $e->w / 2);
                        if (abs($dx) < 8 * $T) $e->facing = $dx > 0 ? 1 : -1;
                        $e->vx = (float) ($e->facing * 150);
                        $e->vy = -640.0;
                        $e->hopTimer = 1.1;
                        $e->onGround = false;
                    }
                }
                $this->moveEnemy($e, $dt, false);
            } else {
                $nx = $e->ox + self::dsin($e->t * 0.9) * 2.2 * $T;
                $ny = $e->oy + self::dsin($e->t * 2.4) * 0.5 * $T;
                $e->facing = $nx > $e->x ? 1 : -1;
                $e->x = $nx;
                $e->y = $ny;
            }
            if ($e->y > $this->h * $T + 100) { array_splice($this->enemies, $i, 1); continue; }
            if (!$this->p->dead && !$this->completed) $this->playerVsEnemy($e);
        }
    }

    private function blocksEnemy(int $x, int $y): bool
    {
        $c = $this->at($x, $y);
        return $this->solid($x, $y) || $c === '^' || $c === '~';
    }

    private function moveEnemy(SimEnemy $e, float $dt, bool $turnAtEdges): void
    {
        $T = self::T;
        $e->vy = min($e->vy + self::GRAVITY * $dt, self::MAX_FALL);
        $e->x += $e->vx * $dt;
        $y0 = self::fl($e->y / $T);
        $y1 = self::fl(($e->y + $e->h - 0.01) / $T);
        if ($e->vx > 0) {
            $x = self::fl(($e->x + $e->w) / $T);
            for ($y = $y0; $y <= $y1; $y++) {
                if ($this->blocksEnemy($x, $y) || $x >= $this->w) { $e->x = $x * $T - $e->w; $e->facing = -1; if ($e->kind === 'hopper') $e->vx = -$e->vx; break; }
            }
        } elseif ($e->vx < 0) {
            $x = self::fl($e->x / $T);
            for ($y = $y0; $y <= $y1; $y++) {
                if ($this->blocksEnemy($x, $y) || $x < 0) { $e->x = ($x + 1) * $T; $e->facing = 1; if ($e->kind === 'hopper') $e->vx = -$e->vx; break; }
            }
        }
        $prevBottom = $e->y + $e->h;
        $e->y += $e->vy * $dt;
        $e->onGround = false;
        $x0 = self::fl(($e->x + 2) / $T);
        $x1 = self::fl(($e->x + $e->w - 2) / $T);
        if ($e->vy >= 0) {
            $y = self::fl(($e->y + $e->h) / $T);
            for ($x = $x0; $x <= $x1; $x++) {
                if ($this->solid($x, $y) || ($this->at($x, $y) === '-' && $prevBottom <= $y * $T + 0.5)) {
                    $e->y = $y * $T - $e->h;
                    $e->vy = 0.0;
                    $e->onGround = true;
                    break;
                }
            }
        } else {
            $y = self::fl($e->y / $T);
            for ($x = $x0; $x <= $x1; $x++) if ($this->solid($x, $y)) { $e->y = ($y + 1) * $T; $e->vy = 0.0; break; }
        }
        if ($turnAtEdges && $e->onGround) {
            $fx = self::fl(($e->facing > 0 ? $e->x + $e->w + 1 : $e->x - 1) / $T);
            $fy = self::fl(($e->y + $e->h + 1) / $T);
            if (!$this->solid($fx, $fy) && $this->at($fx, $fy) !== '-') $e->facing = -$e->facing;
        }
    }

    private function playerVsEnemy(SimEnemy $e): void
    {
        $p = $this->p;
        if (!self::overlap($p->x, $p->y, self::PW, self::PH, $e->x + 4, $e->y + 4, $e->w - 8, $e->h - 4)) return;
        $fromAbove = $p->vy > 0 && $p->prevBottom <= $e->y + 14;
        if ($fromAbove && $e->kind !== 'spiky') {
            $this->combo++;
            $this->score += 100 * min($this->combo, 8);
            $p->vy = -($this->inp(8) ? self::STOMP_BOUNCE_HELD : self::STOMP_BOUNCE);
            $p->y = $e->y - self::PH;
            if ($e->kind === 'bird') {
                $this->knock($e, $p->facing);
            } else {
                $e->squashed = true;
                $e->deathTimer = 0.0;
            }
        } else {
            $this->hurt();
        }
    }

    private function knock(SimEnemy $e, int $dir): void
    {
        if ($e->squashed || $e->flipped) return;
        $e->flipped = true;
        $e->vx = (float) ($dir * 140);
        $e->vy = -480.0;
        $this->score += 200;
    }

    private function updateIcicles(float $dt): void
    {
        $p = $this->p;
        $T = self::T;
        foreach ($this->icicles as &$ic) {
            if ($ic['state'] === 0) {
                $pcx = $p->x + self::PW / 2;
                if (!$p->dead && $pcx > $ic['x'] - 1.2 * $T && $pcx < $ic['x'] + 2.2 * $T && $p->y > $ic['y']) {
                    $ic['state'] = 1;
                    $ic['timer'] = 0.45;
                }
            } elseif ($ic['state'] === 1) {
                $ic['timer'] -= $dt;
                if ($ic['timer'] <= 0) $ic['state'] = 2;
            } elseif ($ic['state'] === 2) {
                $ic['vy'] = min($ic['vy'] + 1800 * $dt, 1100.0);
                $ic['y'] += $ic['vy'] * $dt;
                $tx = self::fl(($ic['x'] + $T / 2) / $T);
                $ty = self::fl(($ic['y'] + 40) / $T);
                if ($this->solid($tx, $ty) || $this->oneWay($tx, $ty) || $ic['y'] > $this->h * $T) $ic['state'] = 3;
                foreach ($this->enemies as $e) {
                    if (!$e->squashed && !$e->flipped && self::overlap($ic['x'] + 12, $ic['y'], 24.0, 40.0, $e->x, $e->y, $e->w, $e->h)) $this->knock($e, 1);
                }
            }
            if ($ic['state'] < 3 && !$p->dead && self::overlap($p->x, $p->y, self::PW, self::PH, $ic['x'] + 12, $ic['y'], 24.0, 40.0)) $this->hurt();
        }
        unset($ic);
    }

    private function updateItems(float $dt): void
    {
        $T = self::T;
        for ($i = count($this->items) - 1; $i >= 0; $i--) {
            $it = &$this->items[$i];
            if ($it['emerge'] > 0) {
                $it['emerge'] -= $dt;
                $it['y'] -= $T / 0.5 * $dt;
                unset($it);
                continue;
            }
            if ($it['kind'] === 'snowflake') { unset($it); continue; }
            $it['vy'] = min($it['vy'] + self::GRAVITY * 0.8 * $dt, self::MAX_FALL);
            $it['x'] += $it['vx'] * $dt;
            if ($this->solid(self::fl(($it['x'] + self::sign($it['vx']) * 16) / $T), self::fl($it['y'] / $T))) $it['vx'] = -$it['vx'];
            $it['y'] += $it['vy'] * $dt;
            $by = self::fl(($it['y'] + 16) / $T);
            $bx = self::fl($it['x'] / $T);
            if ($it['vy'] > 0 && ($this->solid($bx, $by) || $this->oneWay($bx, $by))) {
                $it['y'] = $by * $T - 16;
                $it['vy'] = $it['kind'] === 'wing' ? -420.0 : 0.0;
            }
            $gone = $it['y'] > $this->h * $T + 50;
            unset($it);
            if ($gone) array_splice($this->items, $i, 1);
        }
    }

    private function updateSnowballs(float $dt): void
    {
        $T = self::T;
        for ($i = count($this->snowballs) - 1; $i >= 0; $i--) {
            $s = &$this->snowballs[$i];
            $s['life'] -= $dt;
            $s['vy'] = min($s['vy'] + 1600 * $dt, 900.0);
            $s['x'] += $s['vx'] * $dt;
            $dead = $s['life'] <= 0 || $s['y'] > $this->h * $T;
            if ($this->solid(self::fl(($s['x'] + self::sign($s['vx']) * 9) / $T), self::fl($s['y'] / $T))) $dead = true;
            $s['y'] += $s['vy'] * $dt;
            $bx = self::fl($s['x'] / $T);
            $by = self::fl(($s['y'] + 9) / $T);
            if ($s['vy'] > 0 && ($this->solid($bx, $by) || $this->oneWay($bx, $by))) {
                $s['y'] = $by * $T - 9;
                $s['vy'] = -380.0;
            }
            foreach ($this->enemies as $e) {
                if ($e->squashed || $e->flipped || !$e->active) continue;
                if (self::overlap($s['x'] - 10, $s['y'] - 10, 20.0, 20.0, $e->x, $e->y, $e->w, $e->h)) {
                    $this->knock($e, $s['vx'] >= 0 ? 1 : -1);
                    $dead = true;
                    break;
                }
            }
            unset($s);
            if ($dead) array_splice($this->snowballs, $i, 1);
        }
    }

    /** Same text format as Stage.StateHash() in C# / stateHash() in JS. */
    public function stateHash(): string
    {
        $b = static fn(float $d): string => bin2hex(pack('E', $d));
        $p = $this->p;
        $s = "{$this->timeTicks} {$this->score} {$this->coins} " . ($this->completed ? 1 : 0) . ' ' . ($p->dead ? 1 : 0)
            . ' ' . $b($p->x) . ' ' . $b($p->y) . ' ' . $b($p->vx) . ' ' . $b($p->vy) . ' ' . $b($this->camX) . ' ' . count($this->enemies);
        foreach ($this->enemies as $e) $s .= ' ' . $b($e->x) . ',' . $b($e->y);
        return $s;
    }
}

final class SimPlayer
{
    public float $x = 0.0, $y = 0.0, $vx = 0.0, $vy = 0.0;
    public int $facing = 1;
    public bool $onGround = false;
    public float $coyote = 0.0, $buffer = 0.0;
    public int $power = 0;
    public bool $wings = false, $doubleUsed = false;
    public float $invuln = 0.0;
    public float $prevBottom = 0.0;
    public ?SimPlatform $riding = null;
    public bool $dead = false;
    public float $deadTimer = 0.0;
}

final class SimEnemy
{
    public string $kind;
    public float $w, $h, $x, $y, $ox, $oy;
    public float $vx = 0.0, $vy = 0.0;
    public int $facing = -1;
    public bool $active = false, $onGround = false, $squashed = false, $flipped = false;
    public float $deathTimer = 0.0, $t = 0.0, $hopTimer = 1.0;

    public static function create(string $kind, int $tx, int $ty): self
    {
        [$w, $h] = ['walker' => [40.0, 32.0], 'spiky' => [40.0, 34.0], 'bird' => [40.0, 28.0], 'hopper' => [36.0, 30.0]][$kind];
        $e = new self();
        $e->kind = $kind;
        $e->w = $w;
        $e->h = $h;
        $e->x = $e->ox = $tx * Sim::T + (Sim::T - $w) / 2;
        $e->y = $e->oy = $ty * Sim::T + Sim::T - $h;
        return $e;
    }
}

final class SimPlatform
{
    public float $x, $y, $dx = 0.0, $dy = 0.0;

    public function __construct(public float $ox, public float $oy, public int $wt, public bool $vertical, public float $phase)
    {
        $this->x = $ox;
        $this->y = $oy;
    }

    public function update(float $clock): void
    {
        $s = Sim::dsin($clock * 6.283185307179586 / 4.5 + $this->phase) * (3 * Sim::T);
        $nx = $this->vertical ? $this->ox : $this->ox + $s;
        $ny = $this->vertical ? $this->oy + $s : $this->oy;
        $this->dx = $nx - $this->x;
        $this->dy = $ny - $this->y;
        $this->x = $nx;
        $this->y = $ny;
    }
}
