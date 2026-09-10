---
title: "저장소, 백업 및 개인 정보 보호"
description: "로컬 우선 저장소를 이해하고 브라우저 또는 장치 손실로부터 프로젝트를 보호하세요."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"ko"} -->

## 로컬 우선이란

프로젝트, 녹음 및 가져온 미디어는 장치에서 처리 및 저장됩니다. 편집기는 계정이나 Soundscaper 서비스에 프로젝트를 동기화할 필요가 없습니다.

웹에서 오디오 및 미디어는 사용 가능한 경우 브라우저의 원본 개인 파일 시스템을 사용하고, IndexedDB가 대체됩니다. Soundscaper는 지속적인 저장을 요청하지만, 브라우저가 이를 승인할지 결정합니다.

## 프로젝트를 제거할 수 있는 것

- 사이트 데이터 지우기: 브라우저의 로컬 프로젝트 라이브러리를 제거합니다.
- 개인 또는 제한된 브라우저 컨텍스트: 임시 메모리로 대체될 수 있습니다.
- 브라우저 할당량 및 퇴출 정책: 여전히 권한이 있습니다.
- 데스크톱 애플리케이션 데이터 수동 제거: 로컬 라이브러리를 제거합니다.
- 장치 또는 저장소 오류: 해당 장치에 있는 모든 로컬 복사본을 제거할 수 있습니다.

패키지된 데스크톱 빌드 제거는 라이브러리를 보존하도록 설계되었지만, 이는 백업 전략이 아닙니다.

## 백업 루틴

유용한 마일스톤과 저장소 지우기 또는 마이그레이션 전에:

1. 로컬 저장이 완료될 때까지 기다립니다.
2. Scape 프로젝트 파일(`.sscape` 또는 `.fscape`)을 내보냅니다.
3. 렌더링된 배달을 내보내고 재생합니다.
4. 둘 다 편집기의 로컬 데이터 외부의 저장소로 복사합니다.

Audacity 교류가 중요한 경우 AUP4를 추가로 사용해야 하며, Scape 프로젝트 복사본을 대신해서는 안 됩니다.

## 문서 사이트 개인 정보

이 핸드북은 정적 파일로 제공되며 브라우저 로컬 검색을 사용합니다. V1 사이트는 분석 서비스나 AI/검색 백엔드를 추가하지 않습니다.

[Soundscaper 및 Framescaper 개인 정보 보호 정책](https://soundscaper.org/privacy/en/) 전체는 애플리케이션 배달, 장치 권한, 선택적 다운로드, 데스크톱 업데이트 확인 및 Framescaper Web VCR 연결도 다룹니다.
