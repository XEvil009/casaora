import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const root = process.cwd();
const svgPath = path.join(root, "public/casaora-icon.svg");
const svg = (await readFile(svgPath)).toString("utf8");

assert.match(svg, /viewBox="0 0 512 512"/);
assert.match(svg, /fill="#26372b"/);
assert.match(svg, /stroke="#ffffff"/);
assert.match(svg, /stroke="#d9bd78"/);

const SOURCE = 512;
const SCALE = 2;
const SIDE = SOURCE * SCALE;
const background = [38, 55, 43];
const white = [255, 255, 255];
const gold = [217, 189, 120];
const pixels = Buffer.alloc(SIDE * SIDE * 3);

const segments = [
  { points: [[112,250],[256,112]], width: 28, color: white },
  { points: [[256,112],[400,250]], width: 28, color: white },
  { points: [[400,250],[400,396]], width: 28, color: white },
  { points: [[400,396],[112,396]], width: 28, color: white },
  { points: [[112,396],[112,250]], width: 28, color: white },
  { points: [[205,396],[205,278]], width: 24, color: white },
  { points: [[205,278],[307,278]], width: 24, color: white },
  { points: [[307,278],[307,396]], width: 24, color: white },
  { points: [[282,166],[350,166]], width: 24, color: gold },
  { points: [[350,166],[350,234]], width: 24, color: gold },
];

function insideRoundedSquare(x, y) {
  const radius = 96;
  const cx = Math.max(radius, Math.min(SOURCE - radius, x));
  const cy = Math.max(radius, Math.min(SOURCE - radius, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function distanceToSegment(x, y, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1,
    ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared
  ));
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

for (let py = 0; py < SIDE; py++) {
  for (let px = 0; px < SIDE; px++) {
    const x = (px + 0.5) / SCALE;
    const y = (py + 0.5) / SCALE;
    let color = insideRoundedSquare(x, y) ? background : [255,255,255];

    for (const line of segments) {
      const [a, b] = line.points;
      if (distanceToSegment(x, y, a, b) <= line.width / 2) {
        color = line.color;
      }
    }

    const offset = (py * SIDE + px) * 3;
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
  }
}

function sample(x, y, width, height, channel) {
  const left = x * SIDE / width;
  const right = (x + 1) * SIDE / width;
  const top = y * SIDE / height;
  const bottom = (y + 1) * SIDE / height;
  let total = 0;
  let weightTotal = 0;

  for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++) {
    for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
      const weight =
        Math.max(0, Math.min(right, sx + 1) - Math.max(left, sx)) *
        Math.max(0, Math.min(bottom, sy + 1) - Math.max(top, sy));
      total += pixels[(sy * SIDE + sx) * 3 + channel] * weight;
      weightTotal += weight;
    }
  }

  return Math.round(total / weightTotal);
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

async function makePng(size, filename) {
  const raw = Buffer.alloc(size * (size * 3 + 1));

  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;

    for (let x = 0; x < size; x++) {
      const out = row + 1 + x * 3;
      raw[out] = sample(x, y, size, size, 0);
      raw[out + 1] = sample(x, y, size, size, 1);
      raw[out + 2] = sample(x, y, size, size, 2);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;

  const png = Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);

  const output = path.join(root, "public", filename);
  await writeFile(output, png);

  const saved = await readFile(output);
  assert.deepEqual(
    [...saved.subarray(0, 8)],
    [137,80,78,71,13,10,26,10]
  );
  assert.equal(saved.readUInt32BE(16), size);
  assert.equal(saved.readUInt32BE(20), size);

  console.log(`PASS ${filename}: ${size}x${size} PNG`);
}

await makePng(192, "icon-192x192.png");
await makePng(512, "icon-512x512.png");
await makePng(180, "apple-touch-icon.png");

console.log("All three PNG files passed structural checks.");
