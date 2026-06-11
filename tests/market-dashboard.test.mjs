import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const html = read('index.html');
const css = read('styles.css');
const js = read('script.js');

assert.match(html, /시황\s*한\s*장/, 'page title should mention 시황 한 장');
assert.match(html, /id="today-label"/, 'header should include a date placeholder');
assert.match(html, /id="metric-grid"/, 'page should expose a metric grid');
assert.match(html, /class="market-nav"/, 'page should include a Binance-style top nav');
assert.match(html, /class="brand-mark"/, 'page should include a compact brand mark');

for (const label of ['기준금리', '원/달러 환율', '코스피', '국고채 3년']) {
  assert.match(js, new RegExp(label), `dummy data should include ${label}`);
}

assert.match(js, /TODO:\s*공개 API/, 'script should mark where public API integration belongs');
assert.match(css, /@media\s*\(max-width:\s*640px\)/, 'stylesheet should include mobile rules');
assert.match(css, /\.metric-card/, 'stylesheet should style metric cards');
assert.match(css, /--binance-yellow:\s*#fcd535/i, 'stylesheet should define Binance yellow');
assert.match(css, /--canvas-dark:\s*#0b0e11/i, 'stylesheet should define the dark canvas');
assert.match(css, /--surface-card-dark:\s*#1e2329/i, 'stylesheet should define dark card surfaces');
assert.match(css, /font-family:[\s\S]*BinanceNova/, 'stylesheet should use BinanceNova in the font stack');
assert.match(css, /font-family:[\s\S]*BinancePlex/, 'stylesheet should use BinancePlex for financial numbers');
assert.match(css, /\.metric-change--up[\s\S]*?color:\s*var\(--trading-up\)/, 'up moves should use trading green');
assert.match(css, /\.metric-change--down[\s\S]*?color:\s*var\(--trading-down\)/, 'down moves should use trading red');
