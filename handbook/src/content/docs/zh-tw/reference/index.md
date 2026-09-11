---
title: "參考"
description: "生成命令、快捷鍵、格式、效果和產品功能表格。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b7e4df92cd36126d4ce3865383043516972e9aca463c3449b731085cafc4050e","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b7e4df92cd36126d4ce3865383043516972e9aca463c3449b731085cafc4050e","targetLocale":"zh-TW"} -->

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

[巨集程式](/reference/macro-programs/) 是這裡唯一手動撰寫的頁面。它記錄巨集程式運行的JavaScript API，其主張是編輯器自身測試對沙盒的約束。
