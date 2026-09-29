<div class="narrow">
<h1><?= h(t('nav.login')) ?></h1>
<?php if (!empty($error)): ?><p class="flash error"><?= h($error) ?></p><?php endif; ?>
<form method="post" action="<?= h(url('/login')) ?>" class="form">
  <?= csrf_field() ?>
  <label><?= h(t('form.username')) ?><input name="username" value="<?= h($username ?? '') ?>" autocomplete="username" required maxlength="20"></label>
  <label><?= h(t('form.password')) ?><input type="password" name="password" autocomplete="current-password" required maxlength="128"></label>
  <button class="button"><?= h(t('nav.login')) ?></button>
</form>
<p><a href="<?= h(url('/recover')) ?>"><?= h(t('login.forgot')) ?></a> · <?= h(t('login.no_account')) ?> <a href="<?= h(url('/register')) ?>"><?= h(t('nav.register')) ?></a></p>
</div>
