<div class="narrow">
<h1><?= h(t('twofa.setup_title')) ?></h1>
<p><?= h(t('twofa.setup_text')) ?></p>
<?php if (!empty($error)): ?><p class="flash error"><?= h($error) ?></p><?php endif; ?>
<p><?= h(t('twofa.key')) ?>:</p>
<p class="code-box"><code><?= h(implode(' ', str_split((string) $secret, 4))) ?></code></p>
<details><summary class="small">otpauth://</summary><code class="hash"><?= h($uri) ?></code></details>
<form method="post" action="<?= h(url('/admin/2fa')) ?>" class="form">
  <?= csrf_field() ?>
  <label><?= h(t('form.code')) ?><input name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="7"></label>
  <button class="button"><?= h(t('form.submit')) ?></button>
</form>
</div>
