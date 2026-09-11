---
title: "專案檔案"
description: "在本地庫、Scape 專案檔案、AUP4 和渲染備份之間進行選擇。"
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"zh-TW"} -->

## 本地專案庫

編輯器會將正在工作的專案儲存在其本地庫中。在瀏覽器中，這是原點私有儲存；在桌面版中，則是應用程式資料。這是一個方便的工作副本，並非你應該保留的唯一副本。

## 儲存專案檔案

使用 **檔案 → 匯出專案檔案** 來獲得無損的便攜式專案。每個產品都會寫入自己的後綴：Soundscaper 會儲存 `.sscape`，Framescaper 會儲存 `.fscape`，選單項會顯示適用的後綴名稱。兩者背後的格式相同，因此當需要保留混合媒體編輯狀態時，這是合適的選擇。

任一產品都可以打開任一後綴的檔案。 `.sscape`, `.fscape`，預留的 `.liscape`，以及較舊的在產品尚未有專屬後綴時匯出的 `.scape` 檔案可以在任何地方打開，且從不同產品儲存一個檔案僅會重新命名它——例如，從 Framescaper 儲存的 `Mix.sscape` 會成為 `Mix.fscape`。檔案名稱變更不會改變專案本身。

匯入或打開 Scape 副本時，可能會遇到本地庫中已存在的相同 ID 的專案。當兩個版本都需要保留在本地庫時，請使用提供的副本工作流程。

## AUP4

AUP4 存在於與 Audacity 兼容的音訊交換中。匯出會產生一個兼容性報告，描述轉換、不可用的效果，以及省略的 Soundscaper 專屬狀態。

AUP4 僅包含音訊。視訊會被省略，瀏覽器偏好設定、還原歷史、混音路由和瀏覽器的專案庫不會被傳輸。請勿將 AUP4 作為 Soundscaper 或 Framescaper 專案的唯一備份。

## 渲染備份

對於重要工作，請保留以下兩項：

1. Scape 專案副本 (`.sscape` 或 `.fscape`) 用於未來編輯。
2. 渲染的音訊或視訊檔案，可獨立於編輯器播放。

請將這些檔案儲存在瀏覽器或應用程式資料目錄之外。
