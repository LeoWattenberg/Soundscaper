---
title: "疑難排解"
description: "解決錄音、儲存、匯入和匯出時常見的問題。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"zh-TW"} -->

## 找不到錄音輸入裝置

檢查作業系統和瀏覽器的麥克風權限，然後重新開啟裝置選擇器。對於多軌錄音，請確認每條已啟用的音軌都指派了可用的輸入裝置。

## 命令處於停用狀態

許多命令取決於目前狀態。選取所需的專案、音軌、片段或時間範圍，然後重試。某項功能也可能僅限 Soundscaper 或 Framescaper 使用。

## 匯入內容佔用的記憶體過多

即使專案音訊以分塊方式儲存，壓縮解碼和某些大型操作仍可能需要大量暫存記憶體。請關閉不相關的分頁或應用程式，改用較小的來源檔案重試，或在適用時使用桌面版。

## 專案從瀏覽器中消失

確認您開啟的是同一個瀏覽器設定檔、來源網站和產品網站。Soundscaper 和 Framescaper 在同一個 `soundscaper.org` 來源網站上共用資料庫；其他網域、瀏覽器設定檔或已清除的網站儲存空間則對應不同的資料庫。

如果網站資料已清除，而且沒有 Scape 專案匯出檔，編輯器就沒有雲端副本可供還原。

## AUP4 檔案缺少部分專案內容

請查看相容性報告。AUP4 會保留相容的音訊編輯狀態，但不會保留影片，還可能轉換或省略效果和 Soundscaper 專屬的混音狀態。若要完整移轉專案，請使用 Scape 專案檔案：`.sscape` 或 `.fscape`；兩種檔案都可以在任一產品中開啟。

## 匯出失敗或無法播放

確認所選範圍內包含可播放的素材，然後重試。匯出壓縮音訊或影片時，請確認執行階段資產能夠載入。成功匯出後，請在其他播放器中測試實際檔案。

如問題仍未解決，請使用 **Help → Support** 聯絡維護者，並提供產品、平台、瀏覽器或桌面版版本、操作步驟和準確的錯誤訊息。
