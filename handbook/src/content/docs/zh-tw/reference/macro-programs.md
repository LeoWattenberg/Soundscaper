---
title: "宏程序"
description: "宏程序可調用的 JavaScript API、運行限制以及程序文件格式。"
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"zh-TW"} -->

宏程序是用 JavaScript 編寫的宏，而非步驟列表。它在編輯器內部運行，通過名為 `sound` 的簡易 API 讀取打開的項目、移動選區，並應用步驟列表宏可用的相同效果和命令。除此之外，它無法訪問文件、網絡或你的其他項目。

程序是 Soundscaper 的功能。Framescaper 沒有宏管理器。

## 程序的存放位置

選擇 **工具 → 宏管理器**。對話框會列出步驟列表宏，並在“程序”部分列出你保存的程序。
在“程序”標題中，按 **+（新建程序）** 創建程序。相同的操作欄還提供
**導入程序**、
**導出程序**和**刪除程序**操作。詳情窗格會顯示
**程序名稱**、**程序**文本和**運行程序**按鈕。文本會在你輸入時保存；無需單獨保存。


程序保存在編輯器設置中，而不在項目內，因此在此編輯器中打開的每個項目都可以使用它。使用**導出程序**和**導入程序**可將程序轉移到另一台設備或交給他人；詳情請參見
[分享程序](#sharing-programs)。



[每次都應用相同的效果鏈](/guides/effects/apply-the-same-effects-every-time/)
指南介紹了同一對話框中的步驟列表功能。

## 編寫程序

程序是以嚴格模式運行的 `async` 函數體。這意味著你可以在頂層使用 `await`、聲明變量和函數，並使用所有常見語言功能。

`sound` 對象是程序與編輯器之間唯一的連接，其中每個調用都會返回一個 promise。


```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

在程序字段中按 Tab 會插入兩個空格。按 Escape 後再按 Tab 可離開該字段。


### 程序可以使用的內容

程序可以使用常見的 JavaScript 標準庫，包括 `Object`、`Array`、`Map`、`Set`、`Math`、`JSON`、`RegExp`、`Promise`、類型化數組、`Intl`、`TextEncoder`、`TextDecoder`、`structuredClone` 和 `queueMicrotask`。此外還提供 `console`，寫入其中的所有內容都會顯示在程序日誌中。

### 程序無法使用的內容

程序在 worker 中運行，其能力在執行第一行代碼之前已被限制。程序中不存在以下對象：
`fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` 和 `setInterval`。讀取其中任一項都會得到 `undefined`。

程序無法 `import` 模塊；靜態 `import` 會在所在行觸發語法錯誤。程序所需的一切都必須直接寫在程序中。


安全邊界並非缺少的全局對象，而是編輯器本身：無論程序發送甚麼內容，編輯器都只響應本頁列出的調用，並會按名稱拒絕其餘所有內容。

## 運行程序

按**運行程序**。整個運行過程在項目歷史記錄中只算一項，因此一次**撤銷**即可撤回程序所做的所有更改，無論更改多少。如果程序拋出錯誤、被取消或超過時限，項目都會精確恢復到運行開始前的狀態。

**取消運行**會立即停止程序。程序運行超過兩分鐘後也會以相同方式停止，並顯示消息 *宏運行時間超過 120 秒。*

運行結束後，窗格會顯示程序日誌；成功完成時，後面會出現 *程序已應用。* 運行失敗時會顯示 *程序在第 N 行失敗：* 以及錯誤消息，其中行號是程序拋出錯誤所在的行。

### 效果會處理哪些音頻

程序應用的效果會處理焦點軌道上的當前時間選區。焦點軌道是你最後單擊其標題或最後選中其片段的軌道。如果沒有時間選區但選中了片段，效果會處理該片段。程序的選區調用會更改時間範圍和所選軌道集合，但不會更改焦點軌道，因此一次運行只處理一條軌道。如果沒有焦點軌道或選區為空，運行會失敗，並顯示與“效果”菜單相同的消息。

## `sound` API

除非另有說明，以下每個方法都會返回 promise。請等待每次調用完成後再開始下一次調用；若程序連續發起超過八次調用而未等待，第九次調用將被拒絕。

### `sound.env`

描述本次運行的普通對象。

| 字段 | 含義 |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | 編輯器的界面語言，例如 `"en"` 或 `"de"`。 |
| `seed` | 本次運行隨機數所用的種子。每次運行都會生成新種子。 |
| `startedAt` | 本次運行開始時的實際時間，格式為 ISO 8601 字符串。 |
| `dryRun` | 目前始終為 `false`。預留字段。 |

### `sound.log`

`sound.log.info(...values)`、`sound.log.warn(...values)`、`sound.log.error(...values)` 和 `sound.log.debug(...values)` 都會在運行日誌中各寫入一行。`console.log`、`console.info`、`console.warn`、`console.error` 和 `console.debug` 也會執行相同操作。非字符串值會寫為 JSON。這些方法不返回值，也無需等待。

日誌最多保存 1,000 行或 256 KiB，以先達到者為準；每行最多 4,096 個字符。超出限制的行會被丟棄並計數，最終會以警告報告丟棄數量。

### `sound.project`

讀取項目不會更改項目，也不計入本次運行的更改額度。

`sound.project.snapshot()` 返回 `{ sampleRate, tracks, selection }`；其中 `tracks` 和 `selection` 的結構分別與下面兩個調用的返回值相同。`sampleRate` 是項目的採樣率，單位為赫茲；本頁所有幀數都以此為基準。

`sound.project.tracks()` 按時間線順序返回軌道數組：

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` 返回一條軌道上的片段；若省略 `trackId`，則返回所有軌道上的片段
：

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` 返回當前選區：

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

每次選區調用都計為一次更改，並返回其生成的選區；結構與 `sound.project.selection()` 的返回值相同。

`sound.select.time(start, end, options)` 以秒為單位設置時間範圍。這是 Audacity 的 `SelectTime` 命令；`options.relativeTo` 決定每個邊緣從何處開始測量。兩個邊緣最低均可設為 -100 秒。

| `relativeTo` | 起始邊緣 | 結束邊緣 |
| --- | --- | --- |
| `'project-start'`（默認） | `start` 距項目開頭的秒數 | `end` 距項目開頭的秒數 |
| `'project'` | `start` 距項目開頭的秒數 | `end` 超過項目結尾的秒數 |
| `'project-end'` | `start` 距項目結尾之前的秒數 | `end` 距項目結尾之前的秒數 |
| `'selection-start'` | `start` 距選區起點之後的秒數 | `end` 距選區起點之後的秒數 |
| `'selection'` | `start` 距選區起點之後的秒數 | `end` 距選區終點之後的秒數 |
| `'selection-end'` | `start` 距選區終點之前的秒數 | `end` 距選區終點之前的秒數 |

項目結尾是任意片段到達的最後一幀。所選軌道保持不變。

`sound.select.frames(startFrame, endFrame, options)` 按項目採樣率以幀為單位設置時間範圍。`options.trackIds` 用於指定要選中的軌道；若省略，當前已選軌道會保持選中。範圍會限制在時間線內，若邊緣順序顛倒則會交換。

`sound.select.tracks(options)` 是 Audacity 的 `SelectTracks` 命令。它會選中從 `options.track`（默認值為 0）開始的 `options.trackCount` 條軌道（默認值為 1），軌道索引從 0 開始。`options.mode` 可設為 `'set'` 替換軌道選區、設為 `'add'` 擴大選區，或設為 `'remove'` 從選區中移除這些軌道。時間範圍保持不變。

`sound.select.frequencies(options)` 是 Audacity 的 `SelectFrequencies` 命令。它以赫茲為單位將頻譜選區設為 `options.low` 和 `options.high`；省略某個邊緣參數時，該邊緣保持當前值。

`sound.select.all()` 會選中所有軌道上的整個項目。`sound.select.none()` 會清除選區。

### `sound.effect(type, params)`

在焦點軌道的當前選區上應用一種效果。`type` 是[程序可應用的效果](#effects-a-program-can-apply)中的效果 ID，`params` 是該效果參數組成的對象。省略的參數使用效果默認值；參數值會按[音頻效果參考](/reference/generated/audio-effects/)中的範圍檢查。該方法解析為 `null`。

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

一次性對當前選區應用一連串效果，行為與包含這些步驟的步驟列表宏完全相同。每個步驟都是 `{ type, params }`，效果鏈至少需要一個步驟。該方法解析為 `null`。

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

運行[程序可運行的命令](#commands-a-program-can-run)中列出的某條 Audacity 宏命令。四種選區命令需要使用該處說明的參數；其他命令不需要參數。該方法解析為運行後的選區。

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

按準確名稱運行保存在同一宏管理器中的步驟列表宏，包括其中的任何選區命令。已保存的宏不能是另一個程序，因此程序不會嵌套。該方法解析為 `null`；名稱未知時會拒絕運行。

### 時間與隨機數

一次運行具有可復現性：同一程序在同一項目上運行兩次會得到相同結果，因為時鐘和隨機數不依賴計算機本身。

不帶參數的 `Date.now()` 和 `new Date()` 會返回虛擬時鐘。時鐘從 0 開始，每次編輯器調用得到響應後前進 1；每次等待的時長 `ms` 會令時鐘前進相應數值。通過 `sound.wait(ms)` 等待時會立即解析（`sound.wait`）；程序無法暫停真實時間，也不需要暫停，因為每次編輯器調用都會在其 promise 解析前完成。

`Math.random()` 和 `sound.random()` 使用同一隨機數生成器，種子來自 `sound.env.seed`。如果需要確認本次運行使用了哪組隨機序列，請在日誌中記錄種子。

### 檢查假設

`sound.assert(condition, message)` 會在 `message` 所對應的 `condition` 不成立時拋出錯誤。`sound.assertEqual(actual, expected, message)` 會將兩個值作為 JSON 進行比較；如果兩者不同則會拋出錯誤。若提供了消息，錯誤會列出這兩個值。由於錯誤會終止運行並回滾此前的所有操作，斷言失敗時項目不會改變。這兩個方法都不返回 promise。

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## 與編輯器交互的數據

程序傳入的所有參數和收到的所有值都必須是普通數據：`null`、布爾值、有限數值、字符串，以及由這些值組成的數組和普通對象。`NaN`、`Infinity`、函數、類實例、類型化數組和 `Date` 對象都會被拒絕並報錯。大於 1 MiB、嵌套超過 12 層，或任一數組或對象包含超過 4,096 個條目的值也會被拒絕。`undefined` 屬性會被丟棄。

## 限制

| 限制項 | 上限 |
| --- | --- |
| 程序長度 | 256 KiB |
| 每次運行對編輯器的調用次數 | 4,096 |
| 每次運行對項目的更改次數（選區調用、效果、命令） | 256 |
| 同時等待響應的調用數 | 8 |
| 運行時間 | 120 秒 |
| 與編輯器交互的單個值 | 1 MiB、嵌套 12 層；每個數組或對象最多 4,096 個條目 |
| 日誌 | 1,000 行或 256 KiB；每行最多 4,096 個字符 |
| 程序庫中的程序數 | 128 |
| 程序名稱 | 256 個字符 |
| 導入的程序文件 | 1 MiB |

循環選中每個片段並應用一個效果，每個片段會消耗兩次項目更改額度，因此額度用盡前最多可處理 128 個片段。

## 錯誤

編輯器拒絕某項調用時，會以 `Error` 拒絕其 promise，並在 `message` 中說明原因，例如命令不在允許範圍內、效果作用於空選區，或參數超出範圍。錯誤還帶有 `code`；除非編輯器提供更具體的代碼，否則其值為 `MACRO_CALL_FAILED`。程序可以捕獲此類錯誤並繼續運行：

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

該程序仍會完成，日誌內容為 *拒絕：不支持的宏命令：ExportWav。*

程序未捕獲的錯誤會終止運行、回滾項目，並在窗格中顯示錯誤所在的行。無法編譯的程序也會在運行前以相同方式報告。

## 程序可應用的效果 {#effects-a-program-can-apply}

以下列出 `sound.effect` 和 `sound.effects` 接受的效果 ID、各效果的參數鍵及默認值。取值範圍和單位請參閱[音頻效果參考](/reference/generated/audio-effects/)。程序無法應用 Nyquist 插件。

| 效果 | 效果 ID | 參數與默認值 |
| --- | --- | --- |
| 放大 | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| 自動閃避 | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| 低音與高音 | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| 更改音高 | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| 更改速度和音高 | `audacity-change-speed-pitch` | `speedPercent: 0` |
| 更改速度 | `audacity-change-tempo` | `tempoPercent: 0` |
| 經典濾波器 | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| 咔嗒聲移除 | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| 壓縮器 | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| 延遲 | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| 失真 | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| 回聲 | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| 淡入 | `audacity-fade-in` | 無 |
| 淡出 | `audacity-fade-out` | 無 |
| 濾波曲線均衡器 | `audacity-filter-curve-eq` | `points`：由 `{ frequency, gain }` 組成的數組，默認包含位於 20 Hz 和 20 kHz 的兩個平直點；`linearFrequencyScale: false`；`filterLength: 8191` |
| 四段參數均衡器 | `eq` | `outputGain: 0`；`bands`：四個 `{ id, enabled, type, frequency, gain, q, slope }` 對象，中心頻率分別為 100、500、2000 和 8000 Hz，且 `gain: 0`、`q: 1`、`slope: 12` |
| 門限 | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| 圖示均衡器 | `audacity-graphic-eq` | `gains`：31 個頻段增益（dB），全部為 0；`interpolation: 'bspline'`; `filterLength: 8191` |
| 高通濾波器 | `highpass` | `frequency: 80`, `q: 0.707` |
| 反相 | `audacity-invert` | 無 |
| 舊版壓縮器 | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| 限幅器 | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| 響度標準化 | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| 低通濾波器 | `lowpass` | `frequency: 18000`, `q: 0.707` |
| 降噪 | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| 標準化 | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch 拉伸 | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| 移相器 | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| 移除直流偏移 | `audacity-remove-dc-offset` | 無 |
| 修復 | `audacity-repair` | 無 |
| 重復 | `audacity-repeat` | `count: 1` |
| 混響 | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| 混響（Audacity） | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| 反轉 | `audacity-reverse` | 無 |
| 漸變拉伸 | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| 截斷靜音 | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| 實用增益（已審查） | `reviewed-utility-gain` | `gain: 1` |
| 哇音 | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

有兩個效果需要程序無法提供的內容。“降噪”需要在效果自己的對話框中採集噪聲樣本；“自動閃避”則需要焦點軌道下方存在控制軌道。

## 程序可運行的命令 {#commands-a-program-can-run}

`sound.command` 接受以下 Audacity 宏命令名稱。這些名稱與步驟列表宏可用的名稱相同，因此程序和步驟列表具有完全相同的操作範圍。每條命令都會執行[命令參考](/reference/generated/commands/)中所述的編輯器操作。

### 帶參數的選區命令

| 命令 | 參數 |
| --- | --- |
| `SelectTime` | `start`、`end`（秒）；`relativeTo` 與 `sound.select.time` 相同 |
| `SelectFrequencies` | `low`、`high`（赫茲） |
| `SelectTracks` | `track`、`trackCount`（0 到 100）；`mode` 可為 `'set'`、`'add'` 或 `'remove'` |
| `Select` | 可組合使用上述三組參數 |

省略某項參數會使選區的相應部分保持不變；Audacity 對這些參數的處理方式也是如此。

### 不帶參數的命令

| 分組 | 命令 |
| --- | --- |
| 選區 | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| 編輯 | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| 軌道 | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| 標籤 | `AddLabel` |
| 分析 | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### 有意不提供的命令

這裡不提供 `Undo` 和 `Redo`，因為一次運行本身就是一條歷史記錄；遍歷歷史的步驟會越過本次運行，觸及你自己的編輯操作。程序也無法使用播放和錄音命令，因為它無需等待，而且錄音無法回滾。打開、保存、關閉、導入、導出和偏好設置命令同樣不可用，因為程序只能訪問啓動時打開的單個項目。僅打開對話框或更改視圖的命令不會更改項目，因此也不提供。

## 分享程序 {#sharing-programs}

**導出程序**會將選中的程序寫入 `.soundscapemacro` 文件，**導入程序**會讀取該文件。該文件採用 JSON 格式，而非單獨的 `.js` 文件，因此接收方的計算機不會誤將其當作編輯器之外可運行的腳本：

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

導入時只會保存文本。導入的程序不會顯示**運行程序**按鈕；窗格會改為顯示程序內容、來源文件、關於程序可能對當前項目執行哪些操作的說明，以及一個標有 *我已閱讀此程序並希望運行它。* 的復選框。勾選後會啓用**啓用此程序**，之後程序才能運行。

此授權僅適用於你審閱過的具體文本。如果之後程序發生變化，無論是你編輯了程序還是導入新副本覆蓋它，都必須重新審閱並啓用新文本。你自己在管理器中編寫的程序無需審閱。

## 示例

對第一條包含片段的軌道中的每個片段淡入。運行前請單擊該軌道標題，以便效果應用到程序處理的軌道：

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

報告項目信息，但不作更改：

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

僅當選區長度足夠時才運行已保存的步驟列表宏：

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## 關於本頁

本頁中的所有程序，從單行片段到完整示例，都會由瀏覽器測試套件
(`tests/browser/handbook-macro-program-examples.spec.js`) 在每個 Soundscaper 構建版本上運行。該測試會直接從本頁文本中讀取程序。如果某個程序無法完成，或無法產生本頁所述的結果，則構建會失敗，直到修正本頁或編輯器。
