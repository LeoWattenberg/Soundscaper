---
title: "編輯器外觀主題"
description: "選擇一種視覺主題，或透過網址暫時試用。"
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"zh-TW"} -->

外觀主題會變更編輯器的色彩、字型、邊框和裝飾背景。Soundscaper 和 Framescaper 都提供外觀主題。每個產品會分別記住自己的選擇。工作區仍會控制面板和工具的排列方式。

## 選擇外觀主題 {#choose-a-skin}

開啟 **Edit → Preferences → Appearance**，然後選擇一種外觀主題：

- **Default** 保留編輯器的原始設計。
- **Sakura** 採用櫻花、粉色點綴和圓潤字型。
- **Lilac** 使用冷紫色和層疊的紫羅蘭紋理。
- **Techno** 將藍色電路圖案和等寬字型結合。

請另外選擇 **Light**、**Dark** 或 **Follow system theme**。每種外觀主題都有淺色和深色版本。**Clip style** 是獨立的設定；Colorful 色盤會與各種外觀主題搭配，同時讓片段顏色彼此有別。

高對比優先於主題裝飾。關閉高對比後，會還原所選的外觀主題。變更外觀主題不會影響片段音訊、專案內容或工作區版面配置。

## 透過連結試用外觀主題 {#try-a-skin-from-a-link}

在編輯器網址中加入 `?useskin=sakura`，即可暫時預覽 Sakura。參數值可使用 `default`、`sakura`、`lilac` 或 `techno`。如果網址已有查詢參數，請改為附加 `&useskin=sakura`。未知的值會遭忽略。

網址預覽不會取代已儲存的外觀主題，即使您變更了其他偏好設定也是如此。重新載入預覽網址仍會顯示預覽；造訪不含該參數的網址時，則會使用已儲存的選擇。此參數不會選擇淺色或深色主題。

在 **Preferences → Appearance** 中選擇 **Keep this skin** 可儲存預覽，選擇 **End preview** 可返回已儲存的外觀主題。選擇任何外觀主題也會儲存該選擇並結束預覽。這些動作只會從目前網址移除主題參數，不會重新載入編輯器。
