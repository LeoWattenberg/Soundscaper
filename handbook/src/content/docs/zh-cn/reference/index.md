---
title: "参考"
description: "生成的命令、快捷方式、格式、效果和产品功能表。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"27ac617a3293f4d301daf72bed0b9f3e9127f4516531c320703c36e7afe8658c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"27ac617a3293f4d301daf72bed0b9f3e9127f4516531c320703c36e7afe8658c","targetLocale":"zh-CN"} -->

参考页面是从已审核的运行时注册表生成的，并提交到
存储库。它们描述已实现的行为，而不是路线图条目或源文件和测试的简单存在。

使用此部分来回答以下问题：

- 哪个默认快捷键调用命令？
- 命令在Soundscaper、Framescaper中可用，还是两者都有？
- 可以导出的音频和视频格式有哪些？
- 效果的参数默认值是什么，它可以接受哪些值？
- 哪些效果可以在音频播放时运行，哪些需要选择？
- 哪些本地辅助工作流程存在，它们需要哪些模型？
- 每个工作区显示哪些面板？
- 构建和测试了哪些语言、浏览器和桌面包？
- 哪些功能依赖于产品、平台或FFmpeg运行时？

生成的页面包括其源出处，并在存储库质量网关中检查漂移。

手写的[宏程序](/reference/macro-programs/)页面介绍宏程序使用的 JavaScript API。[在桌面端覆盖已导入文件
](/reference/overwrite-original-file/)页面说明两个产品共用的 Electron 文件命令。编辑器测试会检查这些行为。
