---
title: "匯入和匯出"
description: "區分來源媒體、專案檔案、交換檔案和轉譯後的交付檔案。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"zh-TW"} -->

Soundscaper 使用不同的檔案類型執行不同工作。

## 來源媒體

音訊、影片和標籤請使用 **檔案 → 匯入**。目前編輯器提示列出 AUP/AUP3/AUP4、WAV、MP3、FLAC、Opus、OGG、M4A、AIFF 和 WebM；影片匯入路徑還支援其他影片容器。可用格式可能取決於目前產品和執行階段。

匯入媒體會將其新增為專案擁有的來源素材，但不會把原始檔案變成可編輯的專案文件。

壓縮音訊匯出和瀏覽器匯入支援最長一小時或 1 GB（1,000,000,000 個檔案位元組），以先達到的限制為準。桌面版選擇檔案和匯入壓縮音訊，在安全整數範圍內沒有固定的檔案大小或時間上限。長時間工作會分塊讀取、編碼和儲存；大型瀏覽器匯出需要來源網站私有檔案儲存空間以及足夠的可用空間。大型匯入需要足夠的本機儲存空間來保存解碼後的音訊。格式結構、解碼器支援和可用儲存空間也可能限制匯入。

瀏覽器版支援 MP3、MP2、FLAC、WavPack、Opus 和 Ogg Vorbis。瀏覽器版的 AAC/M4A 支援情況取決於瀏覽器編解碼器。桌面版串流匯出支援六種內建格式，以及 24 位元無損 FLAC 和 float32 無損 WavPack。桌面版匯入取決於解碼器是否可用；大型 MP2 來源使用封包解碼器，較小的 MP2 來源使用實用工具相容層級。

即使 **View → Status bar** 已隱藏，執行中的工作仍會顯示進度列。按進度列旁的 **Cancel** 可停止匯入或音訊匯出。

## 可編輯的專案檔案

- Scape（Soundscaper 使用 `.sscape`，Framescaper 使用 `.fscape`，兩種格式都可在任一產品中開啟）是 Soundscaper 和 Framescaper 共用的可攜式無損專案格式。
- AUP3 和 AUP4 可與 Audacity 交換音訊。選擇 AUP3 使用 Audacity 3.7.9 專案設定檔，或選擇 AUP4 使用目前的交換設定檔。兩者都不是混合媒體 Soundscaper 專案的完整備份；匯出後請檢查相容性報告。
- 桌面版可以開啟 Adobe Audition SESX (`.sesx`) 工作階段，從參照的音訊檔案建立本機專案。請保留原始工作階段和媒體；目前不支援匯出 SESX。

請參閱[專案檔案](/projects-and-data/project-files/)，了解每種選擇的影響。

## 轉譯後的交付檔案

音訊匯出會建立用於聆聽、發布或後續處理的檔案。影片匯出會建立 MP4 或 WebM 檔案。轉譯後的檔案不會保留可編輯的時間軸、路由、效果或專案歷程記錄。

請參閱[參考資料](/reference/)中的格式表和產品功能表。
