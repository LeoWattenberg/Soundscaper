---
title: "매크로 프로그램"
description: "매크로 프로그램이 실행할 수 있는 JavaScript API, 적용되는 제한 및 주고받는 파일 형식."
sidebar:
  order: 7
---

<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"ko"} -->

매크로 프로그램은 단계 목록이 아니라 JavaScript로 작성한 매크로입니다.
편집기 안에서 `sound`라는 작은 API를 통해 실행되며, 열린 프로젝트를 읽고
선택 영역을 이동하고 단계 목록 매크로와 동일한 효과와 명령을 적용할 수
있습니다. 파일과 네트워크부터 다른 프로젝트까지 그 밖의 모든 대상에는
접근할 수 없습니다.

프로그램은 Soundscaper의 기능입니다. Framescaper에는 매크로 관리자가 없습니다.

## 프로그램 저장 위치

**도구 → 매크로 관리자**를 선택합니다. 대화 상자에는 단계 목록 매크로와
**프로그램** 아래에 저장한 프로그램이 표시됩니다. 프로그램 헤더에서
**+ (새 프로그램)**을 눌러 새 프로그램을 만듭니다. 같은 작업 표시줄에서
선택한 프로그램에 대해 **프로그램 가져오기**, **프로그램 내보내기** 및
**프로그램 삭제**를 사용할 수 있습니다. 세부 정보 창에는 **프로그램 이름**,
**프로그램** 텍스트 및 **프로그램 실행** 버튼이 표시됩니다. 텍스트는 입력하는
즉시 저장되므로 별도의 저장 단계가 없습니다.

프로그램은 프로젝트 안이 아니라 편집기의 설정과 함께 저장되므로 이 편집기에서
여는 모든 프로젝트에서 사용할 수 있습니다. **프로그램 내보내기**와
**프로그램 가져오기**를 사용하면 다른 컴퓨터나 다른 사람에게 프로그램을
전달할 수 있습니다. 자세한 내용은 [프로그램 공유](#sharing-programs)를
참조하세요.

[매번 같은 효과 체인 적용](/guides/effects/apply-the-same-effects-every-time/)
가이드에서는 같은 대화 상자의 단계 목록 부분을 다룹니다.

## 프로그램 작성

프로그램은 엄격 모드로 실행되는 `async` 함수의 본문입니다. 따라서 최상위
수준에서 `await`를 사용할 수 있고 변수와 함수를 선언할 수 있으며 일반적인
언어 기능을 모두 사용할 수 있습니다. `sound` 객체는 프로그램이 편집기에
연결되는 유일한 통로이고, 이 객체의 모든 호출은 프로미스를 반환합니다.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

프로그램 필드에서 Tab을 누르면 공백 두 개가 입력됩니다. 필드를 빠져나가려면
Escape를 누른 다음 Tab을 누릅니다.

### 프로그램에서 사용할 수 있는 것

일반적인 JavaScript 표준 라이브러리를 사용할 수 있습니다: `Object`, `Array`,
`Map`, `Set`, `Math`, `JSON`, `RegExp`, `Promise`, 형식화된 배열, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` 및 `queueMicrotask`입니다. `console`도
사용할 수 있으며 여기에 기록하는 모든 내용은 프로그램 로그에 들어갑니다.

### 프로그램에서 사용할 수 없는 것

프로그램은 첫 줄이 실행되기 전에 기능이 제거된 워커에서 실행됩니다. 다음 항목은
프로그램 안에 존재하지 않습니다: `fetch`, `XMLHttpRequest`, `WebSocket`,
`indexedDB`, `caches`, `crypto`, `navigator`, `location`, `Worker`, `WebAssembly`,
`SharedArrayBuffer`, `Atomics`, `eval`, `setTimeout` 및 `setInterval`. 이 항목을
읽으면 `undefined`가 반환됩니다.

프로그램에서는 모듈을 `import`할 수 없습니다. 정적 `import`는 포함된 줄에서
구문 오류가 됩니다. 프로그램에 필요한 것은 모두 프로그램 안에 있어야 합니다.

보안 경계는 없는 전역 객체가 아니라 편집기 자체입니다. 편집기는 이 페이지에
나열된 호출에만 응답하고 그 밖의 모든 것은 이름으로 거부합니다. 프로그램이
무엇을 보내더라도 마찬가지입니다.

## 프로그램 실행

**프로그램 실행**을 누릅니다. 전체 실행은 프로젝트 기록의 하나의 항목이므로
프로그램이 몇 번 변경했든 **실행 취소** 한 번으로 프로그램이 한 모든 작업을
되돌릴 수 있습니다. 프로그램에서 예외가 발생하거나 취소되거나 기한을 넘기면
실행을 시작하기 전 상태로 프로젝트가 정확히 돌아갑니다.

**실행 중단**은 프로그램을 즉시 중지합니다. 2분 동안 실행된 프로그램도 같은
방식으로 중지되며, *매크로가 120초보다 오래 실행되었습니다.*라는 메시지가
표시됩니다.

실행이 끝나면 창에 프로그램 로그가 표시되고, 실행이 완료된 경우
*프로그램이 적용되었습니다.*가 이어서 표시됩니다. 실패한 실행에는
*프로그램이 N번째 줄에서 실패했습니다:*와 오류 메시지가 표시되며, 여기서
줄 번호는 예외를 발생시킨 프로그램의 줄입니다.

### 효과가 처리하는 오디오

프로그램이 적용한 효과는 포커스 트랙의 현재 시간 선택 영역에 실행됩니다.
포커스 트랙은 마지막으로 헤더를 클릭했거나 클립을 선택한 트랙입니다. 시간
선택 영역은 없고 클립이 선택된 경우에는 효과가 해당 클립을 대상으로 합니다.
프로그램의 선택 호출은 시간 범위와 선택한 트랙 집합을 변경하지만 포커스가
있는 트랙은 변경하지 않으므로 한 번의 실행은 하나의 트랙을 처리합니다.
포커스가 없거나 선택 영역이 비어 있으면 효과 메뉴와 같은 메시지로 실행이
실패합니다.

## `sound` API

아래의 모든 메서드는 달리 표시되지 않는 한 프로미스를 반환합니다. 다음 호출을
하기 전에 각 호출을 await해야 합니다. await 없이 8번보다 많이 호출을 시작한
프로그램에서는 9번째 호출이 거부됩니다.

### `sound.env`

실행을 설명하는 일반 객체입니다.

| 필드 | 의미 |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | 편집기 인터페이스 언어입니다. 예: `"en"` 또는 `"de"`. |
| `seed` | 실행의 난수가 생성되는 시드입니다. 실행마다 새로 생성됩니다. |
| `startedAt` | 실행이 시작된 벽시계 시간으로, ISO 8601 문자열입니다. |
| `dryRun` | 현재는 항상 `false`입니다. 예약된 필드입니다. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` 및 `sound.log.debug(...values)`는 각각 실행 로그에
한 줄을 기록합니다. `console.log`, `console.info`, `console.warn`,
`console.error` 및 `console.debug`도 같은 방식으로 동작합니다. 문자열이 아닌
값은 JSON으로 기록됩니다. 이 메서드들은 아무것도 반환하지 않으므로 await할
필요가 없습니다.

로그에는 최대 1,000줄 또는 256 KiB까지 저장되며, 둘 중 먼저 도달한 한도가
적용됩니다. 각 줄은 4,096자에서 잘립니다. 그 이후의 줄은 삭제되고 개수가
집계되며, 그 개수는 최종 경고로 보고됩니다.

### `sound.project`

프로젝트를 읽는 작업은 프로젝트를 변경하지 않으며 실행의 변경 예산에도
포함되지 않습니다.

`sound.project.snapshot()`은 `{ sampleRate, tracks, selection }`을 반환합니다.
여기서 `tracks`와 `selection`은 아래의 두 호출이 반환하는 값입니다. `sampleRate`는
프로젝트의 샘플 레이트(헤르츠)이며, 이 페이지의 모든 프레임 수는 이 값을
기준으로 측정됩니다.

`sound.project.tracks()`는 타임라인 순서대로 트랙 배열을 반환합니다.

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)`는 한 트랙의 클립을 반환합니다. `trackId`를
생략하면 모든 트랙의 클립을 반환합니다.

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()`은 현재 선택 영역을 반환합니다.

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

각 선택 호출은 하나의 변경으로 계산되며, `sound.project.selection()`이 반환하는
형태의 선택 영역을 반환합니다.

`sound.select.time(start, end, options)`은 시간 범위를 초 단위로 설정합니다.
이는 Audacity의 `SelectTime` 명령이며, `options.relativeTo`는 각 경계를 어디를
기준으로 측정할지 선택합니다. 두 경계 모두 -100초까지 낮출 수 있습니다.

| `relativeTo` | 시작 경계 | 끝 경계 |
| --- | --- | --- |
| `'project-start'` (기본값) | 프로젝트 시작에서 `start`초 후 | 프로젝트 시작에서 `end`초 후 |
| `'project'` | 프로젝트 시작에서 `start`초 후 | 프로젝트 끝을 지난 뒤 `end`초 |
| `'project-end'` | 프로젝트 끝에서 `start`초 전 | 프로젝트 끝에서 `end`초 전 |
| `'selection-start'` | 선택 영역 시작에서 `start`초 후 | 선택 영역 시작에서 `end`초 후 |
| `'selection'` | 선택 영역 시작에서 `start`초 후 | 선택 영역 끝에서 `end`초 후 |
| `'selection-end'` | 선택 영역 끝에서 `start`초 전 | 선택 영역 끝에서 `end`초 전 |

프로젝트 끝은 어떤 클립이든 도달하는 마지막 프레임입니다. 선택한 트랙은
기존 상태로 유지됩니다.

`sound.select.frames(startFrame, endFrame, options)`은 프로젝트 샘플 레이트에서
프레임 단위로 시간 범위를 설정합니다. `options.trackIds`는 선택할 트랙을
지정하며, 생략하면 이미 선택된 트랙이 계속 선택된 상태로 유지됩니다.
범위는 타임라인에 맞게 제한되고, 순서가 뒤집혀 있으면 두 경계가 교환됩니다.

`sound.select.tracks(options)`는 Audacity의 `SelectTracks` 명령입니다. 인덱스
(0부터 계산)가 `options.track`(기본값 0)부터 시작해
`options.trackCount`(기본값 1)개 트랙 범위에 포함되는 트랙을 선택합니다.
`options.mode`가 `'set'`이면 트랙 선택을 대체하고, `'add'`이면 선택을 넓히며,
`'remove'`이면 해당 트랙을 선택에서 제외합니다. 시간 범위는 기존 상태로
유지됩니다.

`sound.select.frequencies(options)`는 Audacity의 `SelectFrequencies` 명령입니다.
스펙트럼 선택 영역을 헤르츠 단위의 `options.low` 및 `options.high`로 설정하며,
생략한 경계는 현재 값을 유지합니다.

`sound.select.all()`은 모든 트랙에서 프로젝트 전체를 선택합니다.
`sound.select.none()`은 선택 영역을 지웁니다.

### `sound.effect(type, params)`

현재 선택 영역에 포커스 트랙을 대상으로 하나의 효과를 적용합니다. `type`은
[프로그램에서 적용할 수 있는 효과](#effects-a-program-can-apply)에 있는 효과 ID이고,
`params`는 해당 효과의 매개변수 객체입니다. 생략한 매개변수에는 효과의 기본값이
사용되며, 값은 [오디오 효과 참조](/reference/generated/audio-effects/)에 있는
범위에 맞는지 확인됩니다. 반환값은 `null`입니다.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

현재 선택 영역에 효과 체인을 한 번에 적용합니다. 지정한 단계가 있는 단계 목록
매크로와 정확히 같은 방식으로 실행됩니다. 각 단계는 `{ type, params }`이고,
체인에는 하나 이상의 단계가 필요합니다. 반환값은 `null`입니다.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

[프로그램에서 실행할 수 있는 명령](#commands-a-program-can-run)에 나열된
Audacity 매크로 명령 중 하나를 실행합니다. 네 가지 선택 명령은 해당 절에
설명된 매개변수를 사용하고 나머지는 매개변수를 사용하지 않습니다. 실행 후
선택 영역을 반환합니다.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

같은 매크로 관리자에 저장된 단계 목록 매크로를 이름 그대로 실행하며, 매크로에
포함된 선택 명령도 실행합니다. 저장된 매크로 자체는 프로그램일 수 없으므로
프로그램을 중첩할 수 없습니다. 반환값은 `null`이며, 알 수 없는 이름이면
거부됩니다.

### 시간과 무작위성

실행은 재현 가능합니다. 같은 프로젝트에서 같은 프로그램을 두 번 실행하면
동일한 내용을 읽습니다. 시계와 난수가 컴퓨터의 실제 값이 아니기 때문입니다.

인수 없이 호출한 `Date.now()`와 `new Date()`는 가상 시계를 반환합니다. 이 시계는
0에서 시작해 편집기에 대한 응답이 있을 때마다 1씩 증가합니다. `ms`만큼
증가시키는 호출은 `sound.wait(ms)`이며, `sound.wait`는 즉시 반환됩니다.
프로그램이 실제 시간 동안 일시 정지할 방법은 없으며 그럴 필요도 없습니다.
편집기에 대한 모든 호출은 프로미스가 반환되기 전에 완료되기 때문입니다.

`Math.random()`과 `sound.random()`은 같은 생성기를 사용하며,
`sound.env.seed`에서 시드가 정해집니다. 실행에서 어떤 수열을 사용했는지 알아야
한다면 시드를 로그에 기록하세요.

### 가정 확인

`sound.assert(condition, message)`는 `message`를 사용해 `condition`이 거짓일 때
오류를 발생시킵니다. `sound.assertEqual(actual, expected, message)`는 두 값을 JSON으로
비교하고 서로 다르면 오류를 발생시킵니다. 메시지를 지정하면 두 값을
이름으로 표시합니다. 오류가 발생하면 실행이 종료되고 그 전에 수행한 모든
변경 사항이 롤백되므로, 실패한 assertion은 프로젝트를 변경하지 않습니다.
두 메서드 모두 프로미스를 반환하지 않습니다.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## 편집기로 전달되는 값

프로그램이 전달하는 모든 인수와 받는 모든 값은 일반 데이터입니다:
`null`, 불리언, 유한한 숫자, 문자열, 그리고 이러한 값으로 이루어진 배열과
일반 객체입니다. `NaN`, `Infinity`, 함수, 클래스 인스턴스, 형식화된 배열 및
`Date` 객체는 오류와 함께 거부됩니다. 1 MiB보다 크거나, 12단계보다 깊게
중첩되었거나, 하나의 배열 또는 객체에 4,096개보다 많은 항목을 가진 값도
거부됩니다. `undefined` 속성은 삭제됩니다.

## 제한

| 제한 | 값 |
| --- | --- |
| 프로그램 길이 | 256 KiB |
| 실행당 편집기 호출 수 | 4,096 |
| 실행당 프로젝트 변경 수(선택 호출, 효과, 명령) | 256 |
| 한 번에 응답을 기다릴 수 있는 호출 수 | 8 |
| 실행 시간 | 120초 |
| 편집기와 주고받는 단일 값 | 1 MiB, 깊이 12단계, 배열 또는 객체당 4,096개 항목 |
| 로그 | 줄 1,000개 또는 256 KiB, 줄당 4,096자 |
| 라이브러리의 프로그램 수 | 128 |
| 프로그램 이름 | 256자 |
| 가져온 프로그램 파일 | 1 MiB |

각 클립을 선택하고 효과 하나를 적용하는 루프는 클립당 두 번의 변경을
사용하므로, 예산이 소진되기 전에 128개 클립을 처리할 수 있습니다.

## 오류

편집기가 거부하는 호출은 `Error`로 프로미스를 거부하며, 그 `message`가
이유를 설명합니다. 이유로는 어휘에 없는 명령, 빈 선택 영역에 효과 적용,
범위를 벗어난 매개변수 등이 있습니다. 오류에는 `code`도 포함되며, 편집기가
더 구체적인 코드를 제공하지 않는 한 `MACRO_CALL_FAILED`입니다. 프로그램에서
이 오류를 잡아 계속 실행할 수 있습니다.

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

이 프로그램은 완료되며 로그에는 *거부됨: 지원되지 않는 매크로 명령:
ExportWav.*가 기록됩니다.

프로그램이 잡지 않은 오류가 발생하면 실행이 종료되고 프로젝트가 롤백되며,
오류가 발생한 줄과 함께 창에 표시됩니다. 컴파일되지 않는 프로그램도 실행이
시작되기 전에 같은 방식으로 보고됩니다.

## 프로그램에서 적용할 수 있는 효과 {#effects-a-program-can-apply}

다음은 `sound.effect`와 `sound.effects`가 허용하는 효과 ID와 각 효과가 받는
매개변수 키 및 기본값입니다. 범위와 단위는 [오디오 효과 참조](/reference/generated/audio-effects/)
에 있습니다. Nyquist 플러그인은 프로그램에서 적용할 수 없습니다.

| 효과 | 효과 ID | 매개변수 및 기본값 |
| --- | --- | --- |
| 증폭 | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| 자동 덕킹 | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| 저음 및 고음 | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| 비트크러셔 | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| 피치 변경 | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| 속도 및 피치 변경 | `audacity-change-speed-pitch` | `speedPercent: 0` |
| 템포 변경 | `audacity-change-tempo` | `tempoPercent: 0` |
| 클래식 필터 | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| 클릭 제거 | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| 컴프레서 | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| 딜레이 | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| 왜곡 | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| 에코 | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| 페이드 인 | `audacity-fade-in` | 없음 |
| 페이드 아웃 | `audacity-fade-out` | 없음 |
| 필터 곡선 EQ | `audacity-filter-curve-eq` | `points`: `{ frequency, gain }` 배열이며, 20 Hz와 20 kHz에 있는 두 개의 평탄한 점이 기본값; `linearFrequencyScale: false`; `filterLength: 8191` |
| 4밴드 파라메트릭 EQ | `eq` | `outputGain: 0`; `bands`: `{ id, enabled, type, frequency, gain, q, slope }` 객체 네 개이며, 100, 500, 2000 및 8000 Hz에서 피킹하고 `gain: 0`, `q: 1`, `slope: 12`를 사용함 |
| 게이트 | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| 그래픽 EQ | `audacity-graphic-eq` | `gains`: dB 단위의 31개 밴드 게인으로 모두 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| 하이패스 필터 | `highpass` | `frequency: 80`, `q: 0.707` |
| 반전 | `audacity-invert` | 없음 |
| 레거시 컴프레서 | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| 리미터 | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| 음량 정규화 | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| 로우패스 필터 | `lowpass` | `frequency: 18000`, `q: 0.707` |
| 노이즈 감소 | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| 정규화 | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| 페이저 | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| DC 오프셋 제거 | `audacity-remove-dc-offset` | 없음 |
| 복구 | `audacity-repair` | 없음 |
| 반복 | `audacity-repeat` | `count: 1` |
| 리버브 | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| 리버브 (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| 역방향 | `audacity-reverse` | 없음 |
| 슬라이딩 스트레치 | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| 무음 잘라내기 | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| 유틸리티 게인 (검토됨) | `reviewed-utility-gain` | `gain: 1` |
| 와우와 | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

두 효과에는 프로그램이 제공할 수 없는 항목이 필요합니다. 노이즈 감소에는
효과 자체의 대화 상자에서 캡처한 노이즈 프로필이 필요하고, 자동 덕킹에는
포커스 트랙 아래에 제어 트랙이 필요합니다.

## 프로그램에서 실행할 수 있는 명령 {#commands-a-program-can-run}

`sound.command`는 아래의 Audacity 매크로 명령 이름을 받습니다. 이 이름은 단계
목록 매크로에 저장할 수 있는 이름과 같으므로 프로그램과 단계 목록은 정확히
같은 범위의 작업을 수행할 수 있습니다. 각 명령은 [명령 참조](/reference/generated/commands/)
에 설명된 편집기 동작을 실행합니다.

### 매개변수가 있는 선택 명령

| 명령 | 매개변수 |
| --- | --- |
| `SelectTime` | 초 단위의 `start`, `end`; `relativeTo`는 `sound.select.time`과 같은 방식 |
| `SelectFrequencies` | 헤르츠 단위의 `low`, `high` |
| `SelectTracks` | `track`, `trackCount`(0~100); `mode`는 `'set'`, `'add'` 또는 `'remove'` 중 하나 |
| `Select` | 위 세 종류의 집합을 임의로 조합 |

생략한 매개변수에 해당하는 선택 부분은 그대로 유지되며, Audacity도 같은
방식으로 매개변수를 해석합니다.

### 매개변수가 없는 명령

| 그룹 | 명령 |
| --- | --- |
| 선택 | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| 편집 | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| 트랙 | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| 레이블 | `AddLabel` |
| 분석 | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### 의도적으로 빠진 항목

`Undo`와 `Redo`가 없는 이유는 한 번의 실행 자체가 이미 하나의 기록 항목이며,
기록을 이동하는 단계가 있으면 실행을 넘어 사용자가 직접 한 편집까지 거슬러
올라가게 되기 때문입니다. 프로그램은 기다릴 수 없고 녹음에서 빠져나오는
롤백도 할 수 없으므로 재생 제어 및 녹음 명령도 없습니다. 프로그램의 작업
범위는 시작할 때 열려 있던 하나의 프로젝트뿐이므로 열기, 저장, 닫기, 가져오기,
내보내기 및 환경 설정도 없습니다. 대화 상자만 열거나 보기를 바꾸는 명령은
프로젝트를 변경하지 않으므로 없습니다.

## 프로그램 공유 {#sharing-programs}

**프로그램 내보내기**는 선택한 프로그램을 `.soundscapemacro` 파일로 기록하고,
**프로그램 가져오기**는 그 파일을 읽습니다. 이 파일은 단순한 `.js` 파일이
아니라 JSON이므로, 받는 컴퓨터에서 편집기 밖에서 실행할 파일로 오인할 수
없습니다.

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

가져오기는 텍스트만 저장합니다. 가져온 프로그램에는 **프로그램 실행** 버튼이
없고, 그 자리에 프로그램, 프로그램의 원본 파일, 프로그램이 열린 프로젝트에
할 수 있는 작업에 대한 설명 및 *이 프로그램을 읽었으며 실행하겠습니다.*라는
확인란이 표시됩니다. 이 확인란을 선택하면 **이 프로그램 실행 활성화**가
활성화되고, 그때만 프로그램을 실행할 수 있습니다.

이 권한은 사용자가 읽은 정확한 텍스트에만 적용됩니다. 이후 프로그램을 직접
편집하거나 더 최신 사본을 가져와 프로그램이 변경되면, 새 텍스트를 활성화할
때까지 검토 화면이 다시 표시됩니다. 관리자에서 직접 작성한 프로그램에는
검토가 필요하지 않습니다.

## 예제

클립이 하나라도 있는 첫 번째 트랙의 모든 클립에 페이드 인을 적용합니다. 실행하기 전에
해당 트랙의 헤더를 클릭해야 효과가 프로그램이 읽고 있는 트랙에 적용됩니다.

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

프로젝트를 변경하지 않고 보고합니다.

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

선택 영역이 충분히 길 때만 저장된 단계 목록 매크로를 실행합니다.

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## 이 페이지 정보

한 줄짜리 코드 조각부터 완성된 예제까지 이 페이지의 모든 프로그램은 브라우저
테스트 모음(`tests/browser/handbook-macro-program-examples.spec.js`)이 이 페이지
자체의 텍스트에서 프로그램을 읽어 Soundscaper의 각 빌드에서 실행합니다. 어떤
프로그램이 더 이상 완료되지 않거나 이 페이지에 설명된 결과를 내지 못하면,
페이지나 편집기를 수정할 때까지 빌드가 실패합니다.
