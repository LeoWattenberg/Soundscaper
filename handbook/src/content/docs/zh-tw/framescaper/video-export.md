---
title: "匯出視訊"
description: "驗證組成的序列並建立MP4或WebM的交付檔案。"
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"zh-TW"} -->

## 在導出前

- 播放完整序列和每個編輯邊界。
- 確認可見和單獨音軌產生預期的圖像。
- 檢查連結的音訊是否保持同步。
- 確認導出範圍以及是否應包含字幕或音訊。

## 建立檔案

打開導出對話方塊並選擇影片格式。Framescaper 透過配置的影片運行時支援 MP4 和 WebM 傳遞。選擇適合目的地的尺寸、幀率和其他選項。

視訊編碼比一般時間軸播放更耗用資源。在導出報告完成之前，請保持編輯器打開。

## 驗證傳遞

在獨立播放器中打開導出的檔案。檢查其持續時間、第一個和最後一個幀、圖像方向、音訊同步和預期的字幕。

渲染的視訊無法取代可編輯的專案。當您需要保留時間軸和專案媒體時，也請導出一份`.fscape`副本。
