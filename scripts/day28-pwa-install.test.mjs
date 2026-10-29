import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import test from "node:test";

const read = (file) =>
  readFile(new URL(file, import.meta.url), "utf8");

const iconFiles = [
  { file: "../public/icon-192x192.png", size: 192 },
  { file: "../public/icon-512x512.png", size: 512 },
  { file: "../public/apple-touch-icon.png", size: 180 },
];

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 1)
        ? (crc >>> 1) ^ 0xedb88320
        : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(buffer) {
  const signature = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10,
  ]);

  assert.deepEqual(buffer.subarray(0, 8), signature);

  let offset = 8;
  let header;
  const imageData = [];
  let sawEnd = false;

  while (offset < buffer.length) {
    assert.ok(offset + 12 <= buffer.length, "Complete PNG chunk");

    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;

    assert.ok(crcOffset + 4 <= buffer.length, `${type} chunk bounds`);

    const typeBytes = buffer.subarray(offset + 4, offset + 8);
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(crcOffset);

    assert.equal(
      crc32(Buffer.concat([typeBytes, data])),
      expectedCrc,
      `${type} chunk CRC`,
    );

    if (type === "IHDR") {
      assert.equal(length, 13);
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "IDAT") {
      imageData.push(data);
    } else if (type === "IEND") {
      assert.equal(length, 0);
      sawEnd = true;
      offset = crcOffset + 4;
      break;
    }

    offset = crcOffset + 4;
  }

  assert.equal(offset, buffer.length, "No trailing PNG bytes");
  assert.ok(sawEnd, "PNG has IEND");
  assert.ok(header, "PNG has IHDR");
  assert.ok(imageData.length > 0, "PNG has image data");

  const decoded = inflateSync(Buffer.concat(imageData));

  assert.equal(header.bitDepth, 8);
  assert.equal(header.colorType, 2, "RGB PNG");
  assert.equal(header.compression, 0);
  assert.equal(header.filter, 0);
  assert.equal(header.interlace, 0);
  assert.equal(
    decoded.length,
    header.height * (1 + header.width * 3),
    "Decoded pixel data has expected length",
  );

  for (let y = 0; y < header.height; y++) {
    const filter = decoded[y * (1 + header.width * 3)];
    assert.ok(filter <= 4, `Valid PNG row filter at row ${y}`);
  }

  return header;
}

test("manifest declares both standard PNG installation icons", async () => {
  const source = await read("../src/app/manifest.ts");

  assert.match(source, /display:\s*"standalone"/);
  assert.match(source, /start_url:\s*"\/"/);
  assert.match(source, /scope:\s*"\/"/);
  assert.match(source, /lang:\s*"en-IN"/);

  for (const [file, size] of [
    ["icon-192x192.png", "192x192"],
    ["icon-512x512.png", "512x512"],
  ]) {
    assert.ok(source.includes(`/${file}`));
    assert.ok(source.includes(`sizes: "${size}"`));
    assert.ok(source.includes('type: "image/png"'));
  }

  assert.match(source, /casaora-icon\.svg/);
});

test("root metadata declares icons and Apple touch icon", async () => {
  const source = await read("../src/app/layout.tsx");

  assert.match(source, /applicationName:\s*"CASAORA"/);
  assert.match(source, /apple-touch-icon\.png/);
  assert.match(source, /sizes:\s*"180x180"/);
  assert.match(source, /openGraph:/);
  assert.match(source, /import "\.\/globals\.css"/);
  assert.match(source, /Geist_Mono/);
});

test("all generated icons are valid, fully decodable PNG files", async () => {
  for (const icon of iconFiles) {
    const buffer = await readFile(new URL(icon.file, import.meta.url));
    const metadata = inspectPng(buffer);

    assert.equal(metadata.width, icon.size, icon.file);
    assert.equal(metadata.height, icon.size, icon.file);

    console.log(`Verified ${icon.file}: ${icon.size}x${icon.size}`);
  }
});

test("icon generator uses Node built-ins without sharp", async () => {
  const source = await read("../scripts/generate-pwa-icons.mjs");

  assert.match(source, /node:zlib/);
  assert.match(source, /deflateSync/);
  assert.doesNotMatch(source, /from ["']sharp["']/);
});

test("health endpoint retains no-store response behavior", async () => {
  const source = await read("../src/app/api/health/route.ts");

  assert.match(source, /export async function GET/);
  assert.match(source, /status:\s*databaseReady\s*\?\s*"ok"\s*:\s*"degraded"/);
  assert.match(source, /service:\s*"casaora"/);
  assert.match(source, /checks:/);
  assert.match(source, /databaseReady/);
  assert.match(source, /unavailable/);
  assert.match(source, /Cache-Control/);
  assert.match(source, /no-store/);
});

test("environment template contains no populated secrets", async () => {
  const source = await read("../.env.example");

  assert.match(source, /NEXT_PUBLIC_APP_URL=http:\/\/localhost:3000/);
  assert.doesNotMatch(
    source,
    /(?:PASSWORD|SECRET|PRIVATE_KEY|ACCESS_TOKEN)\s*=\s*\S+/i,
  );
});
