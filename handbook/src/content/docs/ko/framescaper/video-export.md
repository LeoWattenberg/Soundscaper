---
title: "비디오 내보내기"
description: "구성된 시퀀스를 검증하고 MP4 또는 WebM 배달을 생성합니다."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"ko"} -->

## 내보내기 전

- 전체 시퀀스와 모든 편집 경계를 재생합니다.
- 눈에 보이는 트랙과 솔로 트랙으로 의도한 이미지가 생성되는지 확인합니다.
- 연결된 오디오가 동기화되어 있는지 확인합니다.
- 내보내기 범위와 자막 또는 오디오를 포함해야 하는지 확인합니다.

## 파일 생성

내보내기 대화를 열고 비디오 형식을 선택합니다. Framescaper는 구성 된 비디오 런타임을 통해 MP4 및 WebM 배달을 지원합니다. 목적지에 적합한 차원, 프레임 속도 및 기타 옵션을 선택합니다.

비디오 인코딩은 일반적인 타임라인 재생보다 더 많은 리소스를 소비합니다. 내보내기가 완료되었다고 보고될 때까지 편집기를 열어 두십시오.

## 배달 확인

내보낸 파일을 별도의 플레이어에서 엽니다. 기간, 첫 번째 및 마지막 프레임, 이미지 방향, 오디오 동기화 및 예상 자막을 확인합니다.

렌더링된 비디오는 편집 가능한 프로젝트를 대체할 수 없습니다. 필요한 경우 타임라인 및 프로젝트 미디어를 보존하기 위해 `.fscape` 사본을 내보내십시오.
