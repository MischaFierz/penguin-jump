<h1>Admin</h1>
<form method="get" action="<?= h(url('/admin')) ?>" class="form row"><input name="q" value="<?= h($q) ?>" placeholder="Name…" maxlength="20"><button class="button">Search</button></form>

<h2>Scores</h2>
<table class="board small">
  <thead><tr><th>#</th><th>Level</th><th>Name</th><th class="r">Time</th><th class="r">Score</th><th>Client</th><th>Date (UTC)</th><th></th></tr></thead>
  <tbody><?php foreach ($scores as $s): $hidden = (int) $s['hidden'] === 1; ?>
    <tr class="<?= $hidden ? 'hidden-row' : '' ?>">
      <td><?= h($s['id']) ?></td><td><?= h($s['level_id']) ?></td>
      <td><?= h($s['nickname']) ?><?= $s['account_id'] !== null ? ' ✓' : '' ?></td>
      <td class="r mono"><?= h(fmt_time((int) $s['time_ticks'])) ?></td><td class="r mono"><?= h($s['score']) ?></td>
      <td><?= h($s['client']) ?></td><td class="muted"><?= h(gmdate('Y-m-d H:i', (int) $s['created_at'])) ?></td>
      <td class="actions">
        <?php foreach (['verify', $hidden ? 'show' : 'hide', 'delete'] as $a): ?>
          <form method="post" action="<?= h(url('/admin/score')) ?>" class="inline"><?= csrf_field() ?><input type="hidden" name="id" value="<?= h($s['id']) ?>"><button class="link" name="action" value="<?= h($a) ?>"><?= h($a) ?></button></form>
        <?php endforeach; ?>
      </td>
    </tr>
  <?php endforeach; ?></tbody>
</table>

<h2>Accounts</h2>
<table class="board small">
  <thead><tr><th>#</th><th>Name</th><th>Created</th><th>Last login</th><th></th></tr></thead>
  <tbody><?php foreach ($accounts as $a): ?>
    <tr class="<?= (int) $a['disabled'] ? 'hidden-row' : '' ?>">
      <td><?= h($a['id']) ?></td><td><?= h($a['username']) ?><?= (int) $a['is_admin'] ? ' (admin)' : '' ?></td>
      <td class="muted"><?= h(gmdate('Y-m-d', (int) $a['created_at'])) ?></td>
      <td class="muted"><?= $a['last_login_at'] ? h(gmdate('Y-m-d', (int) $a['last_login_at'])) : '–' ?></td>
      <td class="actions"><?php if (!(int) $a['is_admin']): ?>
        <?php foreach ([(int) $a['disabled'] ? 'enable' : 'disable', 'hide_scores', 'reset', 'delete'] as $act): ?>
          <form method="post" action="<?= h(url('/admin/account')) ?>" class="inline"><?= csrf_field() ?><input type="hidden" name="id" value="<?= h($a['id']) ?>"><button class="link" name="action" value="<?= h($act) ?>"><?= h(str_replace('_', ' ', $act)) ?></button></form>
        <?php endforeach; ?>
      <?php endif; ?></td>
    </tr>
  <?php endforeach; ?></tbody>
</table>

<h2>Audit log</h2>
<table class="board small">
  <thead><tr><th>Time (UTC)</th><th>Action</th><th>Account</th><th>Detail</th><th>IP pseudonym</th></tr></thead>
  <tbody><?php foreach ($audit as $l): ?>
    <tr><td class="muted"><?= h(gmdate('Y-m-d H:i:s', (int) $l['at'])) ?></td><td><?= h($l['action']) ?></td><td><?= h($l['username'] ?? '') ?></td><td><?= h($l['detail']) ?></td><td class="mono muted"><?= h($l['ip_hash']) ?></td></tr>
  <?php endforeach; ?></tbody>
</table>
