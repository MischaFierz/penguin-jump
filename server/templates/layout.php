<?php
use App\Config;
use App\Controllers\Site;
use App\View;
$flash = View::takeFlash();
$here = (string) ($_SERVER['REQUEST_URI'] ?? '/');
?><!doctype html>
<html lang="<?= h(View::lang()) ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="same-origin">
  <meta name="color-scheme" content="light dark">
  <title><?= h($title ?? Config::gameName()) ?><?= ($title ?? '') !== Config::gameName() ? ' – ' . h(Config::gameName()) : '' ?></title>
  <link rel="icon" href="<?= h(url('/assets/icon.svg')) ?>" type="image/svg+xml">
  <link rel="stylesheet" href="<?= h(url('/assets/site.css')) ?>">
</head>
<body>
<header class="top">
  <a class="brand" href="<?= h(url('/')) ?>"><img src="<?= h(url('/assets/icon.svg')) ?>" alt="" width="36" height="36"><?= h(Config::gameName()) ?></a>
  <nav>
    <a href="<?= h(url('/play/')) ?>"><?= h(t('nav.play')) ?></a>
    <a href="<?= h(url('/community')) ?>"><?= h(t('nav.community')) ?></a>
    <a href="<?= h(url('/leaderboard')) ?>"><?= h(t('nav.leaderboard')) ?></a>
    <a href="<?= h(url('/konto/')) ?>"><?= h(Site::loggedIn() ? t('nav.account') : t('nav.login')) ?></a>
    <form method="post" action="<?= h(url('/lang')) ?>" class="inline langs"><?= csrf_field() ?>
      <input type="hidden" name="back" value="<?= h($here) ?>">
      <?php foreach (View::LANGS as $code => $name): ?>
        <button name="lang" value="<?= h($code) ?>" class="link<?= $code === View::lang() ? ' active' : '' ?>" title="<?= h($name) ?>"><?= h(strtoupper($code)) ?></button>
      <?php endforeach; ?>
    </form>
  </nav>
</header>
<main>
  <?php if ($flash): ?><p class="flash <?= h($flash['kind']) ?>"><?= h($flash['msg']) ?></p><?php endif; ?>
  <?= $content ?>
</main>
<footer>
  <a href="<?= h(url('/privacy')) ?>"><?= h(t('nav.privacy')) ?></a>
  <?php if (Config::repo() !== ''): ?> · <a href="https://github.com/<?= h(Config::repo()) ?>" rel="noopener noreferrer">GitHub</a><?php endif; ?>
</footer>
</body>
</html>
