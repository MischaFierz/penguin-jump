'use strict';
// Entry point: canvas setup, scaling, main loop, service worker.

const canvas = document.getElementById('game');
g = canvas.getContext('2d');
Ui.ctx = g;
let scale = 1;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  scale = Math.min(w / VW, h / VH);
  const cw = Math.round(VW * scale), ch = Math.round(VH * scale);
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
}
window.addEventListener('resize', resize);
resize();

function toggleFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el)?.catch?.(() => {});
  else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
}

function updateRotateText() {
  const el = document.getElementById('rotate-text');
  if (el) el.textContent = Loc.t('web.rotate');
}

Save.load();
Loc.init(Save.data.language);
updateRotateText();
Audio.sfxVolume = Save.data.sfx;
Audio.musicVolume = Save.data.music;
Input.init(canvas);
Form.init();
if (matchMedia('(pointer: coarse)').matches) Input.isTouch = true;

// "?level=2-1" or "?scene=language" for quick testing
const params = new URLSearchParams(location.search);
if (params.get('level')) {
  const idx = Session.levels.findIndex(f => f.includes(params.get('level').replace('-', '_')));
  Scenes.start(new PlayScene(Math.max(0, idx)));
} else if (params.get('scene') === 'language') Scenes.start(new LanguageScene());
else if (params.get('scene') === 'levels') Scenes.start(new LevelSelectScene());
else if (params.get('scene') === 'account') Scenes.start(new AccountScene());
else if ((params.get('scene') || '').startsWith('board:')) Scenes.start(new LeaderboardScene(params.get('scene').slice(6), () => new LevelSelectScene()));
else Scenes.start(new TitleScene());

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  Input.update(dt);
  Scenes.update(dt);
  Audio.update();
  const k = canvas.width / VW;
  g.setTransform(k, 0, 0, k, 0, 0);
  g.clearRect(0, 0, VW, VH);
  Scenes.draw();
  Input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && Scenes.current instanceof PlayScene && Scenes.current.mode === 'playing') Scenes.current.setMode('paused');
  if (Audio.ctx) document.hidden ? Audio.ctx.suspend() : Audio.ctx.resume();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !Config.isAndroid) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
