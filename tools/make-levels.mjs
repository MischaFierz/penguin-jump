// Generates shared/levels/*.txt from compact level scripts and checks that each
// level can be finished (approximate jump-reachability check).
// Usage: node tools/make-levels.mjs
// You can also edit the .txt files directly; this script is just a convenient way to author them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'shared', 'levels');
const H = 15;

function level(id, world, width, signs, build) {
  const g = Array.from({ length: H }, () => Array(width).fill(' '));
  const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < H;
  const api = {
    s: (x, y, ch) => { if (inside(x, y)) g[y][x] = ch; },
    t: (x, y, str) => { [...str].forEach((c, i) => { if (c !== '.') api.s(x + i, y, c); }); },
    b: (x0, x1, y0, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) api.s(x, y, ch); },
    r: (x0, x1, y, ch) => api.b(x0, x1, y, y, ch),
    g: (x0, x1, top = 13) => api.b(x0, x1, top, H - 1, '#'),
    liquid: (x0, x1, top = 13) => api.b(x0, x1, top, H - 1, '~'),
    clear: (x0, x1, y0 = 0, y1 = H - 1) => api.b(x0, x1, y0, y1, ' '),
    width,
  };
  build(api);
  return { id, world, signs, rows: g.map(r => r.join('').replace(/\s+$/, '')) , width };
}

const L = [];

// ---------------- World 1: Snowy Shore ----------------
L.push(level('1-1', 1, 132, ['tut.move', 'tut.jump', 'tut.block', 'tut.stomp', 'tut.checkpoint', 'tut.run', 'tut.goal'], a => {
  a.g(0, 40); a.s(3, 12, '@'); a.s(6, 12, '!'); a.s(11, 12, '!');
  a.b(15, 16, 11, 12, '#'); a.t(15, 9, 'oo');
  a.s(19, 12, '!'); a.t(21, 10, '?BFB?'); a.t(21, 7, 'o.o.o');
  a.s(28, 12, '!'); a.s(34, 12, 'e');
  a.t(41, 9, 'ooo'); a.g(44, 82);
  a.b(50, 51, 11, 12, '#'); a.s(54, 12, 'e'); a.b(58, 59, 10, 12, '#'); a.t(58, 8, 'oo');
  a.s(62, 12, '!'); a.s(64, 12, 'C');
  a.r(68, 72, 10, '-'); a.t(68, 9, 'ooooo');
  a.s(75, 12, 'e'); a.s(79, 12, 'e');
  a.t(83, 9, 'ooo'); a.g(86, 131);
  a.s(88, 12, '!');
  for (let i = 0; i < 4; i++) a.b(95 + i, 95 + i, 12 - i, 12, '#');
  a.b(99, 99, 9, 12, '#'); a.b(100, 100, 10, 12, '#'); a.b(101, 101, 11, 12, '#'); a.b(102, 102, 12, 12, '#');
  a.t(97, 6, 'ooooo'); a.s(106, 10, '?'); a.t(108, 12, 'e');
  a.s(112, 12, '!'); a.s(120, 12, 'G');
}));

L.push(level('1-2', 1, 172, [], a => {
  a.g(0, 30); a.s(2, 12, '@');
  a.t(8, 10, 'B?B?B'); a.t(8, 7, 'ooooo');
  a.s(15, 12, 'e'); a.s(21, 12, 'h');
  a.b(24, 25, 11, 12, '#');
  a.t(31, 10, 'ooo'); a.g(34, 60);
  a.r(37, 41, 9, '-'); a.t(37, 8, 'ooooo');
  a.s(43, 12, 'e'); a.s(46, 12, 'e'); a.s(49, 10, 'F');
  a.b(53, 54, 10, 12, '#');
  a.t(61, 10, 'ooo'); a.g(64, 90);
  a.s(70, 12, 'C');
  a.s(76, 12, '*'); a.r(73, 80, 5, '-'); a.t(73, 4, 'oooooooo');
  a.s(84, 12, 'e'); a.s(87, 12, 'h');
  a.t(93, 11, 'MMM'); a.t(93, 8, 'ooo');
  a.g(100, 127);
  a.t(104, 10, '?B?B?'); a.s(106, 6, 'H');
  a.s(111, 12, 'e'); a.s(114, 12, 'e'); a.s(117, 12, 'h');
  for (let i = 0; i < 4; i++) a.b(120 + i, 120 + i, 12 - i, 12, '#');
  a.b(124, 127, 9, 12, '#'); a.t(124, 7, 'oooo');
  a.g(132, 171); a.t(128, 7, 'oooo');
  a.s(140, 12, 'e'); a.s(146, 10, '?'); a.s(148, 10, '?');
  a.s(160, 12, 'G');
}));

L.push(level('1-3', 1, 182, [], a => {
  a.g(0, 20); a.s(2, 12, '@');
  a.liquid(21, 26); a.r(22, 25, 10, 'x'); a.t(22, 8, 'oooo');
  a.g(27, 50); a.b(30, 31, 11, 12, '#'); a.s(36, 8, 'b'); a.s(41, 12, 'e'); a.t(43, 10, '?F?');
  a.liquid(51, 55); a.r(52, 54, 10, '-'); a.t(52, 9, 'ooo');
  a.g(56, 90); a.s(60, 8, 'b'); a.s(64, 12, 'h'); a.s(70, 12, 'C');
  a.s(75, 12, 'e'); a.s(77, 12, 'e'); a.t(80, 10, 'B?B'); a.s(81, 6, 'H');
  a.liquid(91, 100); a.t(94, 11, 'MMM'); a.t(94, 9, 'ooo');
  a.g(101, 140); a.t(108, 12, '^^'); a.s(115, 8, 'b'); a.s(119, 7, 'b');
  a.r(122, 127, 9, 'x'); a.t(122, 8, 'oooooo'); a.s(131, 12, 'e'); a.s(134, 12, 'h');
  a.liquid(141, 146); a.r(141, 146, 11, 'x');
  a.g(147, 181);
  for (let i = 0; i < 3; i++) a.b(151 + i, 151 + i, 12 - i, 12, '#');
  a.b(154, 156, 10, 12, '#'); a.t(154, 8, 'ooo');
  a.s(160, 12, 'e'); a.s(170, 12, 'G');
}));

// ---------------- World 2: Crystal Caves ----------------
L.push(level('2-1', 2, 172, [], a => {
  a.b(0, 171, 0, 1, '#');
  a.g(0, 35); a.s(2, 12, '@');
  a.s(10, 2, 'i'); a.s(14, 2, 'i');
  a.t(18, 10, '?S?'); a.s(24, 12, 's'); a.s(30, 12, 'e');
  a.t(36, 10, 'ooo'); a.g(39, 70);
  a.b(44, 60, 2, 8, '#'); a.t(45, 11, 'ooooooooooooooo'); a.s(50, 12, 'e'); a.s(56, 12, 's');
  a.b(62, 63, 11, 12, '#'); a.s(66, 12, 'C');
  a.r(72, 73, 11, '-'); a.g(75, 110);
  a.s(78, 2, 'i'); a.s(82, 2, 'i'); a.s(86, 2, 'i'); a.s(90, 12, 'h');
  a.t(94, 10, 'BBB?BBB'); a.s(97, 6, 'W'); a.s(104, 12, 's');
  a.t(113, 10, 'MMM'); a.t(113, 7, 'ooo');
  a.g(120, 171);
  a.s(128, 12, 'e'); a.s(131, 12, 'e'); a.s(134, 12, 's'); a.s(138, 2, 'i'); a.s(141, 2, 'i');
  for (let i = 0; i < 3; i++) a.b(145 + i, 145 + i, 12 - i, 12, '#');
  a.b(148, 150, 10, 12, '#'); a.t(148, 8, 'ooo');
  a.s(160, 12, 'G');
}));

L.push(level('2-2', 2, 182, [], a => {
  a.b(0, 181, 0, 1, '#');
  a.g(0, 24); a.s(2, 12, '@');
  a.t(7, 10, '?F?'); a.s(14, 12, 's'); a.s(18, 2, 'i'); a.s(21, 2, 'i');
  a.t(25, 12, '^^^^'); a.b(25, 28, 13, 14, '#'); a.r(25, 28, 9, '-'); a.t(25, 8, 'oooo');
  a.g(29, 60);
  a.b(33, 34, 10, 12, '#'); a.b(37, 38, 7, 12, '#'); a.t(37, 5, 'oo'); a.b(41, 42, 10, 12, '#');
  a.s(46, 12, 'e'); a.s(49, 12, 'h'); a.s(52, 12, 's'); a.t(55, 10, 'B?B');
  a.r(61, 66, 10, 'x'); a.t(61, 9, 'oooooo');
  a.g(67, 100); a.s(72, 12, 'C');
  a.b(76, 99, 2, 7, '#'); a.s(80, 8, 'i'); a.s(85, 8, 'i'); a.s(90, 8, 'i'); a.s(95, 8, 'i');
  a.t(78, 11, 'oooooooooooooooooooo'); a.s(88, 12, 'e');
  a.t(104, 9, 'V'); a.g(101, 102); a.b(101, 102, 13, 14, '#');
  a.clear(103, 106, 13, 14);
  a.g(107, 140, 7); a.t(110, 5, 'ooooo'); a.s(115, 6, 'e'); a.s(120, 6, 's'); a.t(124, 3, '?S?');
  a.s(130, 6, 'h');
  a.b(141, 141, 13, 14, '#');
  a.g(141, 181); a.t(142, 11, 'ooo');
  a.s(150, 12, 'e'); a.s(153, 12, 's'); a.s(156, 2, 'i');
  a.s(170, 12, 'G');
}));

L.push(level('2-3', 2, 192, [], a => {
  a.b(0, 191, 0, 1, '#');
  a.g(0, 20); a.s(2, 12, '@'); a.t(6, 10, '?S?');
  a.liquid(21, 30); a.r(22, 23, 10, '-'); a.r(27, 28, 9, '-'); a.t(22, 8, 'oo'); a.t(27, 7, 'oo');
  a.g(31, 70); a.s(35, 12, 's'); a.s(38, 12, 's'); a.s(42, 2, 'i'); a.s(45, 2, 'i');
  a.b(48, 49, 10, 12, '#'); a.b(52, 60, 2, 9, '#'); a.s(55, 12, 'e'); a.s(58, 12, 'e');
  a.s(64, 12, 'C'); a.t(66, 10, 'BHB');
  a.r(71, 76, 10, 'x'); a.r(77, 78, 8, '-'); a.r(79, 84, 10, 'x'); a.t(71, 9, 'oooooo'); a.t(79, 9, 'oooooo');
  a.g(85, 125); a.s(88, 8, 'b'); a.s(93, 8, 'b'); a.s(97, 12, 'h'); a.s(100, 12, 's');
  a.t(104, 12, '^^^'); a.r(103, 107, 9, '-'); a.t(110, 10, '?W?');
  a.s(116, 12, 'e'); a.s(118, 12, 'e'); a.s(120, 12, 'e');
  a.t(127, 11, 'MMM'); a.t(127, 8, 'ooo');
  a.g(135, 191); a.s(138, 12, 'C');
  a.b(142, 143, 11, 12, '#'); a.b(146, 147, 9, 12, '#'); a.b(150, 151, 7, 12, '#'); a.t(150, 5, 'oo');
  a.s(155, 12, 's'); a.s(158, 12, 's'); a.s(161, 2, 'i'); a.s(164, 2, 'i'); a.s(167, 2, 'i');
  a.s(180, 12, 'G');
}));

// ---------------- World 3: Aurora Peaks ----------------
L.push(level('3-1', 3, 182, [], a => {
  a.g(0, 22); a.s(2, 12, '@'); a.t(8, 10, '?F?');
  a.s(19, 12, '*'); a.g(23, 34, 7); a.t(24, 5, 'oooooooooo'); a.s(29, 6, 'e');
  a.r(36, 39, 8, '-'); a.r(42, 45, 9, '-'); a.t(36, 7, 'oooo'); a.t(42, 8, 'oooo');
  a.g(47, 70); a.s(50, 8, 'b'); a.s(55, 12, 'h'); a.s(60, 12, 'e'); a.s(64, 12, 'C');
  a.t(73, 11, 'MMM'); a.t(81, 10, 'MMM'); a.t(73, 8, 'ooo'); a.t(81, 7, 'ooo');
  a.g(89, 120); a.s(92, 12, '*'); a.r(90, 96, 4, '-'); a.t(90, 3, 'ooooooo'); a.s(95, 3, 'H');
  a.s(100, 8, 'b'); a.s(104, 7, 'b'); a.s(108, 12, 'e'); a.s(111, 12, 'h'); a.t(114, 10, 'B?B?B');
  a.r(121, 126, 10, 'x'); a.r(128, 133, 9, 'x'); a.t(121, 9, 'oooooo'); a.t(128, 8, 'oooooo');
  a.g(135, 181, 10); a.s(140, 9, 'e'); a.s(144, 9, 'e'); a.s(148, 5, 'b');
  a.s(170, 9, 'G');
}));

L.push(level('3-2', 3, 192, [], a => {
  a.g(0, 18); a.s(2, 12, '@'); a.t(6, 10, '?W?');
  a.t(20, 11, 'VVV'); a.g(24, 40, 7); a.t(26, 5, 'oooooo'); a.s(32, 6, 'h'); a.s(36, 6, 'e');
  a.t(42, 7, 'MMM'); a.t(42, 5, 'ooo');
  a.g(50, 72, 9); a.s(54, 8, 'e'); a.s(58, 4, 'b'); a.s(62, 8, 's'); a.s(66, 8, 'C'); a.t(68, 5, '?S?');
  a.r(74, 76, 10, 'x'); a.r(79, 81, 11, 'x'); a.r(84, 86, 10, 'x'); a.t(79, 9, 'ooo');
  a.g(88, 120); a.s(91, 12, '*'); a.r(94, 99, 4, '-'); a.t(94, 3, 'oooooo');
  a.s(102, 8, 'b'); a.s(106, 12, 'e'); a.s(109, 12, 's'); a.s(112, 12, 'h');
  a.t(122, 11, 'VVV'); a.g(126, 145, 7); a.s(130, 6, 'e'); a.s(134, 6, 'e'); a.s(138, 2, 'b');
  a.t(147, 8, 'MMM'); a.t(147, 6, 'ooo');
  a.g(155, 191); a.s(158, 12, 'C'); a.s(163, 12, 'h'); a.s(166, 12, 'h'); a.s(172, 8, 'b');
  a.s(182, 12, 'G');
}));

L.push(level('3-3', 3, 202, [], a => {
  a.g(0, 16); a.s(2, 12, '@'); a.t(6, 10, 'F.S');
  a.t(18, 11, 'MMM'); a.g(26, 34, 10); a.s(30, 9, 's');
  a.t(36, 10, 'MMM'); a.t(36, 8, 'ooo');
  a.g(44, 60); a.s(48, 12, '*'); a.r(46, 52, 4, '-'); a.t(46, 3, 'ooooooo');
  a.s(54, 8, 'b'); a.s(57, 12, 'e'); a.s(59, 12, 'C');
  a.r(62, 64, 10, 'x'); a.r(67, 69, 9, 'x'); a.r(72, 74, 8, 'x'); a.r(77, 79, 9, 'x'); a.t(67, 8, 'ooo'); a.t(72, 7, 'ooo');
  a.g(81, 110, 9); a.s(85, 8, 'h'); a.s(89, 4, 'b'); a.s(93, 8, 's'); a.s(97, 8, 'e'); a.t(100, 5, 'BHB');
  a.t(112, 10, 'VVV'); a.g(116, 130, 5); a.t(118, 3, 'oooooooooo'); a.s(124, 4, 'e');
  a.t(132, 7, 'MMM'); a.g(141, 170, 9); a.s(144, 8, 'C'); a.s(150, 8, 'h'); a.s(154, 8, 's'); a.s(158, 3, 'b'); a.s(162, 8, 'e');
  a.r(171, 173, 10, 'x'); a.r(176, 178, 11, 'x');
  a.g(180, 201); a.s(190, 12, 'G');
}));

// ---------------- World 4: Lava Lair ----------------
L.push(level('4-1', 4, 182, [], a => {
  a.b(0, 181, 0, 0, '#');
  a.g(0, 20); a.s(2, 12, '@'); a.t(7, 10, '?F?');
  a.liquid(21, 26); a.r(22, 25, 10, '-'); a.t(22, 9, 'oooo');
  a.g(27, 55); a.s(31, 12, 's'); a.t(35, 12, '^^'); a.s(40, 12, 'e'); a.s(44, 8, 'b'); a.t(48, 10, 'B?S?B');
  a.liquid(56, 64); a.t(58, 11, 'MMM'); a.t(58, 9, 'ooo');
  a.g(65, 100); a.s(68, 12, 'C'); a.s(73, 12, 'h'); a.s(76, 12, 's'); a.b(80, 81, 10, 12, '#'); a.t(83, 12, '^^^^'); a.b(87, 88, 10, 12, '#');
  a.s(91, 1, 'i'); a.s(94, 1, 'i'); a.s(97, 12, 'e');
  a.liquid(101, 112); a.r(102, 104, 10, 'x'); a.r(107, 109, 9, 'x'); a.t(102, 9, 'ooo'); a.t(107, 8, 'ooo'); a.r(111, 112, 10, '-');
  a.g(113, 181); a.s(117, 12, 'e'); a.s(120, 12, 'e'); a.s(123, 12, 's'); a.s(126, 8, 'b'); a.t(130, 10, 'BHB');
  a.s(135, 12, 'C'); a.t(140, 12, '^^^'); a.s(146, 12, 'h'); a.s(150, 12, 's');
  a.s(170, 12, 'G');
}));

L.push(level('4-2', 4, 192, [], a => {
  a.b(0, 191, 0, 0, '#');
  a.g(0, 16); a.s(2, 12, '@'); a.t(6, 10, '?W?');
  a.liquid(17, 40); a.t(19, 11, 'MMM'); a.g(27, 30, 10); a.b(27, 30, 11, 14, '#'); a.s(28, 9, 's'); a.t(33, 10, 'MMM'); a.t(19, 9, 'ooo'); a.t(33, 8, 'ooo');
  a.g(41, 70); a.s(44, 12, 'e'); a.s(47, 8, 'b'); a.s(50, 12, 's'); a.s(54, 12, 'C'); a.t(57, 10, '?F?'); a.s(63, 12, 'h'); a.s(66, 12, 'h');
  a.liquid(71, 80); a.t(73, 10, 'VVV'); a.g(77, 80, 8); a.b(77, 80, 9, 14, '#');
  a.g(81, 110, 8); a.s(84, 7, 'e'); a.s(88, 7, 's'); a.s(92, 3, 'b'); a.t(96, 7, '^^'); a.s(100, 7, 'e'); a.s(104, 7, 'h');
  a.liquid(111, 124); a.r(112, 114, 10, 'x'); a.r(117, 119, 9, 'x'); a.r(122, 124, 10, 'x'); a.t(117, 8, 'ooo');
  a.g(125, 191); a.s(128, 12, 'C'); a.s(132, 12, 's'); a.s(135, 12, 's'); a.t(138, 10, 'BHB'); a.s(144, 8, 'b'); a.s(148, 8, 'b');
  a.t(152, 12, '^^^'); a.s(158, 12, 'e'); a.s(161, 12, 'h');
  a.s(182, 12, 'G');
}));

L.push(level('4-3', 4, 212, [], a => {
  a.b(0, 211, 0, 0, '#');
  a.g(0, 14); a.s(2, 12, '@'); a.t(6, 10, 'F.S');
  a.liquid(15, 44); a.t(16, 11, 'MMM'); a.g(24, 26, 9); a.b(24, 26, 10, 14, '#'); a.s(25, 8, 's');
  a.t(28, 10, 'MMM'); a.g(36, 38, 8); a.b(36, 38, 9, 14, '#'); a.t(40, 11, 'MMM');
  a.g(45, 75); a.s(48, 12, 'C'); a.s(52, 12, 'e'); a.s(55, 12, 's'); a.s(58, 8, 'b'); a.s(62, 8, 'b'); a.t(66, 10, '?H?'); a.s(71, 12, 'h');
  a.liquid(76, 90); a.r(77, 79, 10, 'x'); a.r(82, 84, 9, 'x'); a.r(87, 89, 10, 'x'); a.t(82, 8, 'ooo');
  a.g(91, 125, 9); a.s(94, 8, 's'); a.s(97, 8, 's'); a.s(100, 1, 'i'); a.s(103, 1, 'i'); a.s(106, 1, 'i'); a.t(110, 8, '^^'); a.s(115, 8, 'e'); a.s(118, 8, 'h'); a.s(121, 4, 'b');
  a.liquid(126, 140); a.t(128, 10, 'VVV'); a.g(133, 136, 7); a.b(133, 136, 8, 14, '#'); a.s(134, 6, 'C');
  a.liquid(137, 150); a.t(143, 8, 'MMM');
  a.g(151, 211); a.s(155, 12, 's'); a.s(158, 12, 's'); a.s(161, 12, 'e'); a.s(164, 12, 'e'); a.s(167, 8, 'b'); a.s(170, 8, 'b');
  for (let i = 0; i < 5; i++) a.b(175 + i, 175 + i, 12 - i, 12, '#');
  a.b(180, 183, 8, 12, '#'); a.t(180, 6, 'oooo');
  a.s(200, 12, 'G');
}));

// ---------------- Reachability check ----------------
// Very rough model of the jump physics (see Physics constants in the game):
// max rise ~4 tiles when running, horizontal reach ~4 tiles walking / 6 running.
const SOLID = new Set(['#', 'B', '?', 'F', 'S', 'W', 'H', 'E', 'x']);
const ONEWAY = new Set(['-']);
function check(lv) {
  const W = lv.width, rows = lv.rows.map(r => r.padEnd(W, ' '));
  const at = (x, y) => (x < 0 || x >= W || y < 0) ? '#' : (y >= H ? ' ' : rows[y][x]);
  const standable = new Set();
  const key = (x, y) => x + ',' + y;
  const nodes = [];
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W; x++) {
    const below = at(x, y + 1);
    const here = at(x, y);
    if ((SOLID.has(below) || ONEWAY.has(below) || below === 'M' || below === 'V' || below === '*') && !SOLID.has(here) && here !== '^' && here !== '~') {
      standable.add(key(x, y)); nodes.push([x, y]);
    }
  }
  // Moving platforms: every tile in their path is (temporarily) standable.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = at(x, y);
    if (c === 'M') for (let d = -3; d <= 3; d++) if (y - 1 >= 0) { standable.add(key(x + d, y - 1)); nodes.push([x + d, y - 1]); }
    if (c === 'V') for (let d = -3; d <= 3; d++) if (y - 1 + d >= 0) { standable.add(key(x, y - 1 + d)); nodes.push([x, y - 1 + d]); }
  }
  let start, goal;
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '@') start = [x, y]; if (c === 'G') goal = [x, y]; }));
  if (!start || !goal) return 'missing @ or G';
  const seen = new Set([key(...start)]);
  const q = [start];
  while (q.length) {
    const [x, y] = q.shift();
    const spring = at(x, y + 1) === '*';
    const up = spring ? 9 : 4;
    for (const [nx, ny] of nodes) {
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      const dx = Math.abs(nx - x), dy = y - ny; // dy > 0: higher
      let ok = false;
      if (dy <= up) {
        const reach = spring ? 6 : dy >= 3 ? 4 : dy >= 1 ? 5 : 6;
        ok = dx <= reach + (dy < 0 ? Math.min(-dy, 4) : 0);
      }
      if (ok) { seen.add(k); q.push([nx, ny]); }
    }
  }
  return seen.has(key(...goal)) ? null : 'goal not reachable';
}

fs.mkdirSync(outDir, { recursive: true });
let failed = false;
const list = [];
for (const lv of L) {
  const err = check(lv);
  if (err) { console.error(`Level ${lv.id}: ${err}`); failed = true; }
  const file = `level${lv.id.replace('-', '_')}.txt`;
  const header = [`id=${lv.id}`, `world=${lv.world}`, `signs=${lv.signs.join(',')}`, '---'];
  fs.writeFileSync(path.join(outDir, file), header.concat(lv.rows).join('\n') + '\n');
  list.push(file);
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(list, null, 2) + '\n');
console.log(`Wrote ${L.length} levels to ${outDir}`);
if (failed) process.exit(1);
