---
title: "음성 녹음 정리"
description: "배경 소음을 제거하고, 웅웅거리는 소리를 자르고, 팟캐스트 수준의 음량으로 조정하여 MP3로 내보냅니다."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"ko"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

집에서 녹음한 대부분의 오디오는 세 가지 수정이 필요합니다: 제거해야 할 지속적인 배경 소음, 필터링해야 할 저주파 잡음, 그리고 표준 수준으로 올려야 하는 볼륨. 이 튜토리얼은 3초 예제 클립에 이 세 가지 수정을 모두 적용하고, 첫 0.5초는 방의 소음만 포함하도록 한 후 결과를 MP3로 내보냅니다.

:::tip[필요한 것]
- [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) 다운로드 — 목소리가 시작되기 전 첫 0.5초는 방의 소음만 포함하는 짧은 클립.

아래의 모든 단계는 이 파일 그대로 적용되며, 따라서 튜토리얼과 일치해야 합니다. Soundscaper는 브라우저에서 실행되므로 설치할 필요가 없습니다.
:::

## 배우게 될 내용

- 노이즈 감소가 왜 프로필을 필요로 하는지, 그리고 어떻게 프로필을 생성하는지.
- 하이패스 필터가 무엇을 제거하는지, 그리고 음성용 최적의 설정 위치.
- 피크 레벨과 청각의 차이, 그리고 청각 목표를 맞추는 방법.
- MP3 내보내기 방법.

## 단계

1. Soundscaper 열기. 편집기가 로드되면 새로운 빈 프로젝트가 열립니다.
2. **파일 → 오디오 가져오기**를 선택하고 목소리가 시작되기 전 첫 0.5초는 방의 소음만 포함하는 짧은 클립인 `guide-noisy-take.wav`를 선택합니다. 파일은 자체 트랙에 클립으로 추가됩니다.
3. **재생**을 눌러 청취한 후 **정지**합니다.
   *보여야 할 것:* 0.5초의 잡음, 그 후 일정 음량의 톤(목소리를 대체하는)이 잡음과 함께 재생됩니다.
4. 클립 위의 눈금자를 드래그하여 시작부터 15% 지점까지 선택합니다. 프로필에는 제거하고자 하는 소음만 포함되어야 하며, 목소리는 전혀 없어야 합니다.
5. **효과 → 노이즈 제거 및 복구 → 노이즈 감소**를 선택하고 **노이즈 프로필 가져오기**를 누릅니다. 상태 줄에 프로필이 준비되었다는 메시지가 표시됩니다. 대화 상자를 닫으려면 **닫기**를 누릅니다.
6. **선택 → 전체 선택**을 선택합니다. 프로필은 유지되며, 이제 효과가 청소할 대상을 알아야 합니다.
7. **효과 → 노이즈 제거 및 복구 → 노이즈 감소**를 선택합니다. **노이즈 감소** 대화 상자에서 **노이즈 감소**를 `12`로 설정하고 **선택 범위에 적용**을 누릅니다. 12 데시벨은 좋은 첫 번째 설정입니다. 더 높은 값은 더 많은 소음을 제거하지만 목소리가 공명하게 만듭니다.
   *보여야 할 것:* 선두 부분은 거의 평평해지고 톤은 그대로 유지됩니다.
8. **효과 → 레거시 효과 → 클래식 필터**를 선택합니다. **클래식 필터** 대화 상자에서 **필터 유형**을 **하이패스**로 선택하고 **컷오프 주파수**를 `100`로 설정합니다. **선택 범위에 적용**을 누릅니다. 100Hz 이하의 모든 것(교통, 핸들링, 에어컨 등)이 감소됩니다. 음성은 100Hz 이상에 잘 존재합니다.
9. **효과 → 볼륨 및 압축 → 청각 정규화**를 선택합니다. **청각 정규화** 대화 상자에서 **타겟 청각**을 `-16`로 설정하고 **선택 범위에 적용**을 누릅니다. -16 LUFS는 스테레오 팟캐스트의 일반적인 타겟입니다. 청각은 피크 높이가 아닌 전체 클립의 청각적 느낌을 측정합니다.
   *보여야 할 것:* 웨이브폼이 더 높아지고 클립이 편안한 수준으로 재생됩니다.
10. **재생**을 눌러 청취한 후 **정지**합니다.
   *보여야 할 것:* 깨끗하고 평평한 클립으로 조용한 선두 부분이 있습니다.
11. **파일 → 오디오 내보내기**를 선택하고 **형식**을 **MP3**로 설정합니다. **내보내기**를 누르면 렌더링이 완료되는 즉시 파일이 다운로드되며, 대화 상자에 링크가 유지됩니다. 파일은 브라우저에서 인코딩되며 컴퓨터 밖으로 나가지 않습니다.

## 다음 단계

- [배경 소음 제거](/guides/cleaning-up/remove-background-noise/), [저주파 잡음 제거](/guides/cleaning-up/remove-low-rumble/), [팟캐스트용 음량 정규화](/guides/volume/normalize-loudness-for-podcasts/) 튜토리얼을 사용하여 자신의 클립에 적용해 보세요.
- [믹스의 음량 측정](/guides/analysis/measure-loudness/)을 통해 플랫폼이 결과를 확인하는 방법을 알아보세요.

## 다른 튜토리얼

[첫 번째 Soundscaper 프로젝트](/tutorials/your-first-project/) — 녹음 파일을 가져오고, 듣기, 분할, 페이드 아웃, 파일 내보내기 및 프로젝트 저장하기.
[음성에 음악 추가하기](/tutorials/put-music-under-a-voice/) — 두 트랙을 겹쳐서 한 트랙을 다른 트랙 아래로 자동으로 낮추고, 믹스다운 및 내보내기.

## 참고 자료

- [이 튜토리얼에서 사용된 효과 매개변수 모두, 기본값 및 범위는 오디오 효과 참조](/reference/generated/audio-effects/#parameters)에 있습니다.
- [내보내기 형식, 컨테이너 및 채널 제한은 내보내기 형식 참조](/reference/generated/formats/)에 있습니다.
- [모든 메뉴 명령과 키보드 단축키는 명령 및 단축키 참조](/reference/generated/commands/)에 있습니다.

## 이 튜토리얼에 대하여

이 튜토리얼은 Soundscaper의 각 빌드에 대해 단계별로 재현되며, 브라우저 스위트(`tests/browser/soundscaper-tutorials.spec.js`)에 의해 검증됩니다. 단계가 작동하지 않으면 빌드가 실패하고 튜토리얼이 수정될 때까지 유지되므로, 읽는 내용은 편집기가 수행하는 내용과 정확히 일치합니다.
