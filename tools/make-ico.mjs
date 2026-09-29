// Packs PNG images into a Windows .ico file (PNG-compressed entries, supported since Windows Vista).
// Usage: node tools/make-ico.mjs <out.ico> <icon-16.png> <icon-32.png> <icon-48.png> <icon-256.png> ...
import fs from 'node:fs';

const [out, ...pngs] = process.argv.slice(2);
if (!out || !pngs.length) { console.error('usage: node tools/make-ico.mjs out.ico a.png b.png ...'); process.exit(2); }
const images = pngs.map(f => {
  const data = fs.readFileSync(f);
  if (data.readUInt32BE(0) !== 0x89504e47) throw new Error(f + ' is not a PNG');
  return { data, w: data.readUInt32BE(16), h: data.readUInt32BE(20) };
});
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(img.w >= 256 ? 0 : img.w, e); header.writeUInt8(img.h >= 256 ? 0 : img.h, e + 1);
  header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.data.length, e + 8); header.writeUInt32LE(offset, e + 12);
  offset += img.data.length;
});
fs.writeFileSync(out, Buffer.concat([header, ...images.map(i => i.data)]));
console.log(`${out}: ${images.map(i => i.w).join(', ')} px`);
