---
title: "匯入和匯出"
description: "區分來源媒體、專案檔案、交換檔案和轉譯後的交付檔案。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"zh-TW"} -->

Soundscaper 使用不同的檔案類型執行不同工作。

## 來源媒體

音訊、影片和標籤請使用 **檔案 → 匯入**。目前編輯器提示列出 AUP/AUP3/AUP4、WAV、MP3、FLAC、Opus、OGG、M4A、AIFF 和 WebM；影片匯入路徑還支援其他影片容器。可用格式可能取決於目前產品和執行階段。

匯入媒體會將其新增為專案擁有的來源素材，但不會把原始檔案變成可編輯的專案文件。

壓縮音訊的匯入和匯出上限為一小時或 1 GB（1,000,000,000 個檔案位元組），以先達到的限制為準。只要符合檔案大小限制，就支援一小時的 48 kHz 立體聲檔案。長時間工作會分塊讀取、編碼和儲存；大型瀏覽器匯出需要來源網站私有檔案儲存空間以及足夠的可用空間。大型匯入需要持續的本機儲存空間來保存解碼後的音訊。PCM 格式有各自獨立的限制。

瀏覽器版支援 MP3、MP2、FLAC、WavPack、Opus 和 Ogg Vorbis。瀏覽器版的 AAC/M4A 支援情況取決於瀏覽器編解碼器。桌面版串流匯出支援六種內建格式，以及 24 位元 FLAC 和 float32 無損 WavPack。桌面版匯入取決於原生解碼器是否可用；MP2 使用規模較小的實用工具相容層級。桌面版 AAC 和相容性提供者各有個別限制。

即使 **View → Status bar** 已隱藏，執行中的工作仍會顯示進度列。按進度列旁的 **Cancel** 可停止匯入或音訊匯出。

## 可編輯的專案檔案

- Scape（Soundscaper 使用 `.sscape`，Framescaper 使用 `.fscape`，兩種格式都可在任一產品中開啟）是 Soundscaper 和 Framescaper 共用的可攜式無損專案格式。
- AUP4 是與 Audacity 交換純音訊專案的格式，不是混合媒體 Soundscaper 專案的完整備份。

請參閱[專案檔案](/projects-and-data/project-files/)，了解每種選擇的影響。

## 轉譯後的交付檔案

音訊匯出會建立用於聆聽、發布或後續處理的檔案。影片匯出會建立 MP4 或 WebM 檔案。轉譯後的檔案不會保留可編輯的時間軸、路由、效果或專案歷程記錄。

請參閱[參考資料](/reference/)中的格式表和產品功能表。
