---
title: "宏程序"
description: "宏程序可调用的 JavaScript API、运行限制以及程序文件格式。"
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"zh-CN"} -->

宏程序是用 JavaScript 编写的宏，而非步骤列表。它在编辑器内部运行，通过名为 `sound` 的简易 API 读取打开的项目、移动选区，并应用步骤列表宏可用的相同效果和命令。除此之外，它无法访问文件、网络或你的其他项目。

程序是 Soundscaper 的功能。Framescaper 没有宏管理器。

## 程序的存放位置

选择 **工具 → 宏管理器**。对话框会列出步骤列表宏，并在“程序”部分列出你保存的程序。
在“程序”标题中，按 **+（新建程序）** 创建程序。相同的操作栏还提供
**导入程序**、
**导出程序**和**删除程序**操作。详情窗格会显示
**程序名称**、**程序**文本和**运行程序**按钮。文本会在你输入时保存；无需单独保存。


程序保存在编辑器设置中，而不在项目内，因此在此编辑器中打开的每个项目都可以使用它。使用**导出程序**和**导入程序**可将程序转移到另一台设备或交给他人；详情请参见
[分享程序](#sharing-programs)。



[每次都应用相同的效果链](/guides/effects/apply-the-same-effects-every-time/)
指南介绍了同一对话框中的步骤列表功能。

## 编写程序

程序是以严格模式运行的 `async` 函数体。这意味着你可以在顶层使用 `await`、声明变量和函数，并使用所有常见语言功能。

`sound` 对象是程序与编辑器之间唯一的连接，其中每个调用都会返回一个 promise。


```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

在程序字段中按 Tab 会插入两个空格。按 Escape 后再按 Tab 可离开该字段。


### 程序可以使用的内容

程序可以使用常见的 JavaScript 标准库，包括 `Object`、`Array`、`Map`、`Set`、`Math`、`JSON`、`RegExp`、`Promise`、类型化数组、`Intl`、`TextEncoder`、`TextDecoder`、`structuredClone` 和 `queueMicrotask`。此外还提供 `console`，写入其中的所有内容都会显示在程序日志中。

### 程序无法使用的内容

程序在 worker 中运行，其能力在执行第一行代码之前已被限制。程序中不存在以下对象：
`fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` 和 `setInterval`。读取其中任一项都会得到 `undefined`。

程序无法 `import` 模块；静态 `import` 会在所在行触发语法错误。程序所需的一切都必须直接写在程序中。


安全边界并非缺少的全局对象，而是编辑器本身：无论程序发送什么内容，编辑器都只响应本页列出的调用，并会按名称拒绝其余所有内容。

## 运行程序

按**运行程序**。整个运行过程在项目历史记录中只算一项，因此一次**撤销**即可撤回程序所做的所有更改，无论更改多少。如果程序抛出错误、被取消或超过时限，项目都会精确恢复到运行开始前的状态。

**取消运行**会立即停止程序。程序运行超过两分钟后也会以相同方式停止，并显示消息 *宏运行时间超过 120 秒。*

运行结束后，窗格会显示程序日志；成功完成时，后面会出现 *程序已应用。* 运行失败时会显示 *程序在第 N 行失败：* 以及错误消息，其中行号是程序抛出错误所在的行。

### 效果会处理哪些音频

程序应用的效果会处理焦点轨道上的当前时间选区。焦点轨道是你最后单击其标题或最后选中其片段的轨道。如果没有时间选区但选中了片段，效果会处理该片段。程序的选区调用会更改时间范围和所选轨道集合，但不会更改焦点轨道，因此一次运行只处理一条轨道。如果没有焦点轨道或选区为空，运行会失败，并显示与“效果”菜单相同的消息。

## `sound` API

除非另有说明，以下每个方法都会返回 promise。请等待每次调用完成后再开始下一次调用；若程序连续发起超过八次调用而未等待，第九次调用将被拒绝。

### `sound.env`

描述本次运行的普通对象。

| 字段 | 含义 |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | 编辑器的界面语言，例如 `"en"` 或 `"de"`。 |
| `seed` | 本次运行随机数所用的种子。每次运行都会生成新种子。 |
| `startedAt` | 本次运行开始时的实际时间，格式为 ISO 8601 字符串。 |
| `dryRun` | 目前始终为 `false`。预留字段。 |

### `sound.log`

`sound.log.info(...values)`、`sound.log.warn(...values)`、`sound.log.error(...values)` 和 `sound.log.debug(...values)` 都会在运行日志中各写入一行。`console.log`、`console.info`、`console.warn`、`console.error` 和 `console.debug` 也会执行相同操作。非字符串值会写为 JSON。这些方法不返回值，也无需等待。

日志最多保存 1,000 行或 256 KiB，以先达到者为准；每行最多 4,096 个字符。超出限制的行会被丢弃并计数，最终会以警告报告丢弃数量。

### `sound.project`

读取项目不会更改项目，也不计入本次运行的更改额度。

`sound.project.snapshot()` 返回 `{ sampleRate, tracks, selection }`；其中 `tracks` 和 `selection` 的结构分别与下面两个调用的返回值相同。`sampleRate` 是项目的采样率，单位为赫兹；本页所有帧数都以此为基准。

`sound.project.tracks()` 按时间线顺序返回轨道数组：

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` 返回一条轨道上的片段；若省略 `trackId`，则返回所有轨道上的片段
：

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` 返回当前选区：

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

每次选区调用都计为一次更改，并返回其生成的选区；结构与 `sound.project.selection()` 的返回值相同。

`sound.select.time(start, end, options)` 以秒为单位设置时间范围。这是 Audacity 的 `SelectTime` 命令；`options.relativeTo` 决定每个边缘从何处开始测量。两个边缘最低均可设为 -100 秒。

| `relativeTo` | 起始边缘 | 结束边缘 |
| --- | --- | --- |
| `'project-start'`（默认） | `start` 距项目开头的秒数 | `end` 距项目开头的秒数 |
| `'project'` | `start` 距项目开头的秒数 | `end` 超过项目结尾的秒数 |
| `'project-end'` | `start` 距项目结尾之前的秒数 | `end` 距项目结尾之前的秒数 |
| `'selection-start'` | `start` 距选区起点之后的秒数 | `end` 距选区起点之后的秒数 |
| `'selection'` | `start` 距选区起点之后的秒数 | `end` 距选区终点之后的秒数 |
| `'selection-end'` | `start` 距选区终点之前的秒数 | `end` 距选区终点之前的秒数 |

项目结尾是任意片段到达的最后一帧。所选轨道保持不变。

`sound.select.frames(startFrame, endFrame, options)` 按项目采样率以帧为单位设置时间范围。`options.trackIds` 用于指定要选中的轨道；若省略，当前已选轨道会保持选中。范围会限制在时间线内，若边缘顺序颠倒则会交换。

`sound.select.tracks(options)` 是 Audacity 的 `SelectTracks` 命令。它会选中从 `options.track`（默认值为 0）开始的 `options.trackCount` 条轨道（默认值为 1），轨道索引从 0 开始。`options.mode` 可设为 `'set'` 替换轨道选区、设为 `'add'` 扩大选区，或设为 `'remove'` 从选区中移除这些轨道。时间范围保持不变。

`sound.select.frequencies(options)` 是 Audacity 的 `SelectFrequencies` 命令。它以赫兹为单位将频谱选区设为 `options.low` 和 `options.high`；省略某个边缘参数时，该边缘保持当前值。

`sound.select.all()` 会选中所有轨道上的整个项目。`sound.select.none()` 会清除选区。

### `sound.effect(type, params)`

在焦点轨道的当前选区上应用一种效果。`type` 是[程序可应用的效果](#effects-a-program-can-apply)中的效果 ID，`params` 是该效果参数组成的对象。省略的参数使用效果默认值；参数值会按[音频效果参考](/reference/generated/audio-effects/)中的范围检查。该方法解析为 `null`。

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

一次性对当前选区应用一连串效果，行为与包含这些步骤的步骤列表宏完全相同。每个步骤都是 `{ type, params }`，效果链至少需要一个步骤。该方法解析为 `null`。

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

运行[程序可运行的命令](#commands-a-program-can-run)中列出的某条 Audacity 宏命令。四种选区命令需要使用该处说明的参数；其他命令不需要参数。该方法解析为运行后的选区。

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

按准确名称运行保存在同一宏管理器中的步骤列表宏，包括其中的任何选区命令。已保存的宏不能是另一个程序，因此程序不会嵌套。该方法解析为 `null`；名称未知时会拒绝运行。

### 时间与随机数

一次运行具有可复现性：同一程序在同一项目上运行两次会得到相同结果，因为时钟和随机数不依赖计算机本身。

不带参数的 `Date.now()` 和 `new Date()` 会返回虚拟时钟。时钟从 0 开始，每次编辑器调用得到响应后前进 1；每次等待的时长 `ms` 会令时钟前进相应数值。通过 `sound.wait(ms)` 等待时会立即解析（`sound.wait`）；程序无法暂停真实时间，也不需要暂停，因为每次编辑器调用都会在其 promise 解析前完成。

`Math.random()` 和 `sound.random()` 使用同一随机数生成器，种子来自 `sound.env.seed`。如果需要确认本次运行使用了哪组随机序列，请在日志中记录种子。

### 检查假设

`sound.assert(condition, message)` 会在 `message` 所对应的 `condition` 不成立时抛出错误。`sound.assertEqual(actual, expected, message)` 会将两个值作为 JSON 进行比较；如果两者不同则会抛出错误。若提供了消息，错误会列出这两个值。由于错误会终止运行并回滚此前的所有操作，断言失败时项目不会改变。这两个方法都不返回 promise。

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## 与编辑器交互的数据

程序传入的所有参数和收到的所有值都必须是普通数据：`null`、布尔值、有限数值、字符串，以及由这些值组成的数组和普通对象。`NaN`、`Infinity`、函数、类实例、类型化数组和 `Date` 对象都会被拒绝并报错。大于 1 MiB、嵌套超过 12 层，或任一数组或对象包含超过 4,096 个条目的值也会被拒绝。`undefined` 属性会被丢弃。

## 限制

| 限制项 | 上限 |
| --- | --- |
| 程序长度 | 256 KiB |
| 每次运行对编辑器的调用次数 | 4,096 |
| 每次运行对项目的更改次数（选区调用、效果、命令） | 256 |
| 同时等待响应的调用数 | 8 |
| 运行时间 | 120 秒 |
| 与编辑器交互的单个值 | 1 MiB、嵌套 12 层；每个数组或对象最多 4,096 个条目 |
| 日志 | 1,000 行或 256 KiB；每行最多 4,096 个字符 |
| 程序库中的程序数 | 128 |
| 程序名称 | 256 个字符 |
| 导入的程序文件 | 1 MiB |

循环选中每个片段并应用一个效果，每个片段会消耗两次项目更改额度，因此额度用尽前最多可处理 128 个片段。

## 错误

编辑器拒绝某项调用时，会以 `Error` 拒绝其 promise，并在 `message` 中说明原因，例如命令不在允许范围内、效果作用于空选区，或参数超出范围。错误还带有 `code`；除非编辑器提供更具体的代码，否则其值为 `MACRO_CALL_FAILED`。程序可以捕获此类错误并继续运行：

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

该程序仍会完成，日志内容为 *拒绝：不支持的宏命令：ExportWav。*

程序未捕获的错误会终止运行、回滚项目，并在窗格中显示错误所在的行。无法编译的程序也会在运行前以相同方式报告。

## 程序可应用的效果 {#effects-a-program-can-apply}

以下列出 `sound.effect` 和 `sound.effects` 接受的效果 ID、各效果的参数键及默认值。取值范围和单位请参阅[音频效果参考](/reference/generated/audio-effects/)。程序无法应用 Nyquist 插件。

| 效果 | 效果 ID | 参数与默认值 |
| --- | --- | --- |
| 放大 | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| 自动闪避 | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| 低音与高音 | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| 更改音高 | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| 更改速度和音高 | `audacity-change-speed-pitch` | `speedPercent: 0` |
| 更改速度 | `audacity-change-tempo` | `tempoPercent: 0` |
| 经典滤波器 | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| 咔嗒声移除 | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| 压缩器 | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| 延迟 | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| 失真 | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| 回声 | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| 淡入 | `audacity-fade-in` | 无 |
| 淡出 | `audacity-fade-out` | 无 |
| 滤波曲线均衡器 | `audacity-filter-curve-eq` | `points`：由 `{ frequency, gain }` 组成的数组，默认包含位于 20 Hz 和 20 kHz 的两个平直点；`linearFrequencyScale: false`；`filterLength: 8191` |
| 四段参数均衡器 | `eq` | `outputGain: 0`；`bands`：四个 `{ id, enabled, type, frequency, gain, q, slope }` 对象，中心频率分别为 100、500、2000 和 8000 Hz，且 `gain: 0`、`q: 1`、`slope: 12` |
| 门限 | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| 图示均衡器 | `audacity-graphic-eq` | `gains`：31 个频段增益（dB），全部为 0；`interpolation: 'bspline'`; `filterLength: 8191` |
| 高通滤波器 | `highpass` | `frequency: 80`, `q: 0.707` |
| 反相 | `audacity-invert` | 无 |
| 旧版压缩器 | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| 限幅器 | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| 响度标准化 | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| 低通滤波器 | `lowpass` | `frequency: 18000`, `q: 0.707` |
| 降噪 | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| 标准化 | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch 拉伸 | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| 移相器 | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| 移除直流偏移 | `audacity-remove-dc-offset` | 无 |
| 修复 | `audacity-repair` | 无 |
| 重复 | `audacity-repeat` | `count: 1` |
| 混响 | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| 混响（Audacity） | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| 反转 | `audacity-reverse` | 无 |
| 渐变拉伸 | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| 截断静音 | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| 实用增益（已审查） | `reviewed-utility-gain` | `gain: 1` |
| 哇音 | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

有两个效果需要程序无法提供的内容。“降噪”需要在效果自己的对话框中采集噪声样本；“自动闪避”则需要焦点轨道下方存在控制轨道。

## 程序可运行的命令 {#commands-a-program-can-run}

`sound.command` 接受以下 Audacity 宏命令名称。这些名称与步骤列表宏可用的名称相同，因此程序和步骤列表具有完全相同的操作范围。每条命令都会执行[命令参考](/reference/generated/commands/)中所述的编辑器操作。

### 带参数的选区命令

| 命令 | 参数 |
| --- | --- |
| `SelectTime` | `start`、`end`（秒）；`relativeTo` 与 `sound.select.time` 相同 |
| `SelectFrequencies` | `low`、`high`（赫兹） |
| `SelectTracks` | `track`、`trackCount`（0 到 100）；`mode` 可为 `'set'`、`'add'` 或 `'remove'` |
| `Select` | 可组合使用上述三组参数 |

省略某项参数会使选区的相应部分保持不变；Audacity 对这些参数的处理方式也是如此。

### 不带参数的命令

| 分组 | 命令 |
| --- | --- |
| 选区 | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| 编辑 | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| 轨道 | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| 标签 | `AddLabel` |
| 分析 | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### 有意不提供的命令

这里不提供 `Undo` 和 `Redo`，因为一次运行本身就是一条历史记录；遍历历史的步骤会越过本次运行，触及你自己的编辑操作。程序也无法使用播放和录音命令，因为它无需等待，而且录音无法回滚。打开、保存、关闭、导入、导出和偏好设置命令同样不可用，因为程序只能访问启动时打开的单个项目。仅打开对话框或更改视图的命令不会更改项目，因此也不提供。

## 分享程序 {#sharing-programs}

**导出程序**会将选中的程序写入 `.soundscapemacro` 文件，**导入程序**会读取该文件。该文件采用 JSON 格式，而非单独的 `.js` 文件，因此接收方的计算机不会误将其当作编辑器之外可运行的脚本：

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

导入时只会保存文本。导入的程序不会显示**运行程序**按钮；窗格会改为显示程序内容、来源文件、关于程序可能对当前项目执行哪些操作的说明，以及一个标有 *我已阅读此程序并希望运行它。* 的复选框。勾选后会启用**启用此程序**，之后程序才能运行。

此授权仅适用于你审阅过的具体文本。如果之后程序发生变化，无论是你编辑了程序还是导入新副本覆盖它，都必须重新审阅并启用新文本。你自己在管理器中编写的程序无需审阅。

## 示例

对第一条包含片段的轨道中的每个片段淡入。运行前请单击该轨道标题，以便效果应用到程序处理的轨道：

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

报告项目信息，但不作更改：

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

仅当选区长度足够时才运行已保存的步骤列表宏：

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## 关于本页

本页中的所有程序，从单行片段到完整示例，都会由浏览器测试套件
(`tests/browser/handbook-macro-program-examples.spec.js`) 在每个 Soundscaper 构建版本上运行。该测试会直接从本页文本中读取程序。如果某个程序无法完成，或无法产生本页所述的结果，则构建会失败，直到修正本页或编辑器。
