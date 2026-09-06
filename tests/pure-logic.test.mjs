import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'index.html'), 'utf8');

test('index.html script parses', () => {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, 'no <script> block');
  new vm.Script(m[1], {filename: 'index.html'}); // throws on syntax error
});

const block = html.match(/\/\/ PURE_LOGIC_START([\s\S]*?)\/\/ PURE_LOGIC_END/);
assert.ok(block, 'PURE_LOGIC block not found in index.html');
// runInThisContext + arrow wrapper: objects created in a separate vm realm fail strict deepEqual
// (different Object.prototype), and the wrapper keeps PURE out of this module's globals.
const PURE = vm.runInThisContext('(() => {' + block[1] + '\nreturn PURE;})()', {filename: 'pure-logic.js'});
const {sizeOf, distFactor, burstProfile, smallProfile, liftProfile, whistleProfile, whistleArbiter,
  sanitizeText, textLayout, normalizePoints, pickStep} = PURE;

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const allPositiveFinite = obj => Object.values(obj).every(v => Number.isFinite(v) && v > 0);

test('sizeOf maps power 0.5..1.25 to 0..1 and clamps', () => {
  assert.equal(sizeOf(0.5), 0);
  assert.equal(sizeOf(1.25), 1);
  assert.ok(near(sizeOf(0.875), 0.5));
  assert.equal(sizeOf(0.1), 0);
  assert.equal(sizeOf(2), 1);
});

test('distFactor follows clamp(1050/d, .35, 1.25)', () => {
  assert.ok(near(distFactor(1050), 1));
  assert.equal(distFactor(100), 1.25);
  assert.equal(distFactor(10000), 0.35);
});

test('burstProfile: bigger shells are deeper, longer, louder', () => {
  const big = burstProfile(1.2, 1000), small = burstProfile(0.6, 1000);
  assert.ok(allPositiveFinite(big) && allPositiveFinite(small));
  assert.ok(big.bassStart < small.bassStart);
  assert.ok(big.bassEnd < small.bassEnd);
  assert.ok(big.bassDecay > small.bassDecay);
  assert.ok(big.noiseDecay > small.noiseDecay);
  assert.ok(big.noiseCutoffStart < small.noiseCutoffStart);
  assert.ok(big.bodyHz < small.bodyHz);
  assert.ok(big.crackGain > small.crackGain);
  assert.ok(big.reverbSend > small.reverbSend);
  assert.ok(big.gain > small.gain);
  assert.equal(big.noiseCutoffEnd, 90);
});

test('burstProfile gain scales with distance factor', () => {
  assert.ok(burstProfile(1, 500).gain > burstProfile(1, 2000).gain);
});

test('smallProfile keeps the legacy short pop', () => {
  const p = smallProfile(0.75, 1050);
  assert.ok(allPositiveFinite(p));
  assert.equal(p.noiseCutoffStart, 2200);
  assert.equal(p.noiseCutoffEnd, 750);
  assert.equal(p.noiseDecay, 0.55);
  assert.ok(near(p.gain, 0.75));
  assert.equal('bassStart' in p, false);
});

test('liftProfile: bigger shells thump deeper and longer', () => {
  const big = liftProfile(1.2, 1000), small = liftProfile(0.6, 1000);
  assert.ok(allPositiveFinite(big) && allPositiveFinite(small));
  assert.ok(big.bassStart < small.bassStart);
  assert.ok(big.bassDecay > small.bassDecay);
  assert.ok(big.gain > small.gain);
  assert.equal(big.noiseCutoffStart, 380);
});

test('whistleProfile: small shells whistle higher, pitch rises, gap before boom', () => {
  const big = whistleProfile(1.2, 5.1, 1000), small = whistleProfile(0.6, 5.1, 1000);
  assert.ok(small.f0 > big.f0);
  assert.ok(big.f1 > big.f0 && small.f1 > small.f0);
  assert.ok(near(big.dur, 5.1 - big.endGap));
  assert.ok(big.endGap > small.endGap);
  assert.ok(big.noiseMix > small.noiseMix);
  assert.ok(big.noiseMix <= 1 && small.noiseMix >= 0);
  assert.ok(big.gain > small.gain);
  assert.equal(big.q, 14);
});

test('whistleProfile floors duration at 0.6s', () => {
  assert.equal(whistleProfile(1, 0.5, 1000).dur, 0.6);
});

test('whistleArbiter: start below cap', () => {
  assert.deepEqual(whistleArbiter([], {power: 0.6}), {action: 'start'});
  assert.deepEqual(whistleArbiter([{power: 1}, {power: 1}], {power: 0.6}), {action: 'start'});
});

test('whistleArbiter: skip weak incoming at cap', () => {
  const active = [{power: 0.9}, {power: 0.7}, {power: 1.0}];
  assert.deepEqual(whistleArbiter(active, {power: 0.75}), {action: 'skip'});
});

test('whistleArbiter: replace the weakest when incoming is >= 0.15 stronger', () => {
  const active = [{power: 0.9}, {power: 0.7}, {power: 1.0}];
  assert.deepEqual(whistleArbiter(active, {power: 0.9}), {action: 'replace', index: 1});
});

test('whistleArbiter: priority always starts; max is honoured', () => {
  const active = [{power: 0.9}, {power: 0.7}, {power: 1.0}];
  assert.deepEqual(whistleArbiter(active, {power: 0.5, priority: true}), {action: 'start'});
  assert.deepEqual(whistleArbiter([{power: 1}], {power: 0.5}, 1), {action: 'skip'});
});

test('sanitizeText strips ASCII and full-width whitespace', () => {
  assert.deepEqual(sanitizeText(' 祝　福 \n\t'), {chars: ['祝', '福'], truncated: false});
});

test('sanitizeText truncates to 6 graphemes', () => {
  const r = sanitizeText('ありがとうございます');
  assert.deepEqual(r.chars, ['あ', 'り', 'が', 'と', 'う', 'ご']);
  assert.equal(r.truncated, true);
});

test('sanitizeText treats emoji sequences as one character', () => {
  const r = sanitizeText('👨‍👩‍👧祝');
  assert.equal(r.chars.length, 2);
  assert.equal(r.chars[0], '👨‍👩‍👧');
});

test('sanitizeText handles empty, null and custom max', () => {
  assert.deepEqual(sanitizeText(''), {chars: [], truncated: false});
  assert.deepEqual(sanitizeText(null), {chars: [], truncated: false});
  assert.deepEqual(sanitizeText('abcd', 2), {chars: ['a', 'b'], truncated: true});
});

test('textLayout: single character sits at the centre', () => {
  const {rows, shells} = textLayout(['祝'], {halfWidth: 330});
  assert.equal(rows, 1);
  assert.equal(shells.length, 1);
  assert.equal(shells[0].x, 0);
  assert.equal(shells[0].y, 385);
  assert.equal(shells[0].delay, 0);
  assert.equal(shells[0].R, 110);
  assert.ok(near(shells[0].power, 110 / 115));
});

test('textLayout: two characters are symmetric and staggered', () => {
  const {shells} = textLayout(['感', '謝'], {halfWidth: 330});
  assert.equal(shells[0].R, 95);
  assert.ok(near(shells[0].x, -shells[1].x));
  assert.ok(near(shells[1].x - shells[0].x, 2.15 * 95));
  assert.ok(near(shells[1].delay, 0.32));
});

test('textLayout: three characters fit landscape without shrinking', () => {
  const {rows, shells} = textLayout(['は', 'な', 'び'], {halfWidth: 330});
  assert.equal(rows, 1);
  assert.equal(shells[0].R, 85);
  const extent = Math.max(...shells.map(s => Math.abs(s.x))) + shells[0].R;
  assert.ok(extent <= 330);
});

test('textLayout: six characters wrap to two rows in landscape', () => {
  const chars = ['あ', 'り', 'が', 'と', 'う', 'ね'];
  const {rows, shells} = textLayout(chars, {halfWidth: 330});
  assert.equal(rows, 2);
  assert.equal(shells[0].R, 75);
  assert.deepEqual(shells.slice(0, 3).map(s => s.y), [440, 440, 440]);
  assert.deepEqual(shells.slice(3).map(s => s.y), [330, 330, 330]);
  assert.ok(near(shells[3].delay, 0.96));
  assert.ok(near(shells[0].x, -shells[2].x));
  assert.ok(near(shells[1].x, 0));
});

test('textLayout: portrait shrinks R when even the wider row overflows', () => {
  const {rows, shells} = textLayout(['あ', 'り', 'が', 'と', 'う', 'ね'], {halfWidth: 223});
  assert.equal(rows, 2);
  assert.ok(shells[0].R < 75 && shells[0].R >= 40);
  const extent = Math.max(...shells.map(s => Math.abs(s.x))) + shells[0].R;
  assert.ok(extent <= 223 + 1e-6);
});

test('textLayout: fewer than four characters never wrap, they shrink', () => {
  const {rows, shells} = textLayout(['は', 'な', 'び'], {halfWidth: 223});
  assert.equal(rows, 1);
  assert.ok(shells[0].R < 85);
});

test('textLayout: R never drops below 40', () => {
  const {shells} = textLayout(['あ', 'り', 'が', 'と', 'う', 'ね'], {halfWidth: 60});
  assert.equal(shells[0].R, 40);
});

test('textLayout: empty input yields no shells', () => {
  assert.deepEqual(textLayout([], {halfWidth: 330}), {rows: 0, shells: []});
});

test('normalizePoints centres, scales the long side to [-1,1] and flips y', () => {
  const out = normalizePoints([10, 10, 30, 10, 10, 50]);
  assert.ok(ArrayBuffer.isView(out));
  assert.equal(out.length, 6);
  assert.ok(near(out[0], -0.5) && near(out[1], 1));
  assert.ok(near(out[2], 0.5) && near(out[3], 1));
  assert.ok(near(out[4], -0.5) && near(out[5], -1));
});

test('normalizePoints handles empty input', () => {
  assert.equal(normalizePoints([]).length, 0);
});

test('pickStep grows on too many points, shrinks on too few, within 2..6', () => {
  assert.equal(pickStep(400, 3), 4);
  assert.equal(pickStep(30, 3), 2);
  assert.equal(pickStep(100, 3), 3);
  assert.equal(pickStep(400, 6), 6);
  assert.equal(pickStep(10, 2), 2);
});
