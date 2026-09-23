---
title: "錄製音訊"
description: "授予編輯器輸入權限、選擇路由，並妥善保存錄製完成的素材。"
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"zh-TW"} -->

## 準備輸入

1. 開啟錄音裝置控制項，然後選擇可用的輸入裝置。
2. 瀏覽器詢問時，允許使用麥克風或進行錄製的權限。
3. 如果要在錄製前檢查輸入電平，請開啟輸入監聽。
4. 檢查錄音電平表，並調整裝置或輸入電平，以免發生削波。

瀏覽器權限按網站和裝置分別管理。如果沒有顯示輸入裝置，請檢查作業系統和瀏覽器的權限設定。

## 錄製一條或多條音軌

一般錄音可使用 **Record** 選單或傳輸控制列中的錄音操作。

若要進行多軌路由，請選擇 **View → Enable multi-track recording**，啟用要錄製的音軌，並為每條已啟用的音軌指定輸入。未指派可用輸入時，錄音不會開始。

Soundscaper 也可透過選單提供定時錄音、punch/count-in（穿插錄音或預備拍錄音）、loop/take（循環錄音或多次錄音），以及聲音觸發錄音等工作流程。請先嘗試一般錄音，再新增這些條件。

## 錄製完成後

停止錄音，並在繼續操作前播放新片段。等待專案狀態顯示儲存已完成。對於不可重錄的素材，請匯出轉譯後的音訊副本和一個 `.sscape` 專案檔案，不要只依賴本機資料庫。
