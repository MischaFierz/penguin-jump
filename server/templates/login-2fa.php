<div class="narrow">
<h1><?= h(t('twofa.title')) ?></h1>
<?php if (!empty($error)): ?><p class="flash error"><?= h($error) ?></p><?php endif; ?>
<p><?= h(t('twofa.text')) ?></p>
<form method="post" action="<?= h(url('/login/2fa')) ?>" class="form">
  <?= csrf_field() ?>
  <label><?= h(t('form.code')) ?><input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="7" autofocus></label>
  <button class="button"><?= h(t('form.submit')) ?></button>
</form>
</div>
