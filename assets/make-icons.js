// Generates the logo (SVG) and renders the PNG icons + Chrome Web Store promo tile.
//
//   node assets/make-icons.js            -> writes the SVGs
//   node assets/make-icons.js --png      -> also renders PNGs (needs Playwright)
//
// Logo: a microphone whose head is a dartboard, on a dark rounded badge.
'use strict';
const fs = require('fs');
const path = require('path');

const C = {
  bg1: '#24324a', bg2: '#0f1724',
  red: '#e2403a', green: '#1fa05a',
  cream: '#f4ead3', black: '#17191d',
  ring: '#0b0d10', steel: '#e8edf3', steelShade: '#aeb8c6',
};
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

const f = (n) => Math.round(n * 100) / 100;

// Annular sector between radii r1 < r2, angles in degrees (0 = up, clockwise).
function sector(cx, cy, r1, r2, a1, a2, fill) {
  const p = (r, a) => {
    const rad = ((a - 90) * Math.PI) / 180;
    return `${f(cx + r * Math.cos(rad))} ${f(cy + r * Math.sin(rad))}`;
  };
  return `<path fill="${fill}" d="M${p(r2, a1)} A${r2} ${r2} 0 0 1 ${p(r2, a2)} L${p(r1, a2)} A${r1} ${r1} 0 0 0 ${p(r1, a1)} Z"/>`;
}

// detail 2: real board (20 sectors, triple ring)   -> 128 px
// detail 1: 10 sectors, no triple ring             -> 32 / 48 px
// detail 0: cream disk, red double ring, red bull  -> 16 px
function board(cx, cy, r, detail) {
  const R = (k) => f(r * k);
  const out = [`<circle cx="${cx}" cy="${cy}" r="${f(r)}" fill="${C.ring}"/>`];
  if (detail === 0) {
    out.push(`<circle cx="${cx}" cy="${cy}" r="${R(0.8)}" fill="${C.red}"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${R(0.58)}" fill="${C.cream}"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${R(0.24)}" fill="${C.red}"/>`);
    return out.join('');
  }
  const n = detail === 2 ? 20 : 10;
  const step = 360 / n;
  for (let i = 0; i < n; i++) {
    const a1 = i * step - step / 2, a2 = a1 + step;
    const even = i % 2 === 0; // 20 is a dark wedge with a red double, like a real board
    const wedge = even ? C.black : C.cream;
    const color = even ? C.red : C.green;
    out.push(sector(cx, cy, R(0.16), R(0.86), a1, a2, wedge));
    out.push(sector(cx, cy, R(detail === 2 ? 0.74 : 0.68), R(0.86), a1, a2, color)); // double
    if (detail === 2) out.push(sector(cx, cy, R(0.44), R(0.54), a1, a2, color)); // triple
  }
  out.push(`<circle cx="${cx}" cy="${cy}" r="${R(detail === 2 ? 0.16 : 0.22)}" fill="${C.green}"/>`);
  out.push(`<circle cx="${cx}" cy="${cy}" r="${R(detail === 2 ? 0.075 : 0.11)}" fill="${C.red}"/>`);
  return out.join('');
}

// size: the square canvas. pad: transparent margin (Chrome store wants 16/128).
function logo({ size = 128, pad = 16, detail = 2 } = {}) {
  const s = (size - 2 * pad) / 96; // design units are a 96x96 badge
  const X = (v) => f(pad + v * s);
  const S = (v) => f(v * s);
  const big = detail === 2;
  const cx = X(48), cy = X(big ? 40 : 38), r = S(big ? 25 : 28);
  const holderR = S(big ? 31 : 34);
  const stroke = S(big ? 5.5 : detail === 1 ? 7.5 : 9);
  const baseY = X(big ? 84 : 86);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg2}"/>
    </linearGradient>
    <!-- userSpaceOnUse: a straight line has a zero-size bounding box, which breaks the default units -->
    <linearGradient id="steel" gradientUnits="userSpaceOnUse" x1="0" y1="${cy}" x2="0" y2="${baseY}">
      <stop offset="0" stop-color="${C.steel}"/><stop offset="1" stop-color="${C.steelShade}"/>
    </linearGradient>
  </defs>
  <rect x="${X(0)}" y="${X(0)}" width="${S(96)}" height="${S(96)}" rx="${S(22)}" fill="url(#bg)"/>
  <path d="M${f(cx - holderR)} ${cy} A${holderR} ${holderR} 0 0 0 ${f(cx + holderR)} ${cy}"
        fill="none" stroke="url(#steel)" stroke-width="${stroke}" stroke-linecap="round"/>
  <line x1="${cx}" y1="${f(cy + holderR)}" x2="${cx}" y2="${baseY}" stroke="url(#steel)" stroke-width="${stroke}"/>
  <line x1="${X(big ? 34 : 30)}" y1="${baseY}" x2="${X(big ? 62 : 66)}" y2="${baseY}" stroke="url(#steel)" stroke-width="${stroke}" stroke-linecap="round"/>
  ${board(cx, cy, r, detail)}
</svg>`;
}

function promoTile() {
  const icon = logo({ size: 176, pad: 0 }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1b2638"/><stop offset="1" stop-color="#0b1119"/>
    </linearGradient>
  </defs>
  <rect width="440" height="280" fill="url(#tile)"/>
  <g transform="translate(28 52)">${icon}</g>
  <g font-family="Segoe UI, Inter, Helvetica, Arial, sans-serif" fill="#f4f6fa">
    <text x="222" y="98" font-size="25" font-weight="700">Voice Corrector</text>
    <text x="223" y="124" font-size="17" font-weight="600" fill="#c9d2de">for Autodarts</text>
    <text x="223" y="160" font-size="15" fill="#aeb8c6">Fix misdetected darts</text>
    <text x="223" y="180" font-size="15" fill="#aeb8c6">by saying them out loud.</text>
    <g font-size="14" fill="${C.green}" font-family="Consolas, monospace">
      <text x="223" y="216">"correct second dart</text>
      <text x="223" y="235"> triple twenty"</text>
    </g>
  </g>
</svg>`;
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const files = {
  'logo.svg': logo({ size: 128, pad: 16, detail: 2 }),         // store icon: 96px art + 16px padding
  'logo-medium.svg': logo({ size: 128, pad: 0, detail: 1 }),   // 32 / 48 px: full bleed, 10 sectors
  'logo-tiny.svg': logo({ size: 128, pad: 0, detail: 0 }),     // 16 px: rings only
  'promo-440x280.svg': promoTile(),
};
for (const [name, svg] of Object.entries(files)) fs.writeFileSync(path.join(__dirname, name), svg);

if (process.argv.includes('--png')) {
  const pw = process.env.PLAYWRIGHT_MODULE || 'playwright';
  const { chromium } = require(pw);
  (async () => {
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    const page = await browser.newPage();
    const render = async (svg, w, h, out) => {
      await page.setViewportSize({ width: w, height: h });
      const sized = svg.replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`);
      await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
      await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
    };
    await render(files['logo.svg'], 128, 128, path.join(outDir, 'icon128.png'));
    await render(files['logo-tiny.svg'], 16, 16, path.join(outDir, 'icon16.png'));
    for (const n of [32, 48]) await render(files['logo-medium.svg'], n, n, path.join(outDir, `icon${n}.png`));
    await render(files['promo-440x280.svg'], 440, 280, path.join(__dirname, 'promo-440x280.png'));
    await browser.close();
    console.log('PNGs written');
  })();
}
