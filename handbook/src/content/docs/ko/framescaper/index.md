---
title: "프레임스케이퍼"
description: "비디오를 배치하고, 이미지를 합성하고, 로컬 우선 비디오 프로젝트를 제공합니다."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","targetLocale":"ko"} -->

Framescaper는 공유 편집기의 비디오에 중점을 둔 뷰입니다. 비디오 미리보기, 소스 모니터링, 이미지 효과, 합성, 중첩 시퀀스 및 멀티 카메라 작업을 강조합니다.

Soundscaper와 Framescaper는 서로의 프로젝트 파일을 엽니다: `.sscape`, `.fscape` 및 이전 버전의 `.scape` 모두 두 앱에서 작동합니다. 자세한 오디오 제작을 위해 Soundscaper를 사용하여 녹음한 후 프로젝트를 Framescaper로 다시 가져와 이미지 작업을 수행하세요.

## 위치별 내용

Framescaper는 이미지를 담당합니다: 비디오 가져오기, 소스 모니터 및 비디오 미리보기, 이미지 효과, 기하학 및 합성, 중첩 시퀀스, 멀티 카메라 작업 및 비디오 전달. 여기서 연결된 이미지 및 오디오 레인은 분리할 때까지 동기화됩니다.

Soundscaper는 사운드를 담당합니다: 오디오 녹음, 효과 및 분석, 믹싱 및 오디오 전달. Framescaper는 다른 캡처 워크플로를 사용하며 Soundscaper의 오디오 녹음 도구 세트를 노출하지 않으므로 Soundscaper에서 녹음한 후 프로젝트를 가져오세요. 단계별 [가이드](/guides/)는 Soundscaper를 기준으로 작성 및 검증되었으며 비디오 프로젝트의 오디오 측면도 다룹니다.

## 권장 경로

1. [첫 Framescaper 프로젝트 생성](/framescaper/first-project/).
2. [비디오 준비 및 내보내기](/framescaper/video-export/).
3. [프로젝트 파일 및 백업 동작](/projects-and-data/project-files/) 검토.

브라우저 편집기를 열려면
[soundscaper.org/framescaper/en](https://soundscaper.org/framescaper/en/)로 이동하세요.
