---
title: "本機處理、模型和外掛程式"
description: "依工作尋找本機協助功能，並在桌面版編輯器中管理模型和外掛程式。"
---
<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"zh-TW"} -->

Soundscaper 和 Framescaper 桌面版編輯器會在您的裝置上執行本機協助功能。選取媒體，然後從選單中選擇工作。對話框會顯示所選內容、工作設定，以及所需模型是否已安裝。

桌面版套件包含已發布本機模型的原生處理引擎。請透過 Model Manager 安裝模型權重，然後對所選媒體執行工作。每個模型的[指南](/reference/local-models/)都列出支援的平台、選單項目和要求。

## 尋找工作 {#find-a-task}

| 選單 | 工作 |
| --- | --- |
| Effect → Noise removal and repair | Enhance Dialogue、Reduce Reverb、Clean Filler & Silence |
| Effect → Source Separation | Separate Dialogue / Music / Effects |
| Analyze → Speech | Transcribe & Captions、Identify Speakers、Mark Reactions |
| Analyze → Music | Detect Beats & Tempo |
| Analyze → Video | Mark Cuts |
| Effect → Video effects | Reframe |
| Edit | Make Highlights |
| Generate | Generate Editorial Text |
| Tools → Search | Indexed Search、Index Transcript、Index Video |

影片工作僅適用於 Framescaper。可用命令取決於桌面執行階段和產品功能。Soundscaper 的字母排序效果選單選項也會依名稱排列本機處理效果。

選擇 **Run locally** 開始處理，並回應本機同意提示。處理期間可以取消。選擇 **Review result**，選取所需結果，然後選擇 **Apply selected**。已接受的專案編輯可以復原。關閉工作不會套用其建議。

**Tools → Advanced Local Processing** 保留個別的操作和模型選擇器。如有需要，工作對話框中的技術詳細資料會顯示底層步驟和確切設定。

## 管理模型 {#manage-models}

開啟 **Tools → Model Manager**，或在工作中使用 **Manage Models**。工作中的連結會將清單篩選為相容的模型；**Show all models** 會清除篩選。可依名稱或工作搜尋，也可依安裝狀態篩選。

請明確安裝模型。下載時會顯示進度，也可以取消。返回工作時會保留工作設定並更新模型可用性，但不會開始處理。展開 **Storage and verification** 可執行修復、清理、儲存位置移轉、查看授權聲明，以及從資料夾進行離線安裝。

請參閱[各模型指南](/reference/local-models/)，了解每個已發布模型的用途、選單項目、下載大小、要求、限制，以及 nightly-with-tests 桌面版套件執行的實際推論檢查。

## 管理外掛程式和裝置 {#manage-plugins-and-devices}

**Effect → Plugin Manager** 會列出 Soundscaper 中的音訊外掛程式，以及 Framescaper 中的 OpenFX 外掛程式。搜尋或篩選清單，然後選擇外掛程式以查看其版本、權限和復原控制項。**Scanning & Settings** 包含探索設定。即使處理功能已停用，仍可存取外掛程式管理。

透過 **Effect → Audio Plugins** 使用音訊外掛程式。Framescaper 的新增或編輯影片效果命令仍位於 **Effect → Video effects** 下。

開啟 **Edit → Preferences → Audio settings** 可設定原生音訊裝置和輔助控制項。**Media** 包含原生媒體設定；**Effects** 連結到 Plugin Manager，並包含外掛程式探索開關。外掛程式權限和隔離復原仍需明確操作。
