---
title: "데스크톱에서 가져온 파일 덮어쓰기"
description: "Soundscaper 또는 Framescaper에서 편집한 프로젝트를 원본 미디어 파일에 저장합니다."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"ko"} -->

Soundscaper와 Framescaper의 Electron 버전에서 **파일 → 파일 이름 덮어쓰기**를 선택하면 편집한 프로젝트 전체를 원래 가져온 미디어 파일로 내보냅니다. 원본 파일이 지원하는 내보내기 설정을 사용하며 내보내기 대화상자나 파일 선택기를 열지 않고 바로 저장합니다. 오디오는 원본 형식, 샘플 레이트, 채널 수를 유지합니다. 지원되는 MP4 및 WebM 동영상은 원본 컨테이너, 크기, 프레임 레이트를 유지합니다.

**파일 → 가져오기**로 미디어 파일 하나를 가져와 편집한 다음 **파일 → 파일 이름 덮어쓰기**를 선택합니다. 추가 편집 후에도 반복할 수 있습니다. 시간 선택 영역은 덮어쓰기 범위를 제한하지 않습니다. 항상 프로젝트 전체를 렌더링합니다. 프로젝트에는 가져온 미디어와 편집 기록이 그대로 보존됩니다.

프로젝트에 지원되는 원본 파일이 없거나 원본 파일을 여러 개 가져왔거나 가져오기, 녹음, 처리 중이면 이 명령을 사용할 수 없습니다. 브라우저 버전에서는 일반 내보내기 대화상자를 사용합니다.

다른 위치를 선택하거나 출력 설정을 변경하려면 Soundscaper에서는 **파일 → 오디오 내보내기**, Framescaper에서는 **파일 → 비디오 내보내기**를 선택합니다. 덮어쓰기는 원본 파일의 내용을 대체하므로 편집되지 않은 녹음이 필요하면 별도 사본을 보관하세요.
