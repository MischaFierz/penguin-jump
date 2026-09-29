<?php
use App\Config;
$v = $version ?? null;
$dl = is_array($v['downloads'] ?? null) ? $v['downloads'] : [];
$labels = ['win-x64' => t('home.windows'), 'linux-x64' => t('home.linux'), 'android' => t('home.android')];
?>
<section class="hero">
  <img src="<?= h(url('/assets/icon.svg')) ?>" alt="" width="140" height="140">
  <div>
    <h1><?= h(Config::gameName()) ?></h1>
    <p class="lead"><?= h(t('home.tagline')) ?></p>
    <p><a class="button big" href="<?= h(url('/play/')) ?>">▶ <?= h(t('home.play_browser')) ?></a></p>
    <p class="muted"><?= h(t('home.play_hint')) ?></p>
  </div>
</section>

<section>
  <h2><?= h(t('home.downloads')) ?><?php if ($v): ?> <small><?= h(t('home.version', (string) $v['version'])) ?></small><?php endif; ?></h2>
  <?php if (!$dl): ?>
    <p class="muted"><?= h(t('home.no_release')) ?></p>
  <?php else: ?>
    <div class="cards">
      <?php foreach ($labels as $key => $label): if (empty($dl[$key]['url'])) continue; $u = (string) $dl[$key]['url']; ?>
        <div class="card">
          <h3><?= h($label) ?></h3>
          <?php if (preg_match('#^https://#', $u)): ?><a class="button" href="<?= h($u) ?>" rel="noopener noreferrer">⬇ <?= h(basename((string) parse_url($u, PHP_URL_PATH))) ?></a><?php endif; ?>
          <p class="muted small"><?= h($key === 'android' ? t('home.android_hint') : t('home.desktop_hint')) ?></p>
          <?php if (!empty($dl[$key]['sha256'])): ?><details><summary class="small"><?= h(t('home.checksum')) ?></summary><code class="hash"><?= h($dl[$key]['sha256']) ?></code></details><?php endif; ?>
        </div>
      <?php endforeach; ?>
    </div>
    <p class="muted small">🔒 <?= h(t('home.security')) ?></p>
  <?php endif; ?>
</section>

<section>
  <h2><?= h(t('home.features')) ?></h2>
  <ul class="features">
    <?php foreach (['home.f1', 'home.f2', 'home.f3', 'home.f4'] as $f): ?><li><?= h(t($f)) ?></li><?php endforeach; ?>
  </ul>
</section>
