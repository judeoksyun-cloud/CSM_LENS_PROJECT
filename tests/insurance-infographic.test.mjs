import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const svg = read('outputs/insurance-claim-procedure-infographic.svg');
const html = read('outputs/insurance-claim-procedure-infographic.html');

for (const label of ['접수', '서류심사', '지급']) {
  assert.match(svg, new RegExp(label), `SVG should include ${label}`);
  assert.match(html, new RegExp(label), `HTML preview should include ${label}`);
}

assert.match(svg, /arrow/i, 'SVG should include arrow connectors');
assert.match(svg, /#0068ff/i, 'SVG should use a Samsung Life-inspired blue');
assert.match(svg, /#e7f2ff/i, 'SVG should use a pale blue landing-style panel');
assert.doesNotMatch(svg, /삼성생명|Samsung|logo|로고/i, 'SVG should not include company names or logos');
assert.doesNotMatch(html, /삼성생명|Samsung|logo|로고/i, 'HTML should not include company names or logos');

const pngUrl = new URL('../outputs/insurance-claim-procedure-infographic-preview.png', import.meta.url);
assert.ok(existsSync(pngUrl), 'PNG preview should exist');
assert.ok(statSync(pngUrl).size > 1000, 'PNG preview should not be empty');
