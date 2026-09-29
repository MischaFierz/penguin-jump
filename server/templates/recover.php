<div class="narrow">
<h1><?= h(t('recover.title')) ?></h1>
<p class="muted"><?= h(t('recover.intro')) ?></p>
<?php if (!empty($error)): ?><p class="flash error"><?= h($error) ?></p><?php endif; ?>
<form method="post" action="<?= h(url('/recover')) ?>" class="form">
  <?= csrf_field() ?>
  <label><?= h(t('form.username')) ?><input name="username" autocomplete="username" required maxlength="20"></label>
  <label><?= h(t('recover.code')) ?><input name="code" autocomplete="off" required maxlength="40" placeholder="XXXXX-XXXXX-XXXXX-XXXXX"></label>
  <label><?= h(t('form.new_password')) ?><input type="password" name="password" autocomplete="new-password" required minlength="10" maxlength="128"></label>
  <label><?= h(t('form.password2')) ?><input type="password" name="password2" autocomplete="new-password" required minlength="10" maxlength="128"></label>
  <button class="button"><?= h(t('form.submit')) ?></button>
</form>
</div>
