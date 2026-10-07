---
title: "參考"
description: "生成命令、快捷鍵、格式、效果和產品功能表格。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"27ac617a3293f4d301daf72bed0b9f3e9127f4516531c320703c36e7afe8658c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"27ac617a3293f4d301daf72bed0b9f3e9127f4516531c320703c36e7afe8658c","targetLocale":"zh-TW"} -->

參考頁面是從已審閱的運行時註冊表生成的，並提交到
存儲庫。它們描述已實現的行為，而不是路線圖條目或僅存在源文件和測試。

使用此部分來回答以下問題：

- 哪個預設快捷鍵會呼叫命令？
- 命令是否在Soundscaper、Framescaper或兩者中可用？
- 可以導出哪些音頻和視頻格式？
- 效果的參數預設為何，它會接受哪些值？
- 哪些效果可以在音頻播放時運行，哪些需要選擇？
- 存在哪些本地輔助工作流程，它們需要哪些模型？
- 每個工作區顯示哪些面板？
- 建立和測試了哪些語言、瀏覽器和桌面套件？
- 哪些功能依賴於產品、平台或FFmpeg運行時？

生成的頁面包含其來源出處，並在存儲庫質量閘中檢查漂移。

手寫的[巨集程式](/reference/macro-programs/)頁面說明巨集程式使用的 JavaScript API。[在桌面版覆寫已匯入的檔案
](/reference/overwrite-original-file/)頁面說明兩個產品共用的 Electron 檔案命令。編輯器測試會檢查這些行為。
