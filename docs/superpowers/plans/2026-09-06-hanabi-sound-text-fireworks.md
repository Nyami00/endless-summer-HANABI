# HANABI 音の大きさ連動・ヒュー音・文字花火 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 単一ファイルの花火シミュレーター `index.html` に、玉の大きさで音色が変わる開花音、上昇中の「ヒュー」音、隠し機能の文字花火を追加する。

**Architecture:** 音のパラメータ表・文字配置・点群正規化などの純粋ロジックを `index.html` 内の `// PURE_LOGIC_START` 〜 `// PURE_LOGIC_END` ブロック（`const PURE = (() => {...})()`）に隔離し、Node 組込テストで `node:vm` により抽出・検証する。Web Audio の音声グラフは「コンテキストを引数に取る builder 関数」（`buildBurst` / `buildWhistle`）に分け、ライブ再生と `OfflineAudioContext` による自己診断（`?selftest=1`）で同じコードを使う。文字花火は既存の `heart` 型と同じ「2D 点群 → 初速ベクトル」方式で `'text'` 型の玉として実装し、隠し UI（T キー・ロゴ長押し・`?text=`）から `launchText()` を呼ぶ。

**Tech Stack:** Vanilla HTML/CSS/JS（ビルドレス・外部依存なし）、Web Audio API、Canvas 2D（点群化）、テストは Node 22 組込の `node:test` / `node:assert/strict` / `node:vm` のみ（npm パッケージ追加なし）。

**Spec:** `docs/superpowers/specs/2026-09-06-hanabi-sound-text-fireworks-design.md`

## Global Constraints

- 納品物は `index.html` 1 ファイル。`file://` 直開きで動作すること。外部 CDN・外部フォント・外部ライブラリ・`fetch` 通信は一切禁止
- 既存の見た目・操作・演出スコア（`score(...)` 群）・玉の物理は変えない。追加のみ。表の操作パネル（`.panel`）と `.hint` の文言には何も増やさない
- `index.html` は UTF-8（BOM なし）、改行 LF（`.gitattributes` で固定済み）。既存コードは 1 行に複数文を詰める密なスタイルだが、追加コードは読みやすさ優先で改行してよい（ただし既存行のスタイルを一括整形しない）
- リポジトリ `A:\HANABI`、作業ブランチ `feat/sound-and-text-fireworks`。各タスクの最後にコミットする。コミットメッセージは英語のコンベンショナルコミット形式で、末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける
- テストコマンドは常に `node --test`（`A:\HANABI` で実行）。全タスク終了時点で全テストが通ること
- サイズ値 `sizeOf(power) = clamp((power - 0.5) / 0.75, 0, 1)`、距離係数 `distFactor(d) = clamp(1050 / d, 0.35, 1.25)`。音のパラメータはすべて仕様 1.1 の表の値を使う（初期値。聴感調整は izawa が後で行う）
- 文字花火の上限は 6 文字、ヒューの同時発音は最大 3 本、文字玉は「同時 16 発」を 24 まで、星数上限を +900 までバイパスする
- 日本語入力の変換確定 Enter で文字花火が打ち上がってはならない（`isComposing` / `keyCode 229` / composition イベントの三重防御）
- パスに Windows ユーザー名をハードコードしない

## 現行コードの地図（Task 1 適用前の `index.html` の行番号）

| 行 | 内容 |
|---|---|
| 120–127 | IIFE 開始、`$`/`rand`/`pick`/`clamp`/`mix`/`smooth`、色 `C`、`PALETTES` |
| 128–130 | `surface`/`W`/`H`/`simTime`/`paused`、`soundOn` などの状態、`camera` |
| 259 | `const stars=[],embers=[],shells=[],smoke=[],lights=[],subshells=[],soundEvents=[];` |
| 272–276 | `addStar(x,y,z,vx,vy,vz,color,life,o={})`（星数上限 3100 / 2100） |
| 283–286 | `queueSound(x,y,z,power=1,kind='burst')` |
| 287–319 | `openShell(x,y,z,type,power,palette,mini)`（`heart` 分岐が 316–318 行） |
| 320–325 | `launch(type,x,y,z,power,palette)`（16 発上限、`lift` 音） |
| 326–345 | `updatePhysics(dt)`（玉の開花 329 行、音イベント配送 344 行） |
| 367–368 | `scoreTime` 等、`spread=()=>Math.min(1,W/H*.65+.35)` |
| 394–423 | `class Soundscape`（`init` / `play` / `mute`）と `const audio=new Soundscape()` |
| 429–433 | `step` / `frame` / `resumeLoop` |
| 434–439 | `tap(x,y)` |
| 440–479 | `setupInput()`（キー操作 458–463、Escape 469） |
| 480–487 | ブートストラップ（`for(let i=0;i<165;i++)step(1/60);` で 2.75 秒分プリロール） |
| 99 | 音ボタン `<button id="sound">` |
| 111–116 | `.bottom` パネル、`#restore`、`#notice` |

---

### Task 1: 純粋ロジックブロックと Node テスト

**Files:**
- Modify: `index.html`（`const PALETTES=...;` の直後、`let surface=...` の直前にブロックを挿入）
- Create: `tests/pure-logic.test.mjs`

**Interfaces:**
- Produces: `PURE = {sizeOf, distFactor, burstProfile, smallProfile, liftProfile, whistleProfile, whistleArbiter, sanitizeText, textLayout, normalizePoints, pickStep}`（後続タスクは IIFE 内で `const {sizeOf,...}=PURE;` と分割代入して使う）
  - `sizeOf(power:number) -> number`（0〜1）
  - `distFactor(d:number) -> number`（0.35〜1.25）
  - `burstProfile(power, d) -> {gain, crackGain, bodyHz, bodyDecay, bodyGain, bassStart, bassEnd, bassDecay, bassGain, noiseCutoffStart, noiseCutoffEnd, noiseDecay, reverbSend}`
  - `smallProfile(power, d) -> {gain, noiseCutoffStart, noiseCutoffEnd, noiseDecay, reverbSend}`
  - `liftProfile(power, d) -> {gain, noiseCutoffStart, noiseCutoffEnd, noiseDecay, bassStart, bassEnd, bassDecay, bassGain, reverbSend}`
  - `whistleProfile(power, duration, d) -> {f0, f1, endGap, dur, attack, release, sustainEnd, noiseMix, gain, vibratoHz, vibratoDepth, q, reverbSend}`
  - `whistleArbiter(active:{power}[], incoming:{power, priority?}, max=3) -> {action:'start'|'skip'|'replace', index?}`
  - `sanitizeText(input, max=6) -> {chars:string[], truncated:boolean}`
  - `textLayout(chars:string[], {halfWidth, baseY=385, stagger=0.32}) -> {rows:number, shells:{char,x,y,delay,R,power}[]}`
  - `normalizePoints(points:number[]) -> Float32Array`（入力は `[x0,y0,x1,y1,...]` キャンバス座標・y 下向き。出力は同じ並びで [-1,1]、y 上向き）
  - `pickStep(count, step) -> number`（2〜6）

- [ ] **Step 1: テストファイルを書く（失敗するテスト）**

`tests/pure-logic.test.mjs`:

```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `node --test`
Expected: `PURE_LOGIC block not found in index.html` で失敗（script parses テストは通る）

- [ ] **Step 3: `index.html` にブロックを挿入する**

`const PALETTES=[...];` の行（127 行）の直後に挿入:

```js
  // PURE_LOGIC_START
  // DOM・Web Audio に依存しない純粋ロジック。tests/pure-logic.test.mjs が node:vm で抽出して検証する。
  // 音の定数はすべてここに集約する（聴感調整はこの表だけを書き換える）。
  const PURE=(()=>{
    'use strict';
    const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
    // 0 = 3号玉相当, 1 = 尺玉相当
    const sizeOf=power=>clamp((power-.5)/.75,0,1);
    const distFactor=d=>clamp(1050/d,.35,1.25);
    function burstProfile(power,d){
      const s=sizeOf(power),dist=distFactor(d);
      return {
        gain:Math.pow(power,1.25)*dist,
        crackGain:mix(.15,.55,s),
        bodyHz:mix(170,105,s),bodyDecay:mix(.18,.30,s),bodyGain:.30,
        bassStart:mix(72,36,s),bassEnd:mix(32,20,s),bassDecay:mix(.4,1.1,s),bassGain:.66,
        noiseCutoffStart:mix(1900,850,s)*dist,noiseCutoffEnd:90,noiseDecay:mix(.9,2.8,s),
        reverbSend:mix(.7,1.3,s)
      };
    }
    function smallProfile(power,d){
      return {gain:power*distFactor(d),noiseCutoffStart:2200,noiseCutoffEnd:750,noiseDecay:.55,reverbSend:1};
    }
    function liftProfile(power,d){
      const s=sizeOf(power),dist=distFactor(d);
      return {gain:.35*power*dist,noiseCutoffStart:380,noiseCutoffEnd:90,noiseDecay:.38,bassStart:mix(80,55,s),bassEnd:30,bassDecay:mix(.3,.5,s),bassGain:.66,reverbSend:1};
    }
    function whistleProfile(power,duration,d){
      const s=sizeOf(power),dist=distFactor(d),f0=mix(1500,620,s),endGap=mix(.2,.35,s);
      return {f0,f1:f0*Math.pow(2,mix(3,5,s)/12),endGap,dur:Math.max(.6,duration-endGap),attack:.12,release:.08,sustainEnd:.55,
        noiseMix:mix(.35,.75,s),gain:mix(.09,.16,s)*dist,vibratoHz:5.5,vibratoDepth:mix(.004,.012,s),q:14,reverbSend:.5};
    }
    // 同時に鳴らす笛の裁定。active は鳴っている笛 [{power}], incoming は {power, priority}
    function whistleArbiter(active,incoming,max=3){
      if(incoming.priority)return {action:'start'};
      if(active.length<max)return {action:'start'};
      let index=0;for(let i=1;i<active.length;i++)if(active[i].power<active[index].power)index=i;
      if(incoming.power-active[index].power>=.15)return {action:'replace',index};
      return {action:'skip'};
    }
    const WHITESPACE=/[\s\u3000]+/g;
    function sanitizeText(input,max=6){
      const text=String(input??'').replace(WHITESPACE,'');
      const all=(typeof Intl!=='undefined'&&Intl.Segmenter)
        ?[...new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(text)].map(g=>g.segment)
        :Array.from(text);
      return {chars:all.slice(0,max),truncated:all.length>max};
    }
    // R = 開花 1.5 秒後の文字半径。全体幅が 2*halfWidth を超えたら 4 文字以上は 2 段、それでも超えたら R を縮める（下限 40）
    function textLayout(chars,{halfWidth,baseY=385,stagger=.32}){
      const n=chars.length;if(!n)return {rows:0,shells:[]};
      let R=n===1?110:n===2?95:n===3?85:75;
      const widthOf=k=>2.15*R*(k-1)+2*R;
      const rows=(widthOf(n)>2*halfWidth&&n>=4)?2:1;
      const perRow=rows===2?Math.ceil(n/2):n;
      if(widthOf(perRow)>2*halfWidth)R=Math.max(40,R*(2*halfWidth)/widthOf(perRow));
      const spacing=2.15*R,shells=[];
      for(let i=0;i<n;i++){
        const row=i<perRow?0:1,count=row===0?perRow:n-perRow,j=row===0?i:i-perRow;
        shells.push({char:chars[i],x:(j-(count-1)/2)*spacing,y:rows===2?(row===0?baseY+55:baseY-55):baseY,delay:i*stagger,R,power:clamp(R/115,.6,1.05)});
      }
      return {rows,shells};
    }
    // キャンバス座標の点列 [x0,y0,...]（y 下向き）を、bbox 中心を原点・長辺 [-1,1]・y 上向きに正規化
    function normalizePoints(points){
      if(points.length<2)return new Float32Array(0);
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      for(let i=0;i<points.length;i+=2){const x=points[i],y=points[i+1];if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
      const cx=(minX+maxX)/2,cy=(minY+maxY)/2,scale=2/Math.max(maxX-minX,maxY-minY,1e-6),out=new Float32Array(points.length);
      for(let i=0;i<points.length;i+=2){out[i]=(points[i]-cx)*scale;out[i+1]=-(points[i+1]-cy)*scale;}
      return out;
    }
    function pickStep(count,step){
      if(count>320)return Math.min(6,step+1);
      if(count<40)return Math.max(2,step-1);
      return step;
    }
    return Object.freeze({sizeOf,distFactor,burstProfile,smallProfile,liftProfile,whistleProfile,whistleArbiter,sanitizeText,textLayout,normalizePoints,pickStep});
  })();
  // PURE_LOGIC_END
  const {sizeOf,distFactor,burstProfile,smallProfile,liftProfile,whistleProfile,whistleArbiter,sanitizeText,textLayout,normalizePoints,pickStep}=PURE;
```

注意: ブロック内の `clamp` / `mix` は IIFE 外側の同名 const とは別スコープ（内側の関数スコープ）なので重複宣言にならない。ブロックの外側で `PURE` を分割代入する行はマーカーの外に置く（vm で評価されるのはマーカー内だけ）。

- [ ] **Step 4: テストを実行して全件通ることを確認する**

Run: `node --test`
Expected: すべて `ok`、`# fail 0`

- [ ] **Step 5: ブラウザで壊れていないことを確認する**

`index.html` を開いて、コンソールにエラーが出ず花火が上がることを確認する（Fable がブラウザツールで行う。実装者は Step 4 の `script parses` テストが通っていればよい）。

- [ ] **Step 6: コミット**

```bash
git add index.html tests/pure-logic.test.mjs
git commit -m "feat: add pure-logic block for sound profiles and text layout with node tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: ドン音の大きさ連動（Soundscape の再構成）

**Files:**
- Modify: `index.html` の `class Soundscape{...}`（Task 1 適用後は約 460 行付近。`class Soundscape` で検索）
- Modify: `launch()` 内の `queueSound(start,3,z,.32,'lift')` を `queueSound(start,3,z,power,'lift')` に

**Interfaces:**
- Consumes: `burstProfile` / `smallProfile` / `liftProfile`（Task 1）
- Produces:
  - `prepareBuffers(c:BaseAudioContext) -> {brown:AudioBuffer, white:AudioBuffer}`
  - `profileFor(kind:string, power:number, d:number) -> profile`（`lift` → liftProfile、`small`/`crackle` → smallProfile、それ以外 → burstProfile）
  - `buildBurst(c, bus:{dry:AudioNode, sub:AudioNode}, t:number, p:profile, buffers) -> {onended:Function|null}`（`voice.onended` は全ノードの後始末後に呼ばれる）
  - `Soundscape#bus(e) -> {dry, sub, release()}`（パン付きの出力先。`dry` は master と reverb 送り、`sub` は master 直結）
  - `Soundscape#buffers`（init 後に有効）
  - `Soundscape#renderOffline(kind, power, duration=5.1, distance=1000) -> Promise<Float32Array>`（44.1kHz モノラル。Task 3 で `whistle` にも対応させる）
  - `Soundscape#play(e)` は `e.kind` が `burst`/`small`/`crackle`/`lift` のとき打楽器系として処理する（35ms 連打制限と `active>18` はここだけに適用）

- [ ] **Step 1: builder 関数とバッファ生成を `class Soundscape` の直前に追加する**

```js
  // ---- 音声グラフの部品。ライブ再生（AudioContext）と自己診断（OfflineAudioContext）で共用する ----
  function prepareBuffers(c){
    const sr=c.sampleRate,brown=c.createBuffer(1,Math.floor(sr*2.5),sr),white=c.createBuffer(1,Math.floor(sr*1),sr);
    const b=brown.getChannelData(0);let acc=0;for(let i=0;i<b.length;i++){acc=(acc+(Math.random()*2-1)*.09)/1.025;b[i]=acc*2.7;}
    const w=white.getChannelData(0);for(let i=0;i<w.length;i++)w[i]=Math.random()*2-1;
    return {brown,white};
  }
  function profileFor(kind,power,d){
    if(kind==='lift')return liftProfile(power,d);
    if(kind==='small'||kind==='crackle')return smallProfile(power,d);
    return burstProfile(power,d);
  }
  // 打楽器系の 1 発。クラック(白ノイズ HPF) → ボディ(正弦波) → 低音(正弦波) → 本体(ブラウンノイズ LPF) を同時刻 t に開始する。
  // 低音とボディは bus.sub（master 直結）、それ以外は bus.dry（パン → master + reverb 送り）へ。
  function buildBurst(c,bus,t,p,buffers){
    const nodes=[],voice={onended:null};
    const link=(...chain)=>{for(let i=0;i<chain.length-1;i++)chain[i].connect(chain[i+1]);nodes.push(...chain.slice(0,-1));};
    // 各ソースの停止を予約しつつ、最後に止まるソースを覚えておく（後始末はそこに付ける）
    let lastSource=null,lastEnd=-Infinity;
    const scheduleStop=(node,end)=>{node.stop(end);if(end>lastEnd){lastEnd=end;lastSource=node;}};
    const src=c.createBufferSource(),lp=c.createBiquadFilter(),env=c.createGain();
    src.buffer=buffers.brown;src.loop=true;
    lp.type='lowpass';lp.frequency.setValueAtTime(p.noiseCutoffStart,t);lp.frequency.exponentialRampToValueAtTime(p.noiseCutoffEnd,t+p.noiseDecay);
    env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(p.gain*.82,t+.008);env.gain.exponentialRampToValueAtTime(.001,t+p.noiseDecay);
    link(src,lp,env,bus.dry);
    const end=t+p.noiseDecay+.05;src.start(t);scheduleStop(src,end);
    if(p.crackGain){
      const crack=c.createBufferSource(),hp=c.createBiquadFilter(),cenv=c.createGain();
      crack.buffer=buffers.white;hp.type='highpass';hp.frequency.value=2500;
      cenv.gain.setValueAtTime(0,t);cenv.gain.linearRampToValueAtTime(p.gain*p.crackGain,t+.002);cenv.gain.exponentialRampToValueAtTime(.001,t+.015);
      link(crack,hp,cenv,bus.dry);crack.start(t);scheduleStop(crack,t+.03);
    }
    if(p.bodyHz){
      const body=c.createOscillator(),benv=c.createGain();
      body.type='sine';body.frequency.setValueAtTime(p.bodyHz,t);body.frequency.exponentialRampToValueAtTime(p.bodyHz*.5,t+p.bodyDecay);
      benv.gain.setValueAtTime(0,t);benv.gain.linearRampToValueAtTime(p.gain*p.bodyGain,t+.006);benv.gain.exponentialRampToValueAtTime(.001,t+p.bodyDecay);
      link(body,benv,bus.sub);body.start(t);scheduleStop(body,t+p.bodyDecay+.02);
    }
    if(p.bassStart){
      const bass=c.createOscillator(),genv=c.createGain();
      bass.type='sine';bass.frequency.setValueAtTime(p.bassStart,t);bass.frequency.exponentialRampToValueAtTime(p.bassEnd,t+p.bassDecay);
      genv.gain.setValueAtTime(0,t);genv.gain.linearRampToValueAtTime(p.gain*p.bassGain,t+.013);genv.gain.exponentialRampToValueAtTime(.001,t+p.bassDecay+.2);
      link(bass,genv,bus.sub);bass.start(t);scheduleStop(bass,t+p.bassDecay+.25);
    }
    // 後始末は最後に止まるソースの onended に付ける（lift は低音がノイズ本体より長く鳴るため src では早すぎる）
    lastSource.onended=()=>{nodes.forEach(n=>{try{n.disconnect();}catch{}});if(voice.onended)voice.onended();};
    return voice;
  }
```

- [ ] **Step 2: `class Soundscape` を書き換える**

既存の `class Soundscape{...}` 全体（`constructor` から `mute` まで）を次で置き換える:

```js
  class Soundscape{
    constructor(){this.ctx=null;this.last=0;this.active=0;this.buffers=null;}
    async init(){
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Audio unavailable');
      if(!this.ctx){const c=this.ctx=new AC(),sr=c.sampleRate;
        this.master=c.createGain();this.master.gain.value=.48;const compressor=c.createDynamicsCompressor();compressor.threshold.value=-16;compressor.knee.value=18;compressor.ratio.value=4;this.master.connect(compressor);compressor.connect(c.destination);
        this.reverb=c.createConvolver();const impulse=c.createBuffer(2,Math.floor(sr*3.2),sr);
        for(let channel=0;channel<2;channel++){const data=impulse.getChannelData(channel);for(let i=0;i<data.length;i++){const t=i/sr;data[i]=(Math.random()*2-1)*Math.exp(-t*2.4)*.2*(t>.09?1:0);}}
        this.reverb.buffer=impulse;this.wet=c.createGain();this.wet.gain.value=.24;this.reverb.connect(this.wet);this.wet.connect(this.master);
        this.buffers=prepareBuffers(c);
      }
      await this.ctx.resume();
    }
    // 音源位置に応じたパン付きの出力先。dry は master と reverb（送り量 reverbSend）へ、sub は master 直結。
    bus(e,reverbSend=1){
      const c=this.ctx,dry=c.createStereoPanner?c.createStereoPanner():c.createGain(),send=c.createGain();
      if(dry.pan){const p=project(e.x,e.y,e.z);dry.pan.value=clamp(p?(p.x/W-.5)*1.6:0,-.9,.9);}
      send.gain.value=reverbSend;dry.connect(this.master);dry.connect(send);send.connect(this.reverb);
      return {dry,sub:this.master,release(){try{dry.disconnect();send.disconnect();}catch{}}};
    }
    play(e){
      const c=this.ctx;if(!c||c.state!=='running')return;const now=c.currentTime,t=now+.005;
      if(this.active>18||now-this.last<.035)return;this.last=now;this.active++;
      const p=profileFor(e.kind,e.power,e.d),bus=this.bus(e,p.reverbSend);
      const voice=buildBurst(c,bus,t,p,this.buffers);
      voice.onended=()=>{this.active--;bus.release();};
    }
    // 自己診断用: 同じ builder で OfflineAudioContext に描画し、モノラルの波形を返す
    async renderOffline(kind,power,duration=5.1,distance=1000){
      const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!OAC)throw new Error('OfflineAudioContext unavailable');
      const sr=44100,c=new OAC(1,Math.ceil(sr*(duration+1)),sr),buffers=prepareBuffers(c),master=c.createGain();master.connect(c.destination);
      const bus={dry:master,sub:master,release(){}};
      buildBurst(c,bus,.05,profileFor(kind,power,distance),buffers);
      return (await c.startRendering()).getChannelData(0);
    }
    async mute(value){if(!this.ctx)return;if(value)await this.ctx.suspend();else if(soundOn)await this.ctx.resume();}
  }
  const audio=new Soundscape();
```

- [ ] **Step 3: `launch()` の lift 音に power を渡す**

`queueSound(start,3,z,.32,'lift');` → `queueSound(start,3,z,power,'lift');`

- [ ] **Step 4: テストを実行する**

Run: `node --test`
Expected: 全件 `ok`（`script parses` が構文の破損を検出する）

- [ ] **Step 5: ブラウザ確認（Fable のチェックポイント）**

`index.html` を開き、音ボタンを押して再生。コンソールにエラーがないこと。開発者コンソールで次を実行して大玉と小玉の波形が返ること:

```js
// ?debug=1 は Task 4 で入るので、この時点では audio を直接触れない。代わりに selftest は Task 3 で入る。
// ここではエラーが出ないこと、開花時に音が鳴ることを目視・耳で確認する。
```

- [ ] **Step 6: コミット**

```bash
git add index.html
git commit -m "feat: scale boom sound by shell size with crack, body and sub-bass layers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: ヒュー音（合成・予約・裁定・自己診断）

**Files:**
- Modify: `index.html`
  - `queueSound()` に `extra` 引数
  - `launch()` に `extra` 引数と whistle の予約
  - `tap()` の `launch(...)` 呼び出しに `{priority:true}`
  - `buildBurst` の直後に `buildWhistle`
  - `class Soundscape`: `whistles` 配列、`play()` の whistle 分岐、`renderOffline` の whistle 対応
  - `runSelfTest()` と `?selftest=1` の起動
  - IIFE 冒頭（`const {sizeOf,...}=PURE;` の直後）に `const params=new URLSearchParams(location.search);`

**Interfaces:**
- Consumes: `whistleProfile` / `whistleArbiter`（Task 1）、`prepareBuffers` / `Soundscape#bus` / `buildBurst`（Task 2）
- Produces:
  - `queueSound(x,y,z,power=1,kind='burst',extra={})`（イベントに `extra` の内容が展開される: `{duration, priority}`）
  - `launch(type,x,y,z,power,palette,extra={})`（Task 4 が `extra.glyph` / `extra.R` を追加で使う。`extra.priority` は whistle の優先度）
  - `buildWhistle(c, bus, t, p, buffers) -> voice:{power, stop(fade=.15), onended}`
  - `Soundscape#whistles: voice[]`
  - `runSelfTest() -> Promise<{name,pass,detail}[]>`（Task 4 が glyph 検査を追記する）、`window.HANABI_SELFTEST`
  - `params: URLSearchParams`

- [ ] **Step 1: `params` を定義する**

`const {sizeOf,...}=PURE;` の直後に:

```js
  const params=new URLSearchParams(location.search);
```

- [ ] **Step 2: `queueSound` に extra を追加する**

```js
  function queueSound(x,y,z,power=1,kind='burst',extra={}){
    const d=Math.hypot(x-camera.eye[0],y-camera.eye[1],z-camera.eye[2]);soundEvents.push({at:simTime+d/343,x,y,z,d,power,kind,...extra});
    if(soundEvents.length>100)soundEvents.shift();
  }
```

- [ ] **Step 3: `launch` に extra を追加し、whistle を予約する**

```js
  function launch(type='yae',x=0,y=400,z=0,power=1,palette=pick(PALETTES),extra={}){
    if(shells.length>=16)return;
    const stations=[-300,-150,0,150,300],start=stations.reduce((a,b)=>Math.abs(b-x)<Math.abs(a-x)?b:a,0),duration=4.55+y*.0015,drag=.35,F=(1-Math.exp(-drag*duration))/drag;
    shells.push({x:start,y:3,z,startX:start,startY:3,startZ:z,vx:(x-start)/F,vy:(y-3+9.81/drag*(duration-F))/F,vz:0,drag,duration,age:0,type,power,palette,tx:x,ty:y,tz:z,emit:0,hist:[],extra});
    puff(start,3,z,12,7);flash(start,3,z,C.gold,.18);
    queueSound(start,3,z,power,'lift');
    queueSound(start,3,z,power,'whistle',{duration,priority:!!extra.priority});
  }
```

`tap()` 内の `launch(pick([...]),tx,ty,rand(-40,70),rand(.8,1));` を `launch(pick([...]),tx,ty,rand(-40,70),rand(.8,1),pick(PALETTES),{priority:true});` に変える。

- [ ] **Step 4: `buildWhistle` を `buildBurst` の直後に追加する**

```js
  // 上昇音「ヒュー」。正弦波(笛) + バンドパス白ノイズ(息) を noiseMix で混ぜ、f0 → f1 へ指数ランプ。
  // 返す voice は {power, stop(fade), onended}。stop() は差し替え時のフェードアウト用。
  function buildWhistle(c,bus,t,p,buffers){
    const end=t+p.dur+p.release+.05,nodes=[];
    const env=c.createGain();
    env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(p.gain,t+p.attack);
    env.gain.exponentialRampToValueAtTime(Math.max(.0005,p.gain*p.sustainEnd),t+p.dur);env.gain.linearRampToValueAtTime(0,t+p.dur+p.release);
    env.connect(bus.dry);
    const osc=c.createOscillator(),tone=c.createGain(),lfo=c.createOscillator(),depth=c.createGain();
    osc.type='sine';osc.frequency.setValueAtTime(p.f0,t);osc.frequency.exponentialRampToValueAtTime(p.f1,t+p.dur);tone.gain.value=1-p.noiseMix;
    lfo.type='sine';lfo.frequency.value=p.vibratoHz;depth.gain.value=p.f0*p.vibratoDepth;
    lfo.connect(depth);depth.connect(osc.frequency);osc.connect(tone);tone.connect(env);
    const src=c.createBufferSource(),bp=c.createBiquadFilter(),breath=c.createGain();
    src.buffer=buffers.white;src.loop=true;bp.type='bandpass';bp.Q.value=p.q;
    bp.frequency.setValueAtTime(p.f0,t);bp.frequency.exponentialRampToValueAtTime(p.f1,t+p.dur);
    breath.gain.value=p.noiseMix*2.5; // Q=14 のバンドパスで落ちる分を補う
    src.connect(bp);bp.connect(breath);breath.connect(env);
    nodes.push(env,osc,tone,lfo,depth,src,bp,breath);
    osc.start(t);lfo.start(t);src.start(t);osc.stop(end);lfo.stop(end);src.stop(end);
    const voice={power:0,onended:null,stop(fade=.15){
      // 生成と同じ tick で止められると now<t で予約が全消去され env.gain.value が既定値 1 を返すため、その場合は 0 から落とす
      const now=c.currentTime,from=now<t?0:env.gain.value;
      env.gain.cancelScheduledValues(now);env.gain.setValueAtTime(from,now);env.gain.linearRampToValueAtTime(0,now+fade);
      const at=now+fade+.01;osc.stop(at);lfo.stop(at);src.stop(at);
    }};
    osc.onended=()=>{nodes.forEach(n=>{try{n.disconnect();}catch{}});if(voice.onended)voice.onended();};
    return voice;
  }
```

- [ ] **Step 5: `Soundscape` に whistle を組み込む**

`constructor` を `constructor(){this.ctx=null;this.last=0;this.active=0;this.buffers=null;this.whistles=[];}` に。

`play(e)` を次で置き換える:

```js
    play(e){
      const c=this.ctx;if(!c||c.state!=='running')return;const now=c.currentTime,t=now+.005;
      if(e.kind==='whistle'){
        const verdict=whistleArbiter(this.whistles,{power:e.power,priority:!!e.priority});
        if(verdict.action==='skip')return;
        if(verdict.action==='replace'){const [old]=this.whistles.splice(verdict.index,1);old.stop(.15);}
        const p=whistleProfile(e.power,e.duration,e.d),bus=this.bus(e,p.reverbSend),voice=buildWhistle(c,bus,t,p,this.buffers);
        voice.power=e.power;voice.onended=()=>{const i=this.whistles.indexOf(voice);if(i>=0)this.whistles.splice(i,1);bus.release();};
        this.whistles.push(voice);return;
      }
      if(this.active>18||now-this.last<.035)return;this.last=now;this.active++;
      const p=profileFor(e.kind,e.power,e.d),bus=this.bus(e,p.reverbSend);
      const voice=buildBurst(c,bus,t,p,this.buffers);
      voice.onended=()=>{this.active--;bus.release();};
    }
```

`renderOffline` を次で置き換える:

```js
    async renderOffline(kind,power,duration=5.1,distance=1000){
      const OAC=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!OAC)throw new Error('OfflineAudioContext unavailable');
      const sr=44100,c=new OAC(1,Math.ceil(sr*(duration+1)),sr),buffers=prepareBuffers(c),master=c.createGain();master.connect(c.destination);
      const bus={dry:master,sub:master,release(){}};
      if(kind==='whistle')buildWhistle(c,bus,.05,whistleProfile(power,duration,distance),buffers);
      else buildBurst(c,bus,.05,profileFor(kind,power,distance),buffers);
      return (await c.startRendering()).getChannelData(0);
    }
```

- [ ] **Step 6: 自己診断を追加する**

`const audio=new Soundscape();` の直後に:

```js
  // ---- 自己診断 (?selftest=1)。音は OfflineAudioContext に描画して「長さ・音程の向き・減衰の傾向」を検査する ----
  const SELFTEST_SR=44100;
  function zeroCrossingRate(data,from,to,sr=SELFTEST_SR){
    const a=Math.max(1,Math.floor(from*sr)),b=Math.min(data.length-1,Math.floor(to*sr));let n=0;
    for(let i=a;i<=b;i++)if((data[i-1]<0)!==(data[i]<0))n++;
    return n/Math.max(1e-6,(b-a)/sr);
  }
  function audibleSeconds(data,threshold=.002,sr=SELFTEST_SR){
    let first=-1,last=-1;for(let i=0;i<data.length;i++)if(Math.abs(data[i])>threshold){if(first<0)first=i;last=i;}
    return first<0?0:(last-first)/sr;
  }
  // 20ms 窓の RMS を取り、ピークからピークの 10% を下回るまでの秒数
  function decayProfile(data,sr=SELFTEST_SR){
    const win=Math.floor(sr*.02),r=[];let peak=0,peakIndex=0;
    for(let i=0;i+win<=data.length;i+=win){let s=0;for(let j=i;j<i+win;j++)s+=data[j]*data[j];const v=Math.sqrt(s/win);r.push(v);if(v>peak){peak=v;peakIndex=r.length-1;}}
    for(let k=peakIndex;k<r.length;k++)if(r[k]<peak*.1)return {peak,time:(k-peakIndex)*win/sr};
    return {peak,time:(r.length-peakIndex)*win/sr};
  }
  async function runSelfTest(){
    const results=[],check=(name,pass,detail='')=>results.push({name,pass:!!pass,detail});
    try{
      const big=await audio.renderOffline('whistle',1.2,5.1),small=await audio.renderOffline('whistle',.6,5.1),pBig=whistleProfile(1.2,5.1,1000);
      const length=audibleSeconds(big);
      check('whistle length matches profile',Math.abs(length-pBig.dur)<.2,`${length.toFixed(2)}s vs ${pBig.dur.toFixed(2)}s`);
      const early=zeroCrossingRate(big,.35,.85),late=zeroCrossingRate(big,.05+pBig.dur-.8,.05+pBig.dur-.3);
      check('whistle pitch rises',late>early,`${early.toFixed(0)} -> ${late.toFixed(0)} crossings/s`);
      const smallEarly=zeroCrossingRate(small,.35,.85);
      check('small shell whistles higher',smallEarly>early,`${smallEarly.toFixed(0)} vs ${early.toFixed(0)}`);
      const boomBig=decayProfile(await audio.renderOffline('burst',1.2)),boomSmall=decayProfile(await audio.renderOffline('burst',.6));
      check('big boom decays longer',boomBig.time>boomSmall.time,`${boomBig.time.toFixed(2)}s vs ${boomSmall.time.toFixed(2)}s`);
      check('big boom is louder',boomBig.peak>boomSmall.peak,`${boomBig.peak.toFixed(3)} vs ${boomSmall.peak.toFixed(3)}`);
    }catch(err){check('offline audio render',false,String(err));}
    const passed=results.filter(r=>r.pass).length;
    console.table(results);toast(`自己診断 ${passed}/${results.length} 合格`);
    return results;
  }
```

ブートストラップ末尾（`render();if(paused)toast(...);resumeLoop();` の行の直後）に:

```js
  if(params.has('selftest'))window.HANABI_SELFTEST=runSelfTest();
```

- [ ] **Step 7: テストを実行する**

Run: `node --test`
Expected: 全件 `ok`

- [ ] **Step 8: ブラウザ確認（Fable のチェックポイント）**

`index.html?selftest=1` を開き、通知に「自己診断 5/5 合格」と出ること。コンソールにエラーがないこと。音をオンにして、打ち上げから開花までヒューが鳴り、開花直前に一瞬静かになってからドンが鳴ること。フィナーレで音が破綻しないこと。

- [ ] **Step 9: コミット**

```bash
git add index.html
git commit -m "feat: add size-dependent ascent whistle with voice arbitration and offline self-test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 文字花火コア（点群化・text 型・launchText・上限バイパス・debug フック）

**Files:**
- Modify: `index.html`
  - `addStar()` の上限に `o.force`
  - `launch()` の 16 発上限を文字玉で 24 に
  - `updatePhysics()` の開花呼び出しで `s.extra` を渡す
  - `openShell()` に `extra` 引数と `'text'` 分岐
  - `sampleGlyph()` / `launchText()` / `pumpTextQueue()` を `openShell` の直前に追加
  - `step()` で `pumpTextQueue()` を呼ぶ
  - `runSelfTest()` に glyph 検査を追記
  - `?debug=1` フック

**Interfaces:**
- Consumes: `sanitizeText` / `textLayout` / `normalizePoints` / `pickStep`（Task 1）、`launch(type,x,y,z,power,palette,extra)`（Task 3）、`runSelfTest`（Task 3）
- Produces:
  - `sampleGlyph(char:string) -> Float32Array`（[-1,1] の点列、文字ごとにキャッシュ）
  - `launchText(text:string) -> boolean`（打ち上げを予約したら true。空・クールダウン中は false）
  - `textQueue: {at,type,x,y,power,palette,extra}[]`、`pumpTextQueue()`
  - `openShell(x,y,z,type,power,palette,mini,extra={})` の `'text'` 分岐（`extra.glyph`, `extra.R`）
  - `window.HANABI`（`?debug=1` のとき）: `{launchText, sampleGlyph, sanitizeText, textLayout, burstProfile, whistleProfile, whistleArbiter, audio, state()}`

- [ ] **Step 1: `addStar` に force を追加する**

```js
  function addStar(x,y,z,vx,vy,vz,color,life,o={}){
    if(stars.length>=(W<600?2100:3100)+(o.force?900:0))return;
```

（関数の残りは変更しない）

- [ ] **Step 2: `launch` の上限と `updatePhysics` の開花呼び出しを変える**

`launch()` 1 行目: `if(shells.length>=16)return;` → `if(shells.length>=(extra.glyph?24:16))return false;`、関数末尾（whistle の `queueSound` の直後）に `return true;` を追加する。`launch()` は「玉を積めたら true、上限で積めなければ false」を返す（`pumpTextQueue` が失敗した予約を持ち越すために使う。既存の呼び出し元は戻り値を見ていないので影響なし）

`updatePhysics()` の `if(s.age>=s.duration){openShell(s.tx,s.ty,s.tz,s.type,s.power,s.palette);` → `if(s.age>=s.duration){openShell(s.tx,s.ty,s.tz,s.type,s.power,s.palette,false,s.extra||{});`

- [ ] **Step 3: `sampleGlyph` / `launchText` / `pumpTextQueue` を追加する**

`function openShell(` の直前に:

```js
  // ---- 文字花火 ----
  const GLYPH_FONT='"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Yu Gothic","Meiryo","Noto Sans CJK JP","Noto Sans JP",sans-serif';
  const GLYPH_SIZE=128,glyphCache=new Map();let glyphCanvas=null;
  // 1 文字を非表示キャンバスに描き、格子でサンプリングして [-1,1] の点列にする。点数が 40〜320 に収まるよう step を調整する。
  function sampleGlyph(char){
    if(glyphCache.has(char))return glyphCache.get(char);
    if(!glyphCanvas){glyphCanvas=document.createElement('canvas');glyphCanvas.width=glyphCanvas.height=GLYPH_SIZE;}
    const g=glyphCanvas.getContext('2d',{willReadFrequently:true});
    g.clearRect(0,0,GLYPH_SIZE,GLYPH_SIZE);g.fillStyle='#fff';g.font=`bold 100px ${GLYPH_FONT}`;g.textAlign='center';g.textBaseline='middle';
    g.fillText(char,GLYPH_SIZE/2,GLYPH_SIZE/2+2);
    const alpha=g.getImageData(0,0,GLYPH_SIZE,GLYPH_SIZE).data,tried=new Set();
    let step=3,points=[];
    for(let guard=0;guard<5;guard++){
      tried.add(step);points=[];
      for(let y=step>>1;y<GLYPH_SIZE;y+=step)for(let x=step>>1;x<GLYPH_SIZE;x+=step)
        if(alpha[(y*GLYPH_SIZE+x)*4+3]>120)points.push(x+rand(-.35,.35)*step,y+rand(-.35,.35)*step);
      const next=pickStep(points.length/2,step);if(next===step||tried.has(next))break;step=next;
    }
    const out=normalizePoints(points);glyphCache.set(char,out);return out;
  }
  const textQueue=[];let lastTextLaunch=-10;
  // 文字列を 1 文字 1 発に分けて simTime 基準で予約する（setTimeout は一時停止と整合しないため使わない）
  function launchText(text){
    const {chars,truncated}=sanitizeText(text);if(!chars.length)return false;
    if(simTime-lastTextLaunch<1.2)return false;lastTextLaunch=simTime;
    const {shells:plan}=textLayout(chars,{halfWidth:330*spread()}),palette=pick(PALETTES);
    for(const s of plan)textQueue.push({at:simTime+s.delay,type:'text',x:s.x,y:s.y,power:s.power,palette,extra:{glyph:s.char,R:s.R,priority:true}});
    if(truncated)toast(`文字花火は6文字まで。「${chars.join('')}」を打ち上げます。`);
    return true;
  }
  // 期限が来た予約をすべて打ち上げる。先頭以外も見るので、続けて入力された文字列（予約が時刻順に並ばない）でも順番どおりに上がる。
  // 玉の上限で launch が false を返した予約は取り除かず、次フレーム以降に持ち越す（文字が黙って欠けない）。
  function pumpTextQueue(){for(let i=0;i<textQueue.length;){const e=textQueue[i];if(e.at<=simTime&&launch(e.type,e.x,e.y,0,e.power,e.palette,e.extra))textQueue.splice(i,1);else i++;}}
```

注意: `spread` は `openShell` より後ろの行で `const spread=()=>...` として定義されているが、`launchText` は実行時にしか参照しないので問題ない（TDZ は関数本体の実行時にのみ関係する）。

- [ ] **Step 4: `openShell` に extra 引数と text 分岐を追加する**

シグネチャ: `function openShell(x,y,z,type='yae',power=1,palette=pick(PALETTES),mini=false,extra={}){`

`heart` 分岐の閉じ `}` の直後（`openShell` の最後の `}` の直前）に:

```js
    }else if(type==='text'){
      // 点群を開花時のカメラ右方向に沿って並べ、文字面がカメラ正面を向くようにする。全星の drag が同じなので形は落下しても崩れない。
      const pts=sampleGlyph(extra.glyph||'?'),v=(extra.R||90)/1.106,rx=camera.right[0],rz=camera.right[2];
      for(let i=0;i<pts.length;i+=2){
        const nx=pts[i],ny=pts[i+1];
        addStar(x,y,z,nx*v*rx,ny*v+3,nx*v*rz+rand(-1.5,1.5),palette[0],3.6*rand(.97,1.03),{secondary:palette[1],change:.7,goldStart:0,tail:0,size:6.0,twinkle:.25,force:true});
      }
    }
```

（既存の `heart` 分岐は `}else if(type==='heart'){ ... }` で終わっているので、その `}` を `}else if(type==='text'){` に続ける）

- [ ] **Step 5: `step()` でキューを処理する**

`function step(dt){simTime+=dt;director(dt);updatePhysics(dt);}` → `function step(dt){simTime+=dt;director(dt);pumpTextQueue();updatePhysics(dt);}`

- [ ] **Step 6: 自己診断に glyph 検査を追記する**

`runSelfTest()` 内、`}catch(err){check('offline audio render',false,String(err));}` の直後に:

```js
    for(const ch of ['祝','A','あ']){
      const pts=sampleGlyph(ch),n=pts.length/2;let inRange=true;
      for(let i=0;i<pts.length;i++)if(Math.abs(pts[i])>1.0001)inRange=false;
      check(`glyph ${ch} sampled`,n>=40&&n<=320&&inRange,`${n} points`);
    }
```

- [ ] **Step 7: debug フックを追加する**

ブートストラップ末尾、`if(params.has('selftest'))...` の直前に:

```js
  if(params.has('debug'))window.HANABI=Object.freeze({launchText,sampleGlyph,sanitizeText,textLayout,burstProfile,whistleProfile,whistleArbiter,audio,
    state:()=>({stars:stars.length,shells:shells.length,soundEvents:soundEvents.length,whistles:audio.whistles.length,textQueue:textQueue.length})});
```

- [ ] **Step 8: テストを実行する**

Run: `node --test`
Expected: 全件 `ok`

- [ ] **Step 9: ブラウザ確認（Fable のチェックポイント）**

`index.html?debug=1&selftest=1` を開く。通知が「自己診断 8/8 合格」。コンソールで `HANABI.launchText('祝')` を実行し、約 5 秒後に開花して 1.5 秒後のスクリーンショットで「祝」が正しい向きで読めること（鏡文字でない）。ドラッグで視点を左右に振ってから `HANABI.launchText('花')` を打ち、文字が正面を向くこと。`HANABI.launchText('ありがとう')` で 5 発が左から順に上がること。`HANABI.state()` の `textQueue` が 0 に戻ること。

- [ ] **Step 10: コミット**

```bash
git add index.html
git commit -m "feat: add text fireworks core with glyph sampling and camera-facing bloom

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 隠し UI（フォーム・T キー・長押し・URL・IME 対策・CSS）と README

**Files:**
- Modify: `index.html`（`<style>` 末尾付近に CSS、`#restore` ボタンの直後にフォーム、`setupLauncher()` の追加、URL 予約、Escape の優先順位）
- Create: `README.md`

**Interfaces:**
- Consumes: `launchText` / `sanitizeText`（Task 4）、`params`（Task 3）、`setPaused` / `toast` / `surface` / `simTime`
- Produces: `setupLauncher() -> {open, close, isOpen}`、`urlText` / `urlTextAt` / `pumpUrlText()`

- [ ] **Step 1: CSS を追加する**

`<style>` 内、`@media(max-width: 1000px)` の行の直前に:

```css
    .brand { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; pointer-events: auto; cursor: default; }
    .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
    .launcher { position: fixed; left: 50%; bottom: calc(max(28px, env(safe-area-inset-bottom)) + 118px); transform: translateX(-50%); z-index: 2; display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; max-width: calc(100% - 32px); border: 1px solid rgba(204,216,255,.16); background: rgba(6,10,17,.72); border-radius: 18px; box-shadow: 0 12px 50px #0005, inset 0 1px 0 #ffffff05; backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); }
    .launcher input { width: min(300px, 52vw); background: transparent; border: 0; color: #f5f4fa; font-size: 16px; letter-spacing: .08em; padding: 8px 0; }
    .launcher input::placeholder { color: #8b91a0; }
    .launcher .icon-button { width: 38px; height: 38px; flex-shrink: 0; }
```

既存の `@media(max-width: 600px) { ... }` ブロックの中に `.launcher { bottom: calc(max(20px, env(safe-area-inset-bottom)) + 104px); }` を、`@media(max-height: 440px) { ... }` の中に `.launcher { bottom: calc(max(12px, env(safe-area-inset-bottom)) + 76px); }` を追加する。

- [ ] **Step 2: フォームのマークアップを追加する**

`<button class="icon-button" id="restore" ...>...</button>` の直後、`<div id="notice" ...>` の直前に:

```html
  <form class="launcher" id="launcher" hidden aria-label="文字花火">
    <label for="text-input" class="visually-hidden">打ち上げる文字</label>
    <input id="text-input" type="text" maxlength="24" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" placeholder="文字を入力して Enter（6文字まで）">
    <button type="submit" class="icon-button" aria-label="打ち上げる" title="打ち上げる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V6m0 0-5 5m5-5 5 5"/></svg></button>
    <button type="button" class="icon-button" id="launcher-close" aria-label="閉じる" title="閉じる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
  </form>
```

- [ ] **Step 3: `setupLauncher()` を追加する**

`function setupInput(){` の直前に:

```js
  // ---- 文字花火の隠し UI。T キー / ロゴ長押し / ?text= で開く。表パネルには出さない ----
  function setupLauncher(){
    const form=$('launcher'),input=$('text-input'),brand=document.querySelector('.brand');
    let composing=false,pressTimer=0,pressStart=null;
    const open=()=>{form.hidden=false;input.focus({preventScroll:true});input.select();};
    const close=()=>{if(form.hidden)return;form.hidden=true;surface.focus({preventScroll:true});};
    input.addEventListener('compositionstart',()=>{composing=true;});
    input.addEventListener('compositionend',()=>{composing=false;});
    input.addEventListener('keydown',e=>{
      // 日本語変換の確定 Enter では打ち上げない
      if(e.key==='Enter'&&(e.isComposing||e.keyCode===229||composing)){e.preventDefault();return;}
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
    });
    form.addEventListener('submit',e=>{e.preventDefault();if(composing)return;if(paused)setPaused(false);if(launchText(input.value))close();});
    $('launcher-close').addEventListener('click',close);
    const isTyping=el=>!!el&&(el.isContentEditable||el.tagName==='TEXTAREA'||(el.tagName==='INPUT'&&!['range','checkbox','radio','button'].includes(el.type)));
    document.addEventListener('keydown',e=>{
      if((e.key==='t'||e.key==='T')&&!isTyping(e.target)&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();open();}
    });
    surface.addEventListener('pointerdown',close);
    brand.addEventListener('contextmenu',e=>e.preventDefault());
    const cancelPress=()=>{clearTimeout(pressTimer);pressStart=null;};
    brand.addEventListener('pointerdown',e=>{pressStart={x:e.clientX,y:e.clientY};clearTimeout(pressTimer);pressTimer=setTimeout(()=>{pressStart=null;open();},600);});
    brand.addEventListener('pointermove',e=>{if(pressStart&&Math.hypot(e.clientX-pressStart.x,e.clientY-pressStart.y)>10)cancelPress();});
    for(const type of ['pointerup','pointercancel','pointerleave'])brand.addEventListener(type,cancelPress);
    return {open,close,isOpen:()=>!form.hidden};
  }
```

- [ ] **Step 4: URL パラメータの自動打ち上げを追加する**

`const textQueue=[];let lastTextLaunch=-10;` の直後（Task 4 で追加した行）に:

```js
  // ?text=祝 → 起動 2.5 秒後に自動で 1 回。urlTextAt はプリロール後にブートストラップで設定する
  const urlText=sanitizeText(params.get('text')||'').chars.join('');let urlTextAt=-1;
  function pumpUrlText(){if(urlTextAt>=0&&simTime>=urlTextAt){urlTextAt=-1;launchText(urlText);}}
```

`step()` を `function step(dt){simTime+=dt;director(dt);pumpUrlText();pumpTextQueue();updatePhysics(dt);}` に。

ブートストラップの `for(let i=0;i<165;i++)step(1/60);` の直後に `if(urlText)urlTextAt=simTime+2.5;` を追加する（プリロール中に発火させないため、必ずループの後に置く）。

`updateCamera(10);setupInput();updatePause();` を `updateCamera(10);setupInput();setupLauncher();updatePause();` に。

- [ ] **Step 4b: debug フックに決定的な時間送り `advance()` を追加する**

検証環境によっては `requestAnimationFrame` が止まる（ブラウザペインが非表示のときなど）ため、`?debug=1` のフックからシミュレーションを決定的に進めて描画できるようにする。Task 4 が入れた `window.HANABI=Object.freeze({...})` の `state:` の直前に次の 1 行を追加する:

```js
    // 検証用: rAF が止まる環境でも決定的にシミュレーションを進めて描画する（seconds 秒ぶん 1/60 刻み）
    advance:(seconds=1)=>{const n=Math.round(seconds*60);for(let i=0;i<n;i++)step(1/60);updateCamera(10);render();return simTime;},
```

`step` / `updateCamera` / `render` / `simTime` はいずれも IIFE 内の既存識別子。`state()` の戻り値は変えない。

- [ ] **Step 5: Escape の優先順位を確認する**

既存の `document.addEventListener('keydown',e=>{if(e.key==='Escape'&&quiet)setQuiet(false);});` は変更不要（入力欄の keydown で `stopPropagation` しているので、入力欄が開いているときは document まで届かない）。

- [ ] **Step 6: README.md を書く**

```markdown
# HANABI — 終わらない花火

ブラウザーで動く立体花火シミュレーターです。1 つの HTML ファイルだけで動き、ビルドや外部ライブラリは不要です。

## 使い方

- `index.html` をブラウザーで開くだけで始まります（`file://` でも動きます）
- ドラッグで視点移動、タップまたは Enter で 1 発打ち上げ、ホイールやピンチでズーム
- 右上の音ボタンで音をオンにすると、光のあとに距離に応じて遅れて音が届きます
- 下のパネルで演出の密度を変えたり、フィナーレを呼び出したりできます

## 音について

- 開花音は玉の大きさで変わります。大玉ほど低く長く尾を引き、小玉ほど乾いた「パン」になります
- 打ち上げから開花までの「ヒュー」という上昇音も大きさで音色が変わり、開花の直前に一瞬静かになってから「ドン」が届きます

<details>
<summary>ヒント</summary>

夜空に文字を描く方法があります。キーボードの T、または左上のロゴを長押ししてみてください。URL に `?text=祝` を付けて開くこともできます。

</details>

## 開発

- テスト: `node --test`（Node 22 以上。npm パッケージは使いません）
- 自己診断: `index.html?selftest=1` を開くと音と文字の生成を検査して結果を表示します
- デバッグ: `index.html?debug=1` で `window.HANABI` に内部関数が公開されます

## GitHub Pages で公開する

1. GitHub にリポジトリを作成し、`main` ブランチを push する
2. リポジトリの Settings → Pages で Source を「Deploy from a branch」、Branch を `main` / `/(root)` にする
3. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で開けます
```

- [ ] **Step 7: テストを実行する**

Run: `node --test`
Expected: 全件 `ok`

- [ ] **Step 8: ブラウザ確認（Fable のチェックポイント）**

- `index.html` を開き、キャンバスをクリックしてから T キー → 入力欄が出る。「祝」と入力して Enter → 入力欄が閉じ、約 5 秒後に「祝」が開く
- 「ありがとうございます」と入れて Enter → トースト「文字花火は6文字まで。「ありがとうご」を打ち上げます。」
- Escape で閉じる。操作パネルを隠した状態（右上の隠すボタン）でも T キーで開く。入力欄が開いた状態の Escape ではパネルが復帰しない
- `index.html?text=花` を開く → 2.5 秒後に「花」が上がる
- ブラウザを 375×812（スマホ縦）にして `index.html?text=ありがとう` → 2 段に分かれる
- 左上ロゴを長押し（マウスなら 0.6 秒押しっぱなし）→ 入力欄が出る。短いクリックでは出ない
- IME を使って「はなび」→変換→Enter で確定 → 打ち上がらない。もう一度 Enter → 打ち上がる（Fable は手元で IME を使えないので、この項目は izawa に最終確認を依頼する）

- [ ] **Step 9: コミット**

```bash
git add index.html README.md
git commit -m "feat: add hidden text-fireworks launcher (T key, logo long-press, ?text=) and README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 統合検証と main へのマージ（Fable が実施）

**Files:**
- 変更なし（検証と git 操作のみ。問題が見つかれば該当タスクに差し戻す）

- [ ] **Step 1: 全テスト**

Run: `node --test`
Expected: `# fail 0`

- [ ] **Step 2: ブラウザ総合確認**

`index.html?debug=1&selftest=1` で「自己診断 8/8 合格」、コンソールエラーなし。Task 4 / Task 5 のチェックポイント項目を通しで再確認。密度「壮大」＋フィナーレ中に `HANABI.launchText('感謝')` を打っても文字が欠けないこと（`HANABI.state().stars` が 4000 を超えないこと）。

- [ ] **Step 3: izawa による聴感確認の依頼**

音をオンにして、小玉（千輪の子玉・パチパチ）・中玉（タップ）・大玉（フィナーレの錦）でドンの深さ・ヒューの高さと長さ・開花前の静寂が意図どおりか聴いてもらう。調整は `PURE` ブロックの `burstProfile` / `whistleProfile` の数値だけを変えて行う。

- [ ] **Step 4: マージ**

superpowers:finishing-a-development-branch に従い、`feat/sound-and-text-fireworks` を `main` にマージする（`git merge --no-ff`）。GitHub への push と Pages 設定は izawa が行う（README 手順）。

---

## Self-Review（作成時に実施済み）

- **仕様カバレッジ:** 1.1 → Task 1、1.2/1.3 → Task 2・3、1.4 → Task 3（音）・Task 4（glyph）、2.1〜2.4 → Task 1・4、2.5 → Task 5、3 → Task 1（Node）・3（selftest）・4（debug）、4/5 → Task 5（README）、6 → 各タスクのモデル割り当て（Task 1・4・5 = Sonnet 5、Task 2・3 = Opus 5、Task 6 = Fable）
- **仕様からの意図的な差分:** `normalizePoints` の引数から未使用の `width, height` を外した（bbox から計算するため不要）。`smallProfile` は仕様に明記のない `reverbSend:1` を持つ（既存挙動の維持）
- **型・名前の一貫性:** `extra.glyph` / `extra.R` / `extra.priority`（Task 3・4・5）、`voice.onended` / `voice.stop` / `voice.power`（Task 2・3）、`bus.dry` / `bus.sub` / `bus.release`（Task 2・3）、`params`（Task 3・4・5）を確認済み
