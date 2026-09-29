<div class="narrow">
<h1><?= h(t('setup.title')) ?></h1>
<p><?= h(t('setup.text')) ?></p>
<?php if (!empty($error)): ?><p class="flash error"><?= h($error) ?></p><?php endif; ?>
<form method="post" action="<?= h(url('/setup')) ?>" class="form">
  <?= csrf_field() ?>
  <label><?= h(t('setup.token')) ?><input type="password" name="token" required autocomplete="off"></label>
  <label><?= h(t('form.username')) ?> (Admin-Panel)<input name="username" required minlength="3" maxlength="20" autocomplete="username"></label>
  <label><?= h(t('form.password')) ?><input type="password" name="password" required minlength="10" maxlength="128" autocomplete="new-password"></label>
  <label><?= h(t('form.password2')) ?><input type="password" name="password2" required minlength="10" maxlength="128" autocomplete="new-password"></label>
  <button class="button"><?= h(t('form.submit')) ?></button>
</form>
</div>
