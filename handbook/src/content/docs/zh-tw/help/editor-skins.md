---
title: "編輯器外觀"
description: "選擇一個視覺外觀或透過網址暫時嘗試一個。"
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"zh-TW"} -->

皮膚會更改編輯器的顏色、字型、邊框和裝飾背景。
它們在 Soundscaper 和 Framescaper 中提供。每個產品都會記住自己的選擇。工作區仍然控制面板和工具的排列。

## 選擇一個皮膚 {#choose-a-skin}

打開 **編輯 → 偏好設定 → 外觀** 並選擇一個皮膚：

- **預設** 保持原始的編輯器設計。
- **櫻花** 結合櫻花、粉紅色強調和圓角字體。
- **紫丁香** 使用冷紫色和分層的紫羅蘭色質感。
- **科技** 結合藍色電路圖形和等寬字體。

分別選擇 **明亮**、**黑暗** 或 **遵循系統主題**。每個皮膚都有明亮和黑暗版本。**剪貼風格** 仍然是獨立的選擇；色彩豐富的調色板與每個皮膚協調，同時保持剪貼顏色獨特。

高對比度優先於皮膚裝飾。關閉高對比度會恢復所選皮膚。更改皮膚不會更改剪貼音頻、專案內容或工作區佈局。

## 從連結嘗試皮膚 {#try-a-skin-from-a-link}

將 `?useskin=sakura` 新增到編輯器 URL 以暫時預覽櫻花。使用
`default`、`sakura`、`lilac` 或 `techno` 作為值。如果 URL 已經有查詢參數，請附加 `&useskin=sakura`。未知的值會被忽略。

URL 預覽不會取代您儲存的皮膚，即使您更改其他偏好設定。重新載入預覽 URL 會繼續預覽它；造訪沒有參數的 URL 會使用您儲存的選擇。參數不會選擇明亮或黑暗版本。

在 **偏好設定 → 外觀** 中，選擇 **保留此皮膚** 以儲存預覽，或 **結束預覽** 以返回儲存的皮膚。選擇任何皮膚也會儲存該選擇並結束預覽。這些動作僅從當前 URL 中移除皮膚參數，而不重新載入編輯器。
