<?php
use App\Game\Levels;
$worlds = [];
foreach ($levels as $id) $worlds[Levels::world($id)][] = $id;
?>
<h1><?= h(t('nav.leaderboard')) ?></h1>
<div class="levels">
  <?php foreach ($worlds as $w => $ids): ?>
    <div class="world"><span class="muted"><?= h(t('world.' . $w)) ?></span>
      <?php foreach ($ids as $id): ?>
        <a class="chip<?= $id === $level ? ' active' : '' ?>" href="<?= h(url('/leaderboard?level=' . rawurlencode($id) . '&by=' . $by)) ?>"><?= h($id) ?></a>
      <?php endforeach; ?>
    </div>
  <?php endforeach; ?>
</div>
<p class="tabs">
  <a class="<?= $by === 'time' ? 'active' : '' ?>" href="<?= h(url('/leaderboard?level=' . rawurlencode($level) . '&by=time')) ?>">⏱ <?= h(t('lb.time')) ?></a>
  <a class="<?= $by === 'score' ? 'active' : '' ?>" href="<?= h(url('/leaderboard?level=' . rawurlencode($level) . '&by=score')) ?>">★ <?= h(t('lb.score')) ?></a>
</p>
<?php if (!$entries): ?>
  <p class="muted"><?= h(t('lb.empty')) ?></p>
<?php else: ?>
<table class="board">
  <thead><tr><th>#</th><th><?= h(t('lb.player')) ?></th><th class="r"><?= h(t('lb.time_col')) ?></th><th class="r"><?= h(t('lb.score_col')) ?></th><th class="r"><?= h(t('lb.coins')) ?></th><th class="r hide-sm"><?= h(t('lb.date')) ?></th></tr></thead>
  <tbody>
  <?php foreach ($entries as $e): ?>
    <tr class="<?= $e['rank'] <= 3 ? 'top' . $e['rank'] : '' ?>">
      <td><?= h($e['rank']) ?></td>
      <td><?= h($e['name']) ?><?php if ($e['registered']): ?> <span class="badge" title="<?= h(t('lb.registered')) ?>">✓</span><?php endif; ?></td>
      <td class="r mono"><?= h(fmt_time($e['timeTicks'])) ?></td>
      <td class="r mono"><?= h(number_format($e['score'], 0, '.', '’')) ?></td>
      <td class="r"><?= h($e['coins']) ?></td>
      <td class="r hide-sm muted"><?= h(gmdate('Y-m-d', $e['at'])) ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>
<p class="muted small">🔒 <?= h(t('lb.verified')) ?></p>
