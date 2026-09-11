---
title: "儲存、備份與隱私"
description: "了解本地優先儲存，並保護專案免受瀏覽器或裝置遺失的影響。"
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"zh-TW"} -->

## 什麼是本地優先

專案、錄音和匯入的媒體會在您的設備上進行處理和儲存。編輯器不需要帳戶或將專案同步到 Soundscaper 服務。

在網路上，音頻和媒體會在可用的情況下使用瀏覽器的來源私密檔案系統，並有 IndexedDB 的備用方案。Soundscaper 會請求持久儲存，但瀏覽器會決定是否授予。

## 什麼會刪除專案

- 清除網站資料會刪除瀏覽器本地的專案庫。
- 私人或受限的瀏覽器上下文可能會退回到暫存記憶體。
- 瀏覽器的配額和驅逐策略仍具有決定權。
- 手動刪除桌面應用程式的資料會刪除其本地庫。
- 設備或儲存故障可能會刪除該設備上的所有本地副本。

卸載封裝的桌面版本旨在保留其庫，但這不是備份策略。

## 備份常規

在有用的里程碑和清除或遷移儲存空間之前：

1. 等待本地儲存完成。
2. 匯出 Scape 專案檔案（`.sscape` 或 `.fscape`）。
3. 匯出並播放渲染的交付品。
4. 將兩者複製到編輯器本地資料以外的儲存空間。

當 Audacity 互換性重要時，請使用 AUP4，而不是替代 Scape 專案副本。

## 文件網站隱私

這本手冊以靜態檔案提供，並使用瀏覽器本地搜尋。V1 網站不會添加分析服務或 AI/搜尋後端。

完整的 [Soundscaper 和 Framescaper 隱私政策](https://soundscaper.org/privacy/en/) 也涵蓋應用程式交付、設備權限、可選下載、桌面更新檢查和 Framescaper Web VCR 連接。
