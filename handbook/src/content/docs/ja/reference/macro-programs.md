---
title: "マクロプログラム"
description: "マクロプログラムが実行するJavaScript API、その実行上限、および受け渡しに使うファイル。"
sidebar:
  order: 7
---

<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"ja"} -->

マクロプログラムは、手順のリストではなくJavaScriptで書かれたマクロです。
エディター内で、開いているプロジェクトの読み取り、選択範囲の移動、手順リストの
マクロと同じエフェクトやコマンドの適用を可能にする小さなAPI `sound` を使って
実行されます。ファイルやネットワークから他のプロジェクトに至るまで、それ以外の
ものにはアクセスできません。

プログラムはSoundscaperの機能です。Framescaperにはマクロマネージャーがありません。

## プログラムの保存場所

**ツール → マクロマネージャー**を選択します。ダイアログには手順リストのマクロと、
**プログラム**の下に保存したプログラムが表示されます。プログラムの見出しにある
**+（新しいプログラム）**を押すと新規作成できます。同じアクションバーには、選択した
プログラムの**プログラムをインポート**、**プログラムをエクスポート**、**プログラムを削除**も
用意されています。詳細ペインには**プログラム名**、**プログラム**のテキスト、
**プログラムを実行**ボタンが表示されます。テキストは入力するそばから保存され、別の保存操作はありません。

プログラムはプロジェクト内ではなくエディターの設定とともに保存されるため、このエディターで開く
すべてのプロジェクトで利用できます。別のマシンや別の人に渡すには**プログラムをエクスポート**と
**プログラムをインポート**を使います。詳しくは[プログラムの共有](#sharing-programs)を参照してください。

[毎回同じエフェクトチェーンを適用する](/guides/effects/apply-the-same-effects-every-time/)ガイドでは、
同じダイアログの手順リスト側を説明しています。

## プログラムを書く

プログラムは、strictモードで実行される `async` 関数の本体です。そのためトップレベルで `await` を使い、
変数や関数を宣言し、通常の言語機能をすべて利用できます。`sound` オブジェクトがプログラムとエディターを
つなぐ唯一の接続で、そこへのすべての呼び出しはPromiseを返します。

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

プログラム欄でTabを押すとスペースが2つ入力されます。欄から出るにはEscapeを押してからTabを押します。

### プログラムで利用できるもの

通常のJavaScript標準ライブラリが使えます。`Object`、`Array`、`Map`、`Set`、`Math`、`JSON`、`RegExp`、
`Promise`、型付き配列、`Intl`、`TextEncoder`、`TextDecoder`、`structuredClone`、`queueMicrotask` が含まれます。
`console` も利用でき、そこに書いた内容はすべてプログラムのログに入ります。

### プログラムで利用できないもの

プログラムは、最初の行が実行される前に機能を取り除かれたワーカーで実行されます。プログラム内には次のものは
存在しません。`fetch`、`XMLHttpRequest`、`WebSocket`、`indexedDB`、`caches`、`crypto`、`navigator`、`location`、
`Worker`、`WebAssembly`、`SharedArrayBuffer`、`Atomics`、`eval`、`setTimeout`、`setInterval`。これらを読み取ると
`undefined` になります。

プログラムからモジュールを `import` することはできません。静的な `import` は、それを含む行で構文エラーになります。
プログラムに必要なものはすべてプログラム内に記述してください。

セキュリティ境界は、存在しないグローバルではなくエディターそのものです。エディターはこのページに列挙された呼び出し
だけに応答し、それ以外は、プログラムが何を送ろうとしても名前によって拒否します。

## プログラムを実行する

**プログラムを実行**を押します。実行全体がプロジェクト履歴の1つのエントリになるため、プログラムが何回変更しても
**元に戻す**1回ですべての操作を取り消せます。プログラムが例外を投げた場合、キャンセルされた場合、制限時間を超えた場合は、
プロジェクトが実行開始前とまったく同じ状態に戻ります。

**実行をキャンセル**するとプログラムは直ちに停止します。2分間実行されているプログラムも同じように停止し、
*The macro ran for longer than 120 seconds.* というメッセージが表示されます。

実行後、ペインにはプログラムのログが表示され、完了すると *Program applied.* が続きます。失敗した実行では
*The program failed on line N:* とエラーのメッセージが表示されます。行番号は例外を投げたプログラムの行です。

### エフェクトが処理するオーディオ

プログラムが適用するエフェクトは、フォーカスされたトラックの現在の時間選択範囲にかかります。フォーカスされたトラックとは、
最後にヘッダーをクリックしたトラック、または最後にクリップを選択したトラックです。時間選択がなく、クリップが選択されている
場合は、そのクリップが対象になります。プログラムの選択呼び出しは時間範囲と選択トラックの集合を変えますが、フォーカス中の
トラックは変えないため、1回の実行で処理されるのは1トラックです。フォーカスされたトラックがない、または選択範囲が空の場合、
エフェクトメニューと同じメッセージで実行に失敗します。

## `sound` API

以下の各メソッドは、そうでないと明記されていない限りPromiseを返します。次の呼び出しを行う前に毎回awaitしてください。
awaitせずに8回を超える呼び出しを開始すると、9回目は拒否されます。

### `sound.env`

実行を説明するプレーンオブジェクトです。

| フィールド | 意味 |
| --- | --- |
| `productId` | `"soundscaper"`。 |
| `locale` | `"en"` や `"de"` など、エディターのインターフェース言語。 |
| `seed` | 実行の乱数の元になるシード。実行ごとに新しくなります。 |
| `startedAt` | 実行開始時の実時間。ISO 8601文字列です。 |
| `dryRun` | 現在は常に `false`。予約済みです。 |

### `sound.log`

`sound.log.info(...values)`、`sound.log.warn(...values)`、`sound.log.error(...values)`、
`sound.log.debug(...values)` は、それぞれ実行ログに1行を書き込みます。`console.log`、`console.info`、
`console.warn`、`console.error`、`console.debug` も同じです。文字列でない値はJSONとして書き込まれます。
これらのメソッドは何も返さないため、awaitする必要はありません。

ログは最大1,000行または256 KiBのいずれか早い方まで保持され、各行は4,096文字で切り詰められます。それを超えた行は破棄され、
件数が記録されます。件数は最後の警告として報告されます。

### `sound.project`

プロジェクトの読み取りはプロジェクトを変更せず、実行の変更予算にも数えられません。

`sound.project.snapshot()` は `{ sampleRate, tracks, selection }` を返します。`tracks` と `selection` は下記の2つの呼び出しが返すものと同じです。
`sampleRate` はプロジェクトのサンプルレート（ヘルツ）で、このページのフレーム数はすべてこれを基準にしています。

`sound.project.tracks()` はタイムライン順のトラック配列を返します。

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` は1トラックのクリップを返します。`trackId` を省略すると全トラックが対象です。

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` は現在の選択範囲を返します。

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

各選択呼び出しは変更1回として数えられ、`sound.project.selection()` と同じ形で生成した選択範囲を返します。

`sound.select.time(start, end, options)` は時間範囲を秒で設定します。これはAudacityの `SelectTime` コマンドであり、
`options.relativeTo` は各端点をどこから測るかを選びます。両端には-100秒まで指定できます。

| `relativeTo` | 開始端 | 終了端 |
| --- | --- | --- |
| `'project-start'`（既定） | プロジェクト開始から `start` 秒 | プロジェクト開始から `end` 秒 |
| `'project'` | プロジェクト開始から `start` 秒 | プロジェクト終了を過ぎて `end` 秒 |
| `'project-end'` | プロジェクト終了の `start` 秒前 | プロジェクト終了の `end` 秒前 |
| `'selection-start'` | 選択範囲の開始から `start` 秒後 | 選択範囲の開始から `end` 秒後 |
| `'selection'` | 選択範囲の開始から `start` 秒後 | 選択範囲の終了から `end` 秒後 |
| `'selection-end'` | 選択範囲の終了の `start` 秒前 | 選択範囲の終了の `end` 秒前 |

プロジェクトの終了は、いずれかのクリップが到達する最後のフレームです。選択トラックはそのまま残ります。

`sound.select.frames(startFrame, endFrame, options)` は、プロジェクトのサンプルレートでフレーム単位の時間範囲を設定します。
`options.trackIds` は選択するトラックを指定します。省略すると、すでに選択されているトラックが選択されたままになります。
範囲はタイムライン内に収められ、逆順なら端点が入れ替えられます。

`sound.select.tracks(options)` はAudacityの `SelectTracks` コマンドです。インデックス（0から数える）が、
`options.track`（既定値0）から `options.trackCount`（既定値1）個分の範囲にあるトラックを選択します。
`options.mode` は、トラック選択を置き換える `'set'`、広げる `'add'`、そのトラックを選択から外す `'remove'` のいずれかです。
時間範囲はそのまま残ります。

`sound.select.frequencies(options)` はAudacityの `SelectFrequencies` コマンドです。スペクトル選択をヘルツ単位の
`options.low` と `options.high` に設定します。省略した端点は現在の値を保ちます。

`sound.select.all()` は全トラックのプロジェクト全体を選択します。
`sound.select.none()` は選択を解除します。

### `sound.effect(type, params)`

現在の選択範囲に、フォーカスされたトラック上で1つのエフェクトを適用します。`type` は[プログラムで適用できるエフェクト](#effects-a-program-can-apply)
にあるエフェクトIDで、`params` はそのエフェクトのパラメーターオブジェクトです。省略したパラメーターはエフェクトの既定値になり、
値は[オーディオエフェクトリファレンス](/reference/generated/audio-effects/)にある範囲で検査されます。`null` に解決されます。

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

現在の選択範囲に、手順リストマクロが同じ手順を実行した場合とまったく同じように、エフェクトのチェーンを1回で適用します。
各手順は `{ type, params }` で、チェーンには少なくとも1つの手順が必要です。`null` に解決されます。

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

[プログラムで実行できるコマンド](#commands-a-program-can-run)に列挙されたAudacityマクロコマンドを1つ実行します。
4つの選択コマンドはそこで説明するパラメーターを取り、それ以外は何も取りません。実行後の選択範囲に解決されます。

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

同じマクロマネージャーに保存された手順リストマクロを、選択コマンドも含め、正確な名前で実行します。保存済みマクロ自体を
プログラムにすることはできないため、プログラムは入れ子になりません。`null` に解決されます。未知の名前は拒否されます。

### 時間と乱数

実行は再現可能です。同じプロジェクトで同じプログラムを2回実行すると、時計と乱数がマシンのものではないため同じ結果になります。

引数なしの `Date.now()` と `new Date()` は、エディターへの応答済みの呼び出しごとに1ずつ、`ms` の値を受け取る `sound.wait(ms)` のたびに進む、0から始まる仮想時計を返します。
`sound.wait` は直ちに解決されます。プログラムが実時間で一時停止する方法はなく、必要もありません。エディターへの呼び出しはすべてPromiseが解決する前に完了するためです。

`Math.random()` と `sound.random()` は同じジェネレーターで、`sound.env.seed` からシードされます。実行で使った系列を知る必要がある場合はシードをログに記録してください。

### 前提を確認する

`sound.assert(condition, message)` は `message` を、`condition` がfalseのときに投げます。
`sound.assertEqual(actual, expected, message)` は2つの値をJSONとして比較し、異なる場合に投げます。メッセージを指定しなければ、両方の値を示すメッセージになります。
どちらのメソッドもPromiseを返しません。

投げられたエラーは実行を終了し、それ以前のすべてをロールバックするため、失敗したアサーションでプロジェクトが変更されることはありません。

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## エディターとの間を行き来する値

プログラムが渡すすべての引数と受け取るすべての値はプレーンデータです。`null`、ブール値、有限数、文字列、そしてそれらの配列とプレーンオブジェクトが該当します。
`NaN`、`Infinity`、関数、クラスインスタンス、型付き配列、`Date` オブジェクトはエラーとして拒否されます。また、1 MiBを超える値、12レベルを超えて入れ子になった値、
1つの配列またはオブジェクトに4,096個を超えるエントリを持つ値も拒否されます。`undefined` のプロパティは削除されます。

## 制限

| 制限 | 値 |
| --- | --- |
| プログラムの長さ | 256 KiB |
| 1回の実行でエディターを呼び出せる回数 | 4,096 |
| 1回の実行でプロジェクトを変更できる回数（選択呼び出し、エフェクト、コマンド） | 256 |
| 同時に応答待ちにできる呼び出し | 8 |
| 実行時間 | 120秒 |
| エディターとの間を行き来する1つの値 | 1 MiB、深さ12、配列またはオブジェクトあたり4,096エントリ |
| ログ | 1,000行または256 KiB、1行4,096文字 |
| ライブラリ内のプログラム数 | 128 |
| プログラム名 | 256文字 |
| インポートするプログラムファイル | 1 MiB |

各クリップを選択して1つのエフェクトを適用するループでは、クリップごとに2回の変更を消費します。そのため予算内で処理できるのは128クリップです。

## エラー

エディターが拒否した呼び出しは、理由を示す `Error`（`message` が理由を示します）でPromiseを拒否します。たとえば、語彙にないコマンド、空の選択範囲に対するエフェクト、範囲外のパラメーターなどです。
エラーには `code` も含まれ、その値はエディターがより具体的なものを返さない限り `MACRO_CALL_FAILED` です。プログラムはこれらを捕捉して処理を続けられます。

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

このプログラムは完了し、ログには *refused: Unsupported macro command: ExportWav.* と表示されます。

プログラムが捕捉しないエラーは実行を終了し、プロジェクトをロールバックし、発生した行とともにペインに表示されます。
コンパイルできないプログラムも、何も実行される前に同じように報告されます。

## プログラムで適用できるエフェクト {#effects-a-program-can-apply}

ここに挙げるのは、`sound.effect` と `sound.effects` が受け入れるエフェクトID、それぞれが取るパラメーターキーと既定値です。
範囲と単位は[オーディオエフェクトリファレンス](/reference/generated/audio-effects/)にあります。Nyquistプラグインはプログラムから適用できません。

| エフェクト | エフェクトID | パラメーターと既定値 |
| --- | --- | --- |
| 増幅 | `audacity-amplify` | `gainDb: 0`、`allowClipping: false` |
| オートダック | `audacity-auto-duck` | `duckAmountDb: -12`、`innerFadeDown: 0`、`innerFadeUp: 0`、`outerFadeDown: 0.5`、`outerFadeUp: 0.5`、`thresholdDb: -30`、`maximumPause: 1` |
| ベースとトレブル | `audacity-bass-treble` | `bassDb: 0`、`trebleDb: 0`、`volumeDb: 0` |
| ビットクラッシャー | `bitcrusher` | `bitDepth: 8`、`downsampling: 1`、`dither: 'none'`、`interpolation: 'sample-hold'`、`mix: 100` |
| ピッチの変更 | `audacity-change-pitch` | `semitones: 0`、`preserveFormants: true` |
| 速度とピッチの変更 | `audacity-change-speed-pitch` | `speedPercent: 0` |
| テンポの変更 | `audacity-change-tempo` | `tempoPercent: 0` |
| クラシックフィルター | `audacity-classic-filters` | `family: 'butterworth'`、`direction: 'lowpass'`、`order: 1`、`cutoffHz: 1000`、`passbandRippleDb: 1`、`stopbandAttenuationDb: 30` |
| クリック除去 | `audacity-click-removal` | `threshold: 200`、`maximumWidth: 20` |
| コンプレッサー | `audacity-compressor` | `thresholdDb: -10`、`makeupGainDb: 0`、`kneeWidthDb: 5`、`ratio: 10`、`lookaheadMs: 1`、`attackMs: 30`、`releaseMs: 150` |
| ディレイ | `delay` | `time: 0.25`、`feedback: 0.3`、`mix: 0.2` |
| ディストーション | `audacity-distortion` | `mode: 'hard-clipping'`、`dcBlock: false`、`thresholdDb: -6`、`noiseFloorDb: -70`、`parameter1: 50`、`parameter2: 50`、`repeats: 1` |
| エコー | `audacity-echo` | `delaySeconds: 1`、`decay: 0.5` |
| フェードイン | `audacity-fade-in` | なし |
| フェードアウト | `audacity-fade-out` | なし |
| フィルターカーブEQ | `audacity-filter-curve-eq` | `points`: `{ frequency, gain }` の配列。既定値は20 Hzと20 kHzにある2つのフラットな点。`linearFrequencyScale: false`、`filterLength: 8191` |
| 4バンドパラメトリックEQ | `eq` | `outputGain: 0`。4つの `bands` オブジェクト（各オブジェクトは `{ id, enabled, type, frequency, gain, q, slope }`）があり、100、500、2000、8000 Hzをピークとして `gain: 0`、`q: 1`、`slope: 12` |
| ゲート | `gate` | `threshold: -50`、`attack: 0.005`、`hold: 0.05`、`release: 0.1`、`rangeDb: -80` |
| グラフィックEQ | `audacity-graphic-eq` | すべて0 dBの31バンドゲインの `gains`。`interpolation: 'bspline'`、`filterLength: 8191` |
| ハイパスフィルター | `highpass` | `frequency: 80`、`q: 0.707` |
| 反転 | `audacity-invert` | なし |
| レガシーコンプレッサー | `audacity-legacy-compressor` | `thresholdDb: -12`、`noiseFloorDb: -40`、`ratio: 2`、`attackSeconds: 0.2`、`releaseSeconds: 1`、`normalize: true`、`usePeak: false` |
| リミッター | `audacity-limiter` | `thresholdDb: -5`、`makeupTargetDb: -1`、`kneeWidthDb: 2`、`lookaheadMs: 1`、`releaseMs: 20` |
| ラウドネス正規化 | `audacity-loudness-normalization` | `mode: 'lufs'`、`targetLufs: -23`、`targetRmsDb: -20`、`stereoIndependent: false`、`dualMono: true` |
| ローパスフィルター | `lowpass` | `frequency: 18000`、`q: 0.707` |
| ノイズ低減 | `audacity-noise-reduction` | `reductionDb: 6`、`sensitivity: 6`、`frequencySmoothingBands: 6`、`output: 'reduce'` |
| 正規化 | `audacity-normalize` | `peakDb: -1`、`removeDc: true`、`applyGain: true`、`stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`、`timeResolution: 0.25` |
| フェイザー | `audacity-phaser` | `stages: 2`、`dryWet: 128`、`frequency: 0.4`、`phaseDegrees: 0`、`depth: 100`、`feedbackPercent: 0`、`outputGainDb: -6` |
| DCオフセットを除去 | `audacity-remove-dc-offset` | なし |
| 修復 | `audacity-repair` | なし |
| リピート | `audacity-repeat` | `count: 1` |
| リバーブ | `reverb` | `mix: 0.2`、`decay: 2`、`preDelay: 0.01` |
| リバーブ（Audacity） | `audacity-reverb` | `roomSize: 75`、`preDelay: 10`、`reverberance: 50`、`damping: 50`、`toneLow: 100`、`toneHigh: 100`、`wetGainDb: -6`、`dryGainDb: 0`、`stereoWidth: 100`、`wetOnly: false` |
| 反転再生 | `audacity-reverse` | なし |
| スライディングストレッチ | `audacity-sliding-stretch` | `startTempoPercent: 0`、`endTempoPercent: 0`、`startPitchSemitones: 0`、`endPitchSemitones: 0`、`preserveFormants: true` |
| 無音を切り詰める | `audacity-truncate-silence` | `thresholdDb: -20`、`action: 'truncate'`、`minimumSilence: 0.5`、`truncateTo: 0.5`、`compressPercent: 50`、`independent: false` |
| ユーティリティゲイン（レビュー済み） | `reviewed-utility-gain` | `gain: 1` |
| ワウワウ | `audacity-wahwah` | `frequency: 1.5`、`phaseDegrees: 0`、`depthPercent: 70`、`resonance: 2.5`、`frequencyOffsetPercent: 30`、`outputGainDb: -6` |

2つのエフェクトには、プログラムから渡せないものがあります。ノイズ低減にはエフェクト独自のダイアログで取得したノイズプロファイルが必要で、
オートダックにはフォーカス中のトラックの下にあるコントロールトラックが必要です。

## プログラムで実行できるコマンド {#commands-a-program-can-run}

`sound.command` は下記のAudacityマクロコマンド名を受け入れます。手順リストマクロに保持できる名前と同じなので、プログラムと手順リストの到達範囲はまったく同じです。
各コマンドは[コマンドリファレンス](/reference/generated/commands/)が説明するエディター操作を実行します。

### パラメーター付きの選択コマンド

| コマンド | パラメーター |
| --- | --- |
| `SelectTime` | 秒単位の `start`、`end`。`relativeTo` は `sound.select.time` と同じ |
| `SelectFrequencies` | ヘルツ単位の `low`、`high` |
| `SelectTracks` | `track`、`trackCount`（0から100）。`mode` は `'set'`、`'add'`、`'remove'` のいずれか |
| `Select` | 上記3つの集合の任意の組み合わせ |

省略したパラメーターは選択のその部分を変更しません。これもAudacityと同じ動作です。

### パラメーターなしのコマンド

| グループ | コマンド |
| --- | --- |
| 選択 | `SelectAll`、`SelectNone`、`SelCursorStoredCursor`、`SelTrackStartToEnd`、`SelCursorToTrackEnd`、`SelPrevClip`、`SelNextClip`、`ZeroCross` |
| 編集 | `Cut`、`Copy`、`Paste`、`Delete`、`Duplicate`、`Split`、`SplitNew`、`Join`、`Disjoin`、`Trim`、`Silence`、`SplitCut`、`SplitDelete` |
| トラック | `NewMonoTrack`、`NewStereoTrack`、`NewLabelTrack`、`RemoveTracks`、`MixAndRender`、`SortByName`、`SortByTime` |
| ラベル | `AddLabel` |
| 分析 | `FindClipping`、`ContrastAnalyser`、`PlotSpectrum`、`RepeatLastEffect` |

### 意図的に含まれていないもの

`Undo` と `Redo` はありません。実行自体がすでに1つの履歴エントリであり、履歴をたどる手順が実行より前の自分の編集に到達してしまうためです。
トランスポートと録音のコマンドは、プログラムには待つ対象がなく、録音からロールバックできないためありません。
開く、保存、閉じる、インポート、エクスポート、環境設定は、プログラムが扱えるのが開始時に開いていた1つのプロジェクトだからありません。
ダイアログを開くだけ、または表示を変更するだけのコマンドは、プロジェクトを変更しないためありません。

## プログラムを共有する {#sharing-programs}

**プログラムをエクスポート**は選択したプログラムを `.soundscapemacro` ファイルとして書き出し、**プログラムをインポート**はそれを読み込みます。
このファイルは単なる `.js` ファイルではなくJSONなので、受け取ったコンピューターがエディターの外で実行するものと誤認することはありません。

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

インポートで保存されるのはテキストだけです。インポートしたプログラムには**プログラムを実行**ボタンがなく、代わりにペインにプログラム、
その出所のファイル、開いているプロジェクトに対してできることの説明、*I have read this program and want to run it.* と書かれたチェックボックスが表示されます。
チェックを入れると**このプログラムを有効化**が有効になり、その後で初めてプログラムを実行できます。

この権限は読んだ正確なテキストに対するものです。自分で編集した場合でも、新しいコピーを上書きインポートした場合でも、その後プログラムが変わると、
新しいテキストを有効化するまで再び確認が表示されます。マネージャーで自分で書いたプログラムには確認は必要ありません。

## 例

クリップがある最初のトラックにあるすべてのクリップをフェードインします。実行前にそのトラックのヘッダーをクリックして、
エフェクトがプログラムの読み取っているトラックに適用されるようにします。

```js
let target = null;
let clips = [];
for (const track of await sound.project.tracks()) {
  clips = await sound.project.clips(track.id);
  if (clips.length) {
    target = track;
    break;
  }
}
sound.assert(target, 'There are no clips to fade.');
for (const clip of clips) {
  await sound.select.frames(clip.startFrame, clip.startFrame + clip.durationFrames, {
    trackIds: [target.id],
  });
  await sound.effect('audacity-fade-in');
  sound.log.info(`Faded in ${clip.name} on ${target.name}`);
}
```

プロジェクトを変更せずに報告します。

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

選択範囲が十分に長い場合だけ、保存済みの手順リストマクロを実行します。

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## このページについて

このページにある、1行のスニペットから実例までのすべてのプログラムは、ブラウザースイート
（`tests/browser/handbook-macro-program-examples.spec.js`）によってSoundscaperの各ビルドに対して実行されます。
ブラウザースイートはこのページ自身のテキストからプログラムを読み取ります。このページの説明どおりに完了しなくなったり、
生成物が説明と違ったりするプログラムがあると、ページまたはエディターが修正されるまでビルドは失敗します。
