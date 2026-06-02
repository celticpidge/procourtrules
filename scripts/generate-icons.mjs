// Generates PNG app icons from the source SVG for PWA / iOS home-screen install.
//
// Outputs (public/icons/):
//   apple-touch-icon-180.png  - iOS home screen (opaque, no alpha; iOS shows black on transparency)
//   icon-192.png              - manifest "any"
//   icon-512.png              - manifest "any"
//   icon-512-maskable.png     - manifest "maskable" (artwork padded into ~80% safe zone)
//
// Run with: npm run icons
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'public', 'icons', 'icon-192x192.svg');
const OUT_DIR = join(ROOT, 'public', 'icons');

// Opaque background used when flattening (matches manifest background_color).
const BG = '#0f0f0f';

async function renderOpaque(size, outName) {
  const out = join(OUT_DIR, outName);
  await sharp(SRC, { density: 384 })
    .resize(size, size, { fit: 'contain', background: BG })
    .flatten({ background: BG })
    .png()
    .toFile(out);
  return out;
}

async function renderMaskable(size, outName, safeZone = 0.8) {
  // Render the artwork into ~80% of the canvas so Android's mask doesn't clip it.
  const out = join(OUT_DIR, outName);
  const inner = Math.round(size * safeZone);
  const pad = Math.round((size - inner) / 2);

  const art = await sharp(SRC, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: BG })
    .png()
    .toBuffer();

  await sharp({
    create: { width: size, height: size, channels: 3, background: BG },
  })
    .composite([{ input: art, top: pad, left: pad }])
    .flatten({ background: BG })
    .png()
    .toFile(out);
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const results = [];
  results.push(await renderOpaque(180, 'apple-touch-icon-180.png'));
  results.push(await renderOpaque(192, 'icon-192.png'));
  results.push(await renderOpaque(512, 'icon-512.png'));
  results.push(await renderMaskable(512, 'icon-512-maskable.png'));

  for (const file of results) {
    const meta = await sharp(file).metadata();
    console.log(`  ${file}  ${meta.width}x${meta.height}  alpha=${meta.hasAlpha}`);
  }
  console.log(`Generated ${results.length} icons.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
