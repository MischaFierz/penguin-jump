<h1><?= h(t('nav.account')) ?></h1>
<p><?= h(t('account.hello', (string) $user['username'])) ?></p>

<?php if ($scores): ?>
<h2><?= h(t('account.scores')) ?></h2>
<table class="board">
  <thead><tr><th><?= h(t('lb.level')) ?></th><th class="r"><?= h(t('lb.time_col')) ?></th><th class="r"><?= h(t('lb.score_col')) ?></th><th class="r"><?= h(t('lb.date')) ?></th></tr></thead>
  <tbody><?php foreach ($scores as $s): ?>
    <tr><td><a href="<?= h(url('/leaderboard?level=' . rawurlencode((string) $s['level_id']))) ?>"><?= h($s['level_id']) ?></a></td><td class="r mono"><?= h(fmt_time((int) $s['time_ticks'])) ?></td><td class="r mono"><?= h($s['score']) ?></td><td class="r muted"><?= h(gmdate('Y-m-d', (int) $s['created_at'])) ?></td></tr>
  <?php endforeach; ?></tbody>
</table>
<?php endif; ?>

<div class="cards">
  <form method="post" action="<?= h(url('/account/password')) ?>" class="form card">
    <h3><?= h(t('account.change_password')) ?></h3>
    <?= csrf_field() ?>
    <input type="text" name="username" value="<?= h($user['username']) ?>" autocomplete="username" hidden>
    <label><?= h(t('form.old_password')) ?><input type="password" name="old" autocomplete="current-password" required maxlength="128"></label>
    <label><?= h(t('form.new_password')) ?><input type="password" name="new" autocomplete="new-password" required minlength="10" maxlength="128"></label>
    <label><?= h(t('form.password2')) ?><input type="password" name="new2" autocomplete="new-password" required minlength="10" maxlength="128"></label>
    <button class="button"><?= h(t('account.change_password')) ?></button>
  </form>
  <form method="post" action="<?= h(url('/account/recovery')) ?>" class="form card">
    <h3><?= h(t('account.recovery')) ?></h3>
    <p class="muted small"><?= h(t('account.recovery_text')) ?></p>
    <?= csrf_field() ?>
    <label><?= h(t('form.password')) ?><input type="password" name="password" autocomplete="current-password" required maxlength="128"></label>
    <button class="button"><?= h(t('account.recovery')) ?></button>
  </form>
  <form method="post" action="<?= h(url('/account/delete')) ?>" class="form card danger">
    <h3><?= h(t('account.delete')) ?></h3>
    <p class="muted small"><?= h(t('account.delete_text')) ?></p>
    <?= csrf_field() ?>
    <label><?= h(t('form.password')) ?><input type="password" name="password" autocomplete="current-password" required maxlength="128"></label>
    <label class="check"><input type="checkbox" name="confirm" value="yes" required> <?= h(t('account.delete_confirm')) ?></label>
    <button class="button danger"><?= h(t('account.delete')) ?></button>
  </form>
</div>
