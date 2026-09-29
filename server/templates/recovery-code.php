<div class="narrow">
<h1><?= h(t('recover.code_title')) ?></h1>
<p><?= h(!empty($afterRecover) ? t('recover.done') : t('recover.code_text')) ?></p>
<p class="code-box"><code><?= h($code) ?></code></p>
<p><a class="button" href="<?= h(url(!empty($afterRecover) ? '/login' : '/account')) ?>"><?= h(t('recover.continue')) ?></a></p>
</div>
