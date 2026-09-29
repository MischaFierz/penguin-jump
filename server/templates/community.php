<?php
$tabs = ['top' => t('community.top'), 'new' => t('community.new'), 'plays' => t('community.plays')];
$pages = max(1, (int) ceil($total / 20));
$link = static fn(array $p) => url('/community?' . http_build_query($p));
?>
<h1><?= h(t('nav.community')) ?></h1>
<p class="muted"><?= h(t('community.intro')) ?></p>
<p><a class="button" href="<?= h(url('/play/?scene=editor')) ?>">✎ <?= h(t('community.build')) ?></a></p>

<form method="get" action="<?= h(url('/community')) ?>" class="form row">
  <input type="hidden" name="sort" value="<?= h($sort) ?>">
  <input name="q" value="<?= h($q) ?>" placeholder="<?= h(t('community.search')) ?>" maxlength="40">
  <button class="button"><?= h(t('community.search_btn')) ?></button>
</form>
<p class="tabs">
  <?php foreach ($tabs as $k => $label): ?>
    <a class="<?= $sort === $k ? 'active' : '' ?>" href="<?= h($link(['sort' => $k, 'q' => $q])) ?>"><?= h($label) ?></a>
  <?php endforeach; ?>
</p>

<?php if (!$levels): ?>
  <p class="muted"><?= h(t('community.empty')) ?></p>
<?php else: ?>
<div class="cards">
  <?php foreach ($levels as $l): ?>
    <div class="card level-card world-<?= (int) $l['world'] ?>">
      <h3><?= h($l['title']) ?></h3>
      <p class="muted small"><?= h(t('community.by', $l['author'])) ?> · <?= h(t('world.' . $l['world'])) ?></p>
      <p class="small">♥ <?= (int) $l['likes'] ?> · ▶ <?= (int) $l['plays'] ?></p>
      <p>
        <a class="button" href="<?= h(url('/play/?community=' . rawurlencode($l['id']))) ?>">▶ <?= h(t('nav.play')) ?></a>
        <a href="<?= h(url('/leaderboard?level=' . rawurlencode($l['id']))) ?>"><?= h(t('nav.leaderboard')) ?></a>
      </p>
    </div>
  <?php endforeach; ?>
</div>
<?php if ($pages > 1): ?>
  <p class="pager">
    <?php if ($page > 1): ?><a href="<?= h($link(['sort' => $sort, 'q' => $q, 'page' => $page - 1])) ?>">←</a><?php endif; ?>
    <?= (int) $page ?> / <?= (int) $pages ?>
    <?php if ($page < $pages): ?><a href="<?= h($link(['sort' => $sort, 'q' => $q, 'page' => $page + 1])) ?>">→</a><?php endif; ?>
  </p>
<?php endif; ?>
<?php endif; ?>
