---
title: "Chương trình macro"
description: "API JavaScript mà chương trình macro sử dụng, giới hạn hoạt động và tệp dùng để chuyển chương trình."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"vi"} -->

Chương trình macro là macro được viết bằng JavaScript thay vì danh sách các bước.
Nó chạy trong trình biên tập thông qua API nhỏ tên `sound`, cho phép đọc dự án
đang mở, thay đổi vùng chọn và áp dụng các hiệu ứng cùng lệnh mà macro dạng danh
sách bước có thể dùng. Nó không thể truy cập các tài nguyên khác, từ tệp và mạng
đến những dự án khác của bạn.

Chương trình là tính năng của Soundscaper. Framescaper không có trình quản lý macro.

## Nơi lưu chương trình

Chọn **Tools → Macro manager**. Hộp thoại liệt kê macro dạng danh sách bước và, trong mục
**Programs**, các chương trình bạn đã lưu. Nhấn **+ (New program)** ở tiêu đề
Programs để tạo chương trình. Thanh thao tác cũng có **Import program**,
**Export program** và **Delete program** cho chương trình được chọn. Khung chi
tiết hiển thị **Program name**, văn bản **Program** và nút **Run program**.
Văn bản được lưu khi bạn nhập, không cần bước lưu riêng.

Chương trình được lưu cùng cài đặt của trình biên tập, không nằm trong dự án,
nên có thể dùng trong mọi dự án mở bằng trình biên tập này. Dùng **Export
program** và **Import program** để chuyển chương trình sang máy khác hoặc gửi
cho người khác; xem [Chia sẻ chương trình](#sharing-programs) để biết thêm.

The [Apply the same chain of effects every time](/guides/effects/apply-the-same-effects-every-time/)
trình bày phần macro dạng danh sách bước trong cùng hộp thoại.

## Viết chương trình

Chương trình là phần thân của hàm `async`, chạy ở chế độ nghiêm ngặt. Bạn có thể
dùng `await` ở cấp cao nhất, khai báo biến và hàm, cũng như dùng mọi tính năng
thông thường của ngôn ngữ. Đối tượng `sound` là kết nối duy nhất giữa chương
trình và trình biên tập; mỗi lệnh gọi trên đối tượng này trả về một promise.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab chèn hai dấu cách trong trường chương trình. Nhấn Escape rồi Tab để rời khỏi trường.

### Chương trình có thể dùng gì

Có thư viện chuẩn JavaScript thông thường: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, the typed arrays, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` and `queueMicrotask`. `console`
cũng có sẵn; nội dung ghi vào đó sẽ xuất hiện trong nhật ký chương trình.

### Chương trình không thể dùng gì

Chương trình chạy trong worker đã bị loại bỏ các khả năng trước khi dòng đầu
tiên chạy. Những mục sau không tồn tại trong chương trình: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` and `setInterval`. Reading any of them gives `undefined`.

Chương trình không thể `import` mô-đun; `import` tĩnh gây lỗi cú pháp tại dòng
chứa nó. Mọi thứ chương trình cần đều phải nằm trong chính chương trình.

Ranh giới bảo mật không nằm ở các biến toàn cục bị thiếu mà ở chính trình biên
tập: nó chỉ đáp ứng các lệnh gọi liệt kê trên trang này và từ chối mọi thứ khác
theo tên, dù chương trình có gửi được gì đi nữa.

## Chạy chương trình

Nhấn **Run program**. Toàn bộ lần chạy là một mục trong lịch sử dự án, vì vậy
one **Undo** reverses everything the program did, however many changes it made.
Nếu chương trình phát sinh lỗi, bị hủy hoặc quá thời hạn, dự án sẽ được khôi
phục chính xác về trạng thái trước khi bắt đầu chạy.

**Cancel run** dừng chương trình ngay lập tức. Chương trình chạy quá hai phút
cũng bị dừng như vậy và hiện thông báo *The macro ran for longer than 120 seconds.*

Sau khi chạy, khung hiển thị nhật ký chương trình, tiếp theo là *Program applied.*
when the run completed. A failed run shows *The program failed on line N:* and
the error's message, where the line number is the line of your program that
threw.

### Hiệu ứng tác động đến âm thanh nào

Hiệu ứng do chương trình áp dụng tác động lên vùng chọn thời gian hiện tại của
focused track, which is the track whose header you last clicked or whose clip
you last selected. When there is no time selection but a clip is selected, the
effect covers that clip. A program's selection calls change the time range and
the set of selected tracks, but not which track has focus, so one run processes
one track. If nothing is focused or the selection is empty, the run fails with
thông báo giống như trong menu Effect.

## API `sound`

Mỗi phương thức bên dưới trả về promise trừ khi có ghi chú khác. Hãy chờ mỗi
lệnh gọi trước khi thực hiện lệnh tiếp theo; nếu bắt đầu hơn tám lệnh mà chưa
chờ, lệnh thứ chín sẽ bị từ chối.

### `sound.env`

Đối tượng thông thường mô tả lần chạy.

| Field | Meaning |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | The editor's interface language, such as `"en"` or `"de"`. |
| `seed` | The seed the run's random numbers come from. New for every run. |
| `startedAt` | The wall-clock time the run began, as an ISO 8601 string. |
| `dryRun` | Always `false` at present. Reserved. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` and `sound.log.debug(...values)` write one line
each to the run's log. `console.log`, `console.info`, `console.warn`,
`console.error` and `console.debug` do the same. Values that are not strings are
written as JSON. These methods return nothing and do not need to be awaited.

Nhật ký chứa tối đa 1.000 dòng hoặc 256 KiB, tùy giới hạn nào đến trước; mỗi
dòng bị cắt ở 4.096 ký tự. Các dòng vượt giới hạn bị loại bỏ và đếm lại; số
lượng được báo trong cảnh báo cuối.

### `sound.project`

Đọc dự án không làm thay đổi dự án và không tính vào ngân sách thay đổi của lần chạy.

`sound.project.snapshot()` trả về `{ sampleRate, tracks, selection }`, trong đó
`tracks` và `selection` có cùng dạng với kết quả của hai lệnh gọi bên dưới.
`sampleRate` là tần số lấy mẫu của dự án tính bằng hertz, đơn vị dùng cho mọi số
khung hình trên trang này.

`sound.project.tracks()` trả về mảng các track theo thứ tự trên dòng thời gian:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` trả về clip trên một track hoặc trên tất cả track
nếu bỏ `trackId`:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` trả về vùng chọn hiện tại:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Mỗi lệnh gọi chọn vùng tính là một thay đổi và trả về vùng chọn được tạo ra,
theo dạng mà `sound.project.selection()` trả về.

`sound.select.time(start, end, options)` đặt khoảng thời gian theo giây. Đây là
lệnh `SelectTime` của Audacity; `options.relativeTo` chọn mốc đo cho mỗi cạnh.
Cả hai cạnh có thể xuống tới -100 giây.

| `relativeTo` | Start edge | End edge |
| --- | --- | --- |
| `'project-start'` (default) | `start` seconds from the project start | `end` seconds from the project start |
| `'project'` | `start` seconds from the project start | `end` seconds past the project end |
| `'project-end'` | `start` seconds before the project end | `end` seconds before the project end |
| `'selection-start'` | `start` seconds after the selection start | `end` seconds after the selection start |
| `'selection'` | `start` seconds after the selection start | `end` seconds after the selection end |
| `'selection-end'` | `start` seconds before the selection end | `end` seconds before the selection end |

Cuối dự án là khung hình cuối cùng mà bất kỳ clip nào chạm tới. Các track được
chọn vẫn giữ nguyên.

`sound.select.frames(startFrame, endFrame, options)` đặt khoảng thời gian theo
khung hình ở tần số lấy mẫu của dự án. `options.trackIds` chỉ định các track
cần chọn; nếu bỏ qua, các track đang chọn vẫn được giữ. Khoảng này được giới
hạn trên dòng thời gian và hai cạnh sẽ đổi chỗ nếu nhập ngược.

`sound.select.tracks(options)` là lệnh `SelectTracks` của Audacity. Lệnh chọn
the tracks whose index (counted from 0) is in the range from `options.track`
(default 0) spanning `options.trackCount` tracks (default 1). `options.mode` is
`'set'` để thay vùng chọn track, `'add'` để mở rộng, hoặc `'remove'` để bỏ các
track đó khỏi vùng chọn. Khoảng thời gian được giữ nguyên.

`sound.select.frequencies(options)` là lệnh `SelectFrequencies` của Audacity.
Lệnh đặt vùng chọn phổ theo `options.low` và `options.high` tính bằng hertz;
cạnh bị bỏ qua sẽ giữ giá trị hiện tại.

`sound.select.all()` chọn toàn bộ dự án trên mọi track.
`sound.select.none()` xóa vùng chọn.

### `sound.effect(type, params)`

Áp dụng một hiệu ứng cho vùng chọn hiện tại trên track được lấy nét. `type` là
ID hiệu ứng trong [Danh sách hiệu ứng chương trình có thể áp dụng](#effects-a-program-can-apply),
còn `params` là đối tượng chứa tham số của hiệu ứng. Tham số bị bỏ qua dùng giá
trị mặc định; giá trị được kiểm tra theo phạm vi trong [tham chiếu hiệu ứng âm thanh](/reference/generated/audio-effects/).
Trả về `null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Áp dụng chuỗi hiệu ứng cho vùng chọn hiện tại trong một lượt, giống hệt macro
danh sách bước có cùng các bước đó. Mỗi bước có dạng `{ type, params }` và chuỗi
cần ít nhất một bước. Trả về `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Chạy một trong các lệnh macro Audacity được liệt kê tại
[Lệnh chương trình có thể chạy](#commands-a-program-can-run). Bốn lệnh chọn
vùng nhận các tham số mô tả ở đó; các lệnh khác không nhận tham số. Trả về
vùng chọn sau khi chạy.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Chạy macro dạng danh sách bước được lưu trong cùng trình quản lý macro, theo
đúng tên của macro, gồm cả mọi lệnh chọn vùng trong đó. Macro đã lưu không thể
là chương trình, vì vậy các chương trình không lồng nhau. Trả về `null`; tên
không tồn tại sẽ khiến promise bị từ chối.

### Thời gian và số ngẫu nhiên

Lần chạy có thể tái lập: hai lần chạy cùng chương trình trên cùng dự án cho kết
quả như nhau vì đồng hồ và số ngẫu nhiên không dựa vào thời gian thực của máy.

`Date.now()` và `new Date()` không có tham số trả về đồng hồ ảo bắt đầu từ 0,
tăng một đơn vị sau mỗi lệnh gọi được trình biên tập trả lời và tăng `ms` sau
mỗi `sound.wait(ms)`. `sound.wait` được giải quyết ngay; chương trình không thể
tạm dừng theo thời gian thực, và cũng không cần vì mọi lệnh gọi trình biên tập
đều hoàn tất trước khi promise được giải quyết.

`Math.random()` và `sound.random()` dùng chung bộ tạo số, khởi tạo từ
`sound.env.seed`. Ghi lại seed nếu cần biết lần chạy dùng chuỗi nào.

### Kiểm tra giả định

`sound.assert(condition, message)` ném `message` khi `condition` sai.
`sound.assertEqual(actual, expected, message)` so sánh hai giá trị dưới dạng JSON
và ném lỗi nếu chúng khác nhau; nếu không có thông báo, lỗi sẽ nêu tên cả hai
giá trị. Vì lỗi sẽ dừng lần chạy và hoàn tác mọi thay đổi trước đó, một khẳng
định không đạt sẽ giữ nguyên dự án. Hai phương thức này không trả về promise.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Giá trị trao đổi với trình biên tập

Mọi đối số chương trình truyền vào và mọi giá trị nhận được đều là dữ liệu đơn giản:
`null`, booleans, finite numbers, strings, and arrays and plain objects of
those. `NaN`, `Infinity`, functions, class instances, typed arrays and `Date`
objects are refused with an error, as is any value larger than 1 MiB, nested more
than 12 levels deep, or holding more than 4,096 entries in one array or object.
Các thuộc tính `undefined` bị loại bỏ.

## Giới hạn

| Limit | Value |
| --- | --- |
| Program length | 256 KiB |
| Calls to the editor per run | 4,096 |
| Changes to the project per run (selection calls, effects, commands) | 256 |
| Calls waiting for an answer at once | 8 |
| Run time | 120 seconds |
| One value crossing to or from the editor | 1 MiB, 12 levels deep, 4,096 entries per array or object |
| Log | 1,000 lines or 256 KiB; 4,096 characters per line |
| Programs in the library | 128 |
| Program name | 256 characters |
| Imported program file | 1 MiB |

Vòng lặp chọn từng clip rồi áp dụng một hiệu ứng tiêu tốn hai thay đổi cho mỗi
clip, nên có thể xử lý 128 clip trước khi hết ngân sách.

## Lỗi

Lệnh gọi bị trình biên tập từ chối sẽ khiến promise trả về lỗi `Error`, với
`message` nêu lý do: lệnh không thuộc danh sách, hiệu ứng áp dụng lên vùng chọn
rỗng hoặc tham số nằm ngoài phạm vi. Lỗi cũng có `code`, mặc định là
`MACRO_CALL_FAILED` unless the editor supplied a more specific one. A program
may catch these and carry on:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

That program completes, and its log reads *refused: Unsupported macro command:
ExportWav.*

Lỗi chương trình không bắt được sẽ dừng lần chạy, khôi phục dự án và hiển thị
trong khung cùng số dòng phát sinh. Chương trình không biên dịch được cũng được
báo theo cách tương tự trước khi chạy.

## Hiệu ứng chương trình có thể áp dụng {#effects-a-program-can-apply}

Đây là các ID hiệu ứng mà `sound.effect` và `sound.effects` chấp nhận, cùng với
khóa tham số và giá trị mặc định của từng hiệu ứng. Phạm vi và đơn vị có trong
[tham chiếu hiệu ứng âm thanh](/reference/generated/audio-effects/). Chương trình
không thể áp dụng plugin Nyquist.

| Effect | Effect ID | Parameters and defaults |
| --- | --- | --- |
| Amplify | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Auto Duck | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Bass and Treble | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Change Pitch | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Change Speed and Pitch | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Change Tempo | `audacity-change-tempo` | `tempoPercent: 0` |
| Classic Filters | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Click Removal | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compressor | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Delay | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distortion | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Echo | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Fade In | `audacity-fade-in` | none |
| Fade Out | `audacity-fade-out` | none |
| Filter Curve EQ | `audacity-filter-curve-eq` | `points`: an array of `{ frequency, gain }`, default two flat points at 20 Hz and 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| Four-band parametric EQ | `eq` | `outputGain: 0`; `bands`: four `{ id, enabled, type, frequency, gain, q, slope }` objects, peaking at 100, 500, 2000 and 8000 Hz with `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Graphic EQ | `audacity-graphic-eq` | `gains`: 31 band gains in dB, all 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| High-pass filter | `highpass` | `frequency: 80`, `q: 0.707` |
| Invert | `audacity-invert` | none |
| Legacy Compressor | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiter | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Loudness Normalization | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Low-pass filter | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Noise Reduction | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalize | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Remove DC Offset | `audacity-remove-dc-offset` | none |
| Repair | `audacity-repair` | none |
| Repeat | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverse | `audacity-reverse` | none |
| Sliding Stretch | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Two effects need something a program cannot supply. Noise Reduction needs a
noise profile captured in the effect's own dialog, and Auto Duck needs a control
track below the focused one.

## Lệnh chương trình có thể chạy {#commands-a-program-can-run}

`sound.command` chấp nhận tên lệnh macro Audacity bên dưới. Đây là cùng tên mà
macro dạng danh sách bước có thể chứa, nên chương trình và danh sách bước có
cùng khả năng. Mỗi lệnh chạy thao tác được mô tả trong
[tham chiếu lệnh](/reference/generated/commands/).

### Lệnh chọn vùng có tham số

| Command | Parameters |
| --- | --- |
| `SelectTime` | `start`, `end` in seconds; `relativeTo` as for `sound.select.time` |
| `SelectFrequencies` | `low`, `high` in hertz |
| `SelectTracks` | `track`, `trackCount` (0 to 100); `mode` of `'set'`, `'add'` or `'remove'` |
| `Select` | Any combination of the three sets above |

Tham số bị bỏ qua sẽ giữ nguyên phần tương ứng của vùng chọn, giống cách
Audacity xử lý.

### Lệnh không có tham số

| Group | Commands |
| --- | --- |
| Chọn vùng | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Chỉnh sửa | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Track | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Nhãn | `AddLabel` |
| Phân tích | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Các mục cố ý không có

`Undo` và `Redo` không có vì một lần chạy đã là một mục lịch sử; lệnh duyệt lịch
sử có thể đi ngược khỏi lần chạy và chạm đến các chỉnh sửa riêng của bạn.
Các lệnh điều khiển phát và ghi âm không có vì chương trình không cần chờ và
không thể hoàn tác một bản ghi. Mở, lưu, đóng, nhập, xuất và tùy chọn cũng không
có vì chương trình chỉ truy cập dự án đang mở khi nó bắt đầu. Các lệnh chỉ mở
hộp thoại hoặc đổi chế độ xem bị loại bỏ vì chúng không thay đổi dự án.

## Chia sẻ chương trình {#sharing-programs}

**Export program** ghi chương trình được chọn thành tệp `.soundscapemacro`, còn
**Import program** đọc tệp đó. Tệp dùng định dạng JSON thay vì tệp `.js` thuần,
để máy nhận không nhầm đó là thứ có thể chạy bên ngoài trình biên tập:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Nhập chương trình chỉ lưu văn bản, không làm gì khác. Chương trình nhập vào
không có nút **Run program**; thay vào đó, khung hiển thị chương trình, tệp gốc,
ghi chú về những gì chương trình có thể làm với dự án đang mở và hộp kiểm *I
have read this program and want to run it.* Đánh dấu hộp kiểm sẽ bật **Enable
this program**; chỉ sau đó chương trình mới có thể chạy.

Quyền này áp dụng cho đúng văn bản bạn đã đọc. Nếu chương trình thay đổi sau
đó — do bạn chỉnh sửa hoặc nhập bản mới đè lên — phần xem xét sẽ xuất hiện lại
cho đến khi bạn bật văn bản mới. Chương trình tự viết trong trình quản lý không
cần xem xét.

## Ví dụ

Tạo fade-in cho mọi clip trên track đầu tiên có clip. Nhấp vào tiêu đề track đó
trước khi chạy để hiệu ứng tác động đúng track mà chương trình đang đọc:

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

Báo cáo thông tin dự án mà không thay đổi dự án:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Chỉ chạy macro danh sách bước đã lưu khi vùng chọn đủ dài:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Về trang này

Mọi chương trình trên trang này, từ đoạn mã một dòng đến ví dụ hoàn chỉnh, đều
được chạy trên mỗi bản dựng Soundscaper bằng bộ kiểm thử trình duyệt
(`tests/browser/handbook-macro-program-examples.spec.js`), bộ kiểm thử đọc
chương trình trực tiếp từ nội dung trang. Nếu chương trình không chạy xong hoặc
không còn tạo ra kết quả được mô tả ở đây, bản dựng sẽ thất bại cho đến khi sửa
trang hoặc trình biên tập.
