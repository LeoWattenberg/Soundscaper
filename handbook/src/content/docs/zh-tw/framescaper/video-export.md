---
title: "匯出視訊"
description: "驗證組成的序列並建立MP4或WebM的交付檔案。"
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"zh-TW"} -->

## 在導出前

- 播放完整序列和每個編輯邊界。
- 確認可見和單獨音軌產生預期的圖像。
- 檢查連結的音訊是否保持同步。
- 確認導出範圍以及是否應包含字幕或音訊。

## 建立檔案

打開導出對話方塊並選擇影片格式。Framescaper 透過配置的影片運行時支援 MP4 和 WebM 傳遞。選擇適合目的地的尺寸、幀率和其他選項。

視訊編碼比一般時間軸播放更耗用資源。在導出報告完成之前，請保持編輯器打開。

## 個別匯出音訊片段 {#export-audio-clips}

選擇**檔案 → 匯出影片**，選取 **WAV** 等音訊格式，並將**輸出**設為**個別片段（依片段分割）**。匯出會下載一個封存檔，其中每個音訊片段各有一個檔案。影片片段會排除；每個音訊檔只包含對應片段，包括其裁切和片段編輯。

檔案從片段實際可聽見的起點開始，不會補齊到專案中的時間位置，也不會加入效果尾音。加上編號的片段名稱可區分重名片段。

會包含音軌效果；主效果、靜音和獨奏不會影響這次匯出。共用的音訊工作流程請參閱[將片段匯出為個別檔案](/soundscaper/edit-mix-and-export/#export-clips)。

## 驗證傳遞

在獨立播放器中打開導出的檔案。檢查其持續時間、第一個和最後一個幀、圖像方向、音訊同步和預期的字幕。

渲染的視訊無法取代可編輯的專案。當您需要保留時間軸和專案媒體時，也請導出一份`.fscape`副本。
