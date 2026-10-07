---
title: "在桌面版覆寫匯入的檔案"
description: "在 Soundscaper 或 Framescaper 中，將編輯後的專案儲存到原始媒體檔案。"
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"zh-TW"} -->

在 Soundscaper 和 Framescaper 的 Electron 版本中，選擇**檔案 → 覆寫檔名**會將完整編輯後的專案匯出到最初匯入的媒體檔案。此命令使用原始檔案支援的匯出設定，並立即儲存，不會開啟匯出對話方塊或檔案選擇器。音訊會保留來源格式、取樣率和聲道數。支援的 MP4 和 WebM 影片會保留來源容器、尺寸和影格率。

透過**檔案 → 匯入**匯入一個媒體檔案，完成編輯後選擇**檔案 → 覆寫檔名**。後續再編輯後也可以重複此操作。時間選取範圍不會限制覆寫範圍：一律會轉譯整個專案。專案會保留已匯入的媒體和編輯記錄。

如果專案沒有支援的原始檔案、匯入了多個原始檔案，或正在匯入、錄音或處理，此命令將無法使用。瀏覽器版本使用一般匯出對話方塊。

若要選擇其他目的地或變更輸出設定，請在 Soundscaper 中選擇**檔案 → 匯出音訊**，或在 Framescaper 中選擇**檔案 → 匯出影片**。覆寫會取代原始檔案內容；若需要未編輯的錄音，請另存一份副本。
