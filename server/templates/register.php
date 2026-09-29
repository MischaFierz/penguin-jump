<div class="narrow">
<h1><?= h(t('nav.register')) ?></h1>
<p class="muted"><?= h(t('register.intro')) ?></p>
<?php if (!empty($error)): ?><p class="flash error"><?= h($error) ?></p><?php endif; ?>
<form method="post" action="<?= h(url('/register')) ?>" class="form">
  <?= csrf_field() ?>
  <label><?= h(t('form.username')) ?><input name="username" value="<?= h($username ?? '') ?>" autocomplete="username" required minlength="3" maxlength="20"><small><?= h(t('form.username_hint')) ?></small></label>
  <label><?= h(t('form.password')) ?><input type="password" name="password" autocomplete="new-password" required minlength="10" maxlength="128"><small><?= h(t('form.password_hint')) ?></small></label>
  <label><?= h(t('form.password2')) ?><input type="password" name="password2" autocomplete="new-password" required minlength="10" maxlength="128"></label>
  <button class="button"><?= h(t('nav.register')) ?></button>
</form>
</div>
