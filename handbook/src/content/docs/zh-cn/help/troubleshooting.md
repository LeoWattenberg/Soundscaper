---
title: "常见问题排查"
description: "解决录音、存储、导入和导出时常见的问题。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"zh-CN"} -->

## 找不到录音输入设备

检查操作系统和浏览器的麦克风权限，然后重新打开设备选择器。对于多轨录音，请确认每条已启用的音轨都分配了可用输入设备。

## 命令处于禁用状态

许多命令取决于当前状态。选择所需的项目、音轨、片段或时间范围，然后重试。某项功能也可能仅限 Soundscaper 或 Framescaper 使用。

## 导入内容占用的内存过多

即使项目音频以分块形式存储，压缩解码和某些大型操作仍可能需要大量临时内存。请关闭不相关的标签页或应用程序，改用较小的源文件重试，或在适用时使用桌面版。

## 项目从浏览器中消失

确认你打开的是同一个浏览器配置文件、来源站点和产品网站。Soundscaper 和 Framescaper 在同一个 `soundscaper.org` 来源站点上共用资料库；其他域名、浏览器配置文件或已清除的网站存储则对应不同的资料库。

如果网站数据已清除，并且没有 Scape 项目导出文件，编辑器就没有云端副本可供恢复。

## AUP4 文件缺少部分项目内容

请查看兼容性报告。AUP4 会保留兼容的音频编辑状态，但不会保留视频，还可能转换或省略效果和 Soundscaper 专属的混音状态。要完整迁移项目，请使用 Scape 项目文件：`.sscape` 或 `.fscape`；两种文件都可以在任一产品中打开。

## 导出失败或无法播放

确认所选范围内包含可播放的素材，然后重试。导出压缩音频或视频时，请确认运行时资源能够加载。成功导出后，请在其他播放器中测试实际文件。

如问题仍未解决，请使用 **Help → Support** 联系维护者，并提供产品、平台、浏览器或桌面版版本、操作步骤和准确的错误信息。
