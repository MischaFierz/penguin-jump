<?php use App\Config; ?>
<div class="narrow">
<h1><?= h(t('privacy.title')) ?></h1>
<?php foreach (explode("\n", t('privacy.text')) as $line): ?>
  <?php if (str_starts_with($line, '- ')): ?><p class="bullet"><?= h(substr($line, 2)) ?></p><?php else: ?><p><?= h($line) ?></p><?php endif; ?>
<?php endforeach; ?>
<?php if ((string) Config::get('operator', '') !== ''): ?><h2><?= h(t('privacy.operator')) ?></h2><p class="pre"><?= h(Config::get('operator')) ?></p><?php endif; ?>
</div>
