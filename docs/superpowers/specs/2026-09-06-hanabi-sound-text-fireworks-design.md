# HANABI 音の大きさ連動・ヒュー音・文字花火 — 設計仕様

作成日: 2026-09-06
対象: `index.html`（旧 `hanabi-3d.html`。単一ファイルの立体花火シミュレーター）

## 目的

1. 開花音「ドン」を玉の大きさに応じて変える（現状は音量しか変わらない）
2. 打ち上げから開花までの「ヒュー」という上昇音を新設し、これも大きさで音色を変える
3. 裏機能として、任意の文字を花火として打ち上げられるようにする
4. 将来 GitHub Pages で公開し、URL で開けるようにする（`index.html` をリポジトリ直下に置く）

## 前提と制約

- 単一 HTML・ビルド工程なし・`file://` 直開きで動作する。外部 CDN・外部フォント・外部ライブラリは読み込まない
- 既存の見た目・操作・演出スコア（`score(...)` 群）は変えない。追加のみ
- 表の操作パネルには何も増やさない（文字花火は裏機能）
- 音は既存どおりユーザーが音ボタンで有効化したときだけ鳴る
- 音色の最終判断は聴感で行う。本仕様の数値はすべて初期値であり、聴いた結果で調整する前提。そのため音の定数は純粋ロジックブロックの1か所に集約する
- リポジトリは `A:\HANABI`（git 管理、既定ブランチ `main`、作業ブランチ `feat/sound-and-text-fireworks`）

## 用語

- **power**: 既存の玉の強さ。演出スコアでは 0.57〜1.22、タップは 0.8〜1.0
- **サイズ値 s**: `sizeOf(power) = clamp((power - 0.5) / 0.75, 0, 1)`。0 が3号玉相当、1 が尺玉相当。音に関する全パラメータはこの s から決める
- **距離係数 dist**: 既存の `clamp(1050 / d, 0.35, 1.25)`（d はカメラから音源までの距離）。関数名 `distFactor(d)` として純粋ロジックへ移す

---

## 1. 音の設計

### 1.1 純粋ロジック（プロファイル関数）

`index.html` 内の `// PURE_LOGIC_START` 〜 `// PURE_LOGIC_END` ブロックに、DOM・Web Audio に依存しない関数として定義する。`mix(a,b,t)` と `clamp` はブロック内で自前定義する（IIFE の外側ヘルパーに依存しない）。

`burstProfile(power, d)` → 開花音「ドン」のパラメータ

| 項目 | 値 | 意味 |
|---|---|---|
| gain | `power^1.25 * dist` | 全体音量 |
| crackGain | `mix(0.15, 0.55, s)` | 先頭 15ms の「バン」（ハイパス 2500Hz のノイズ）。gain に乗算 |
| bodyHz / bodyDecay / bodyGain | `mix(170, 105, s)` / `mix(0.18, 0.30, s)` / `0.30` | 中低域の「ボディ音」（正弦波、減衰中に周波数が半分へ下がる）。スマホスピーカーで大きさの差を伝えるための成分 |
| bassStart / bassEnd / bassDecay / bassGain | `mix(72, 36, s)` / `mix(32, 20, s)` / `mix(0.4, 1.1, s)` / `0.66` | 既存の低音正弦波を大きさ連動に |
| noiseCutoffStart / noiseCutoffEnd / noiseDecay | `mix(1900, 850, s) * dist` / `90` / `mix(0.9, 2.8, s)` | 既存のブラウンノイズ成分 |
| reverbSend | `mix(0.7, 1.3, s)` | リバーブへの送り量（既存 wet 0.24 に乗算） |

`smallProfile(power, d)` → 千輪の子玉・パチパチ用。既存の挙動を踏襲（ノイズ 2200→750Hz、減衰 0.55s、gain `power * dist`、低音・ボディ・クラックなし）

`liftProfile(power, d)` → 発射台の「ドッ」。ノイズ 380→90Hz 減衰 0.38s、低音 `mix(80, 55, s)` → 30Hz 減衰 `mix(0.3, 0.5, s)`、gain `0.35 * power * dist`

`whistleProfile(power, duration, d)` → 上昇音「ヒュー」

| 項目 | 値 | 意味 |
|---|---|---|
| f0 | `mix(1500, 620, s)` | 開始周波数。小玉ほど高い |
| f1 | `f0 * 2^(mix(3, 5, s) / 12)` | 終了周波数。3〜5半音ゆるやかに上がる |
| endGap | `mix(0.20, 0.35, s)` | 開花の何秒前に止めるか（静寂の間） |
| dur | `max(0.6, duration - endGap)` | 持続時間。duration は玉の上昇時間 |
| attack / release | `0.12` / `0.08` | 立ち上がり・止め際 |
| sustainEnd | `0.55` | 終了時点の音量比（ゆっくり減衰） |
| noiseMix | `mix(0.35, 0.75, s)` | 息（帯域ノイズ）成分の比率。残りが笛（正弦波）成分 |
| gain | `mix(0.09, 0.16, s) * dist` | 全体音量。ドンより控えめ |
| vibratoHz / vibratoDepth | `5.5` / `mix(0.004, 0.012, s)` | 笛成分のビブラート（周波数比） |
| q | `14` | 帯域ノイズのバンドパス Q |
| breathGain | `2.5` | 息成分の補正係数（Q=14 のバンドパスで落ちる分を補う）。builder 側に裸の定数を置かない |
| reverbSend | `0.5` | |

`whistleArbiter(active, incoming, max = 3)` → 同時発音の裁定。`active` は鳴っている笛の `{power}` 配列、`incoming` は `{power, priority}`。

- `priority` が真（タップと文字花火）なら、`active.length < 2 * max` のときは `{action: 'start'}`、それ以上なら最弱を差し替える `{action: 'replace', index}`。タップ連打（0.3 秒間隔）や Enter 長押しで笛が無制限に積み上がらないための天井
- `active.length < max` なら `{action: 'start'}`
- 上限到達時、`incoming.power` が最弱の active より 0.15 以上大きければ `{action: 'replace', index}`（最弱を 0.15 秒でフェードアウトして差し替え）
- それ以外は `{action: 'skip'}`

### 1.2 Soundscape の変更

- `play(e)` は `e.kind` で分岐する。`burst` / `small` / `crackle` / `lift` は打楽器系、`whistle` は持続系
- 既存の「35ms 以内の連続発音を捨てる」制限と `active > 18` の上限は打楽器系のみに適用する。ヒューを対象にすると、同時刻に鳴る `lift` に食われて消えるため
- 音のグラフ構築は `buildBurst(ctx, dest, reverbDest, t, profile)` / `buildWhistle(ctx, dest, reverbDest, t, profile)` のような、コンテキストを引数に取る関数に分ける。ライブ再生と自己診断（OfflineAudioContext）で同じコードを使うため
- ドン: クラック → ボディ → 低音 → ノイズの4成分を同時刻 t に開始。パン・リバーブ送りは既存どおり（リバーブ送りは `reverbSend` を乗算）
- ヒュー: 正弦波オシレーター（周波数を f0 → f1 へ指数ランプ、LFO でビブラート）と、ノイズバッファ → バンドパス（中心周波数を同じ軌道でランプ、Q 14）の2系統を `noiseMix` で混ぜ、包絡ゲイン → パン → master と reverb へ。パンは発射台の位置で固定（上昇中の追従はしない）
- ヒューの発音数は `whistleArbiter` で裁定する。鳴っている笛は `{power, stop(fadeSec)}` として保持し、終了時に配列から外す
- 一時停止・非表示時は既存どおり `ctx.suspend()` で止まる。simTime も止まるので整合する
- フレームループは `step()` を try/catch で包む（最初の数回だけ `console.error`）。`play()` や文字の点群化で例外が出ても描画ループが永久停止しないため（`frame()` は末尾で次の rAF を予約する構造なので、途中の例外はページの凍結になる）

### 1.3 スケジューリング

- `queueSound(x, y, z, power, kind, extra)` に `extra` を追加し、`{duration, priority}` を渡せるようにする
- `launch()` は既存の `lift` に加えて、同じ発射台位置から `whistle` を `duration`（玉の上昇時間）付きで積む。タップ由来と文字花火由来は `priority: true`
- 到達時刻は既存どおり `simTime + d / 343`。ヒューは発射台から、ドンは開花位置から届くため、ヒューが止まってからドンが届くまでに `endGap` に加えて 0.2〜0.3 秒の自然な間ができる
- `lift` にも `power` を渡し、大きさ連動にする（現状は固定 0.32）

### 1.4 自己診断（`?selftest=1`）

`audio.renderOffline(kind, power, duration)` で OfflineAudioContext（44.1kHz、モノラル）に描画し、以下を検査する。結果は `console.table` と `window.HANABI_SELFTEST`（Promise）に出し、通知欄に「自己診断 N/M 合格」と表示する。

- ヒュー(power 1.2, duration 5.1): 可聴区間（|x| > 0.002）の長さが `dur ± 0.2s`
- ヒュー: 開始側 0.3〜0.8s のゼロ交差率 < 終了側 (dur−0.8)〜(dur−0.3)s のゼロ交差率（音程が上がっている）
- ヒュー(power 0.6) のゼロ交差率 > ヒュー(power 1.2)（小玉ほど高い）
- ドン(1.2) vs ドン(0.6): ピーク RMS が 10% まで落ちる時間が大玉のほうが長く、ピークも大きい
- サンプル文字 `祝` `A` `あ` の点群数が 40〜320 の範囲で、bbox が [-1, 1] に収まる

---

## 2. 文字花火の設計

### 2.1 文字の正規化（純粋ロジック）

`sanitizeText(input, max = 6)` → `{chars: string[], truncated: boolean}`

- 半角・全角の空白と改行をすべて除去
- `Intl.Segmenter('ja', {granularity: 'grapheme'})` があれば書記素単位、なければ `Array.from` で分割（絵文字・サロゲートペアを1文字と数える）
- 先頭 `max` 文字だけ残し、超過があれば `truncated: true`

### 2.2 点群化（ブラウザ依存部分）

`sampleGlyph(char)` → `Float32Array`（`[nx0, ny0, nx1, ny1, ...]`、各値は [-1, 1]）

- 非表示の 128×128 キャンバスに `bold 100px` でフォントスタック `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", "Meiryo", "Noto Sans CJK JP", "Noto Sans JP", sans-serif` を指定して描画（中央揃え・middle ベースライン）
- 間隔 step（初期 3px）の格子でアルファ > 120 の点を拾う。点数が 320 を超えたら step を +1、40 未満なら −1 して再サンプル（step は 2〜6）。この判定は純粋関数 `pickStep(count, step)` に切り出す
- 各点に ±0.35×step のジッターを加えて格子感を弱める
- `normalizePoints(points, width, height)`（純粋ロジック）で bbox の中心を原点に、長辺が [-1, 1] に収まるよう等方スケール。y は上向きが正になるよう反転
- 文字ごとに `Map` でキャッシュ

### 2.3 配置（純粋ロジック）

`textLayout(chars, {halfWidth, baseY = 385, stagger = 0.32})` → `{rows: number, shells: [{char, x, y, delay, R, power}]}`

- R は「開花 1.5 秒後の文字の半径」。文字数 n に応じて 1文字 110、2文字 95、3文字 85、4文字以上 75
- 文字間隔 `spacing = 2.15 * R`。全体幅 `spacing * (n - 1) + 2R`
- 全体幅が `2 * halfWidth` を超える場合: n ≥ 4 なら 2 段に分ける（前半 `ceil(n/2)` 文字を上段 `baseY + 55`、残りを下段 `baseY - 55`。各段を独立に中央揃え）。それでも超えるなら R を縮める（下限 40。下限に達したら重なりを許容する）
- `x` は段ごとに中央揃え、`delay = i * stagger`（段をまたいでも連番）、`power = clamp(R / 115, 0.6, 1.05)`（音と閃光の強さに使う）
- 呼び出し側は `halfWidth = 330 * spread()` を渡す（横画面 330、縦画面 約 223）

### 2.4 打ち上げと開花

- `launch()` と `openShell()` に省略可能な `extra` 引数を追加し、文字玉は `{glyph: '祝', R: 95}` を持つ。玉の型名は `'text'`
- `launch()` の「同時 16 発まで」は文字玉ではバイパスする（絶対上限 24）。演出が混んでいても文字が欠けないため
- `openShell()` の `'text'` 分岐:
  - `pts = sampleGlyph(glyph)`、速度の大きさ `v = R / 1.106`（`F(1.5s) = (1 - e^(-0.43 * 1.5)) / 0.43 ≈ 1.106` の逆数）
  - 各点 `(nx, ny)` について、開花時点のカメラ右方向 `camera.right` を使い `vx = nx * v * right.x`、`vz = nx * v * right.z`、`vy = ny * v + 3`。これで文字面がカメラ正面を向き、視点を振っていても読める。奥行きの瞬きとして `vz` に ±1.5 を加える
  - 星のオプション: `life 3.6`（±3% のばらつきを付け、一斉に消えず溶けるように消す）、`tail 0`（尾を引かない）、`goldStart 0`、`change 0.7`、`secondary palette[1]`、`size 6.0`、`twinkle 0.25`、`drag` は既定の 0.43（全星で同一なので形が崩れない）
  - 閃光・煙・音は `power` を使って通常の玉と同じに出す（音は `burst`）
- `addStar()` の星数上限（3100 / モバイル 2100）は、文字玉からの追加に限り +900 まで許容する
- `launchText(text)`: `sanitizeText` → `textLayout` → 各 shell を `delay` 秒後に `launch('text', x, y, 0, power, pick(PALETTES), {glyph, R})`。遅延は `setTimeout` ではなく simTime 基準の予約キューで行う（一時停止と整合させる）。`truncated` のときはトースト「文字花火は6文字まで。「○○○○○○」を打ち上げます。」

### 2.5 隠し UI

**マークアップ**（`.bottom` の外、`body` 直下）

```html
<form class="launcher" id="launcher" hidden aria-label="文字花火">
  <label for="text-input" class="visually-hidden">打ち上げる文字</label>
  <input id="text-input" type="text" maxlength="24" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="send" placeholder="文字を入力（6文字まで）">
  <button type="submit" class="icon-button" aria-label="打ち上げる">(svg)</button>
  <button type="button" class="icon-button" id="launcher-close" aria-label="閉じる">(svg)</button>
</form>
```

- 見た目は既存 `.panel` と同じガラス調。位置は画面下中央、操作パネルの上。既存のメディアクエリ（幅 600 / 360、高さ 440）に合わせて詰める。`.quiet`（パネル非表示）中も使える
- `.brand`（左上ロゴ）に `user-select: none` と `-webkit-touch-callout: none` を付け、長押し中の `contextmenu` を抑止する

**開く**

- キャンバス上または `document` で `T`/`t` キー（修飾キーなし、フォーカスが入力欄以外のとき）
- `.brand` を 0.6 秒長押し（`pointerdown` で計時、`pointerup`/`pointercancel`/10px 超の移動で取り消し）
- URL の `?text=祝`: 起動から 2.5 秒後に自動で 1 回打ち上げる。起動時は開幕演出の途中から始まる（simTime が約 2.75 から始まる）ので、「起動時の simTime + 2.5」を予約時刻とする。`prefers-reduced-motion` で停止中なら再生開始後に同じ条件で打ち上げる。値が空・空白のみなら何もしない
- 開いたら入力欄にフォーカスし全選択。前回の文字は残す

**打ち上げる**

- フォームの `submit`（Enter とボタン）で `launchText`
- 入力欄の `keydown` で Enter かつ `e.isComposing || e.keyCode === 229` なら `preventDefault` して何もしない（日本語変換の確定 Enter で打ち上がらないように）。加えて `compositionstart`/`compositionend` で状態を持ち、変換中の `submit` は無視する
- 正規化後に文字がなければ無視
- 直前の文字花火から 1.2 秒以内は無視（連打対策。トーストなし）
- 打ち上げたら入力欄を閉じ、フォーカスをキャンバスへ戻す。停止中なら再生を開始する（タップと同じ挙動）

**閉じる**

- Escape（入力欄が開いているときは Escape はこれだけを行い、`.quiet` 解除には使わない）、閉じるボタン、キャンバスの `pointerdown`

**a11y**

- `visually-hidden` クラスを追加（`.launcher` のラベル用）。通知は既存の `#notice`（aria-live）を使う
- 表のヒント文・パネルには T キーの案内を出さない（裏機能のまま）

---

## 3. 検証・開発用フック

- `?debug=1`: `window.HANABI = Object.freeze({launchText, sampleGlyph, sanitizeText, textLayout, burstProfile, whistleProfile, whistleArbiter, audio, advance, state})`。`state()` は `{stars, shells, soundEvents, whistles, textQueue}` の件数を返す。`advance(seconds)` は 1/60 秒刻みでシミュレーションを決定的に進めて描画する（`requestAnimationFrame` が止まる検証環境向け）。ブラウザ上での検証に使う
- `?selftest=1`: 1.4 の自己診断を起動時に実行する
- Node テスト `tests/pure-logic.test.mjs`: `index.html` から `// PURE_LOGIC_START` 〜 `// PURE_LOGIC_END` を正規表現で抜き出し、`node:vm` で評価して `node:test` + `node:assert/strict` で検証する。npm パッケージは追加しない。実行は `node --test`
  - `sizeOf` の端点とクランプ
  - `burstProfile` / `liftProfile` / `whistleProfile` の単調性（大玉ほど低音が低く減衰が長い、笛が低い、など）と有限性
  - `whistleArbiter` の 4 分岐
  - `sanitizeText` の空白除去・書記素分割・切り詰め
  - `textLayout` の中央揃え・遅延・幅制約・2 段化・R 下限
  - `normalizePoints` / `pickStep`
- ブラウザ確認（実装後に Fable が行う）: `index.html?debug=1&selftest=1` を開き、コンソールにエラーがないこと、自己診断が全合格すること、`HANABI.launchText('祝')` の開花 1.5 秒後のスクリーンショットで文字が正しい向きで読めること（鏡文字でない）、視点を左右に振っても読めること、縦画面で 5 文字が 2 段になること

---

## 4. ファイル構成

```
A:\HANABI\
├ index.html                      ← 納品物（単一ファイル）
├ tests\pure-logic.test.mjs       ← Node 組込テスト（開発用。`node --test` の既定パターンで発見される）
├ docs\superpowers\specs\...      ← 本仕様
├ docs\superpowers\plans\...      ← 実装計画
├ README.md                       ← 操作説明・公開手順（裏機能は <details> 内に軽く記載）
├ .gitattributes（LF 固定）/ .gitignore
```

## 5. GitHub Pages への公開（後日、izawa が実施）

1. GitHub にリポジトリを作成し `main` を push
2. Settings → Pages → Source を「Deploy from a branch」、Branch を `main` / `/(root)` にする
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` で開ける。`?text=祝` を付けた URL を共有すると文字花火付きで開く

README にこの手順を書く。公開作業そのものは本仕様の範囲外。

## 6. 実装の分担と順序

同一ファイルを編集するため順次実行する。各タスクは「実装 → 仕様準拠レビュー → コード品質レビュー」で回す。

| # | タスク | 担当モデル | 理由 |
|---|---|---|---|
| 1 | 純粋ロジックブロックと Node テスト | Sonnet 5 | 仕様が数式で確定しており TDD 向き |
| 2 | ドン音の大きさ連動（クラック・ボディ・低音・ノイズ・リバーブ送り） | Opus 5 | Web Audio のスケジューリングと聴感判断 |
| 3 | ヒュー音（合成・予約・裁定・自己診断） | Opus 5 | 同上 |
| 4 | 文字花火コア（点群化・text 型・launchText・上限バイパス・debug フック） | Sonnet 5 | 既存 heart 型の延長で機械的 |
| 5 | 隠し UI（フォーム・T キー・長押し・URL・IME 対策・CSS）と README | Sonnet 5 | DOM 配線 |
| 6 | 統合検証（Node テスト・自己診断・ブラウザ目視）と main へのマージ | Fable 5.1 | |

## 7. リスクと割り切り

- 音色の善し悪しは自動検証できない。自己診断は「長さ・音程の向き・減衰の傾向」まで。最終調整は izawa の聴感で行い、定数は 1.1 の表を書き換えるだけで済むようにする
- スマホスピーカーでは 40Hz 台の低音が再生されない。ボディ音で補うが、PC と印象が変わるのは許容する
- 文字の字形は端末のシステムフォントに依存する。外部フォントは読み込まない
- 同時多発時はヒューを最大 3 本に絞る。フィナーレでは一部の玉にヒューが付かないのは意図どおり
- 文字玉の星数バイパスにより、混雑時の描画負荷が一時的に上がる。上限 +900 で抑える
