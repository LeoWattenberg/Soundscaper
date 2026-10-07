---
title: "导出视频"
description: "验证组合序列并创建MP4或WebM交付文件。"
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"zh-CN"} -->

## 在导出前

- 播放完整序列和每个编辑边界。
- 确认可见和单独轨道产生预期的图像。
- 检查链接音频是否保持同步。
- 确认导出范围以及是否应包含字幕或音频。

## 创建文件

打开导出对话框并选择视频格式。Framescaper通过配置的视频运行时支持MP4和WebM交付。选择适合目的地的尺寸、帧率和其他选项。

视频编码比普通时间线播放更耗资源。在导出报告完成之前，请保持编辑器打开。

## 单独导出音频片段 {#export-audio-clips}

选择**文件 → 导出视频**，选取 **WAV** 等音频格式，并将**输出**设为**单独片段（按片段拆分）**。导出会下载一个压缩包，其中每个音频片段对应一个文件。视频片段会被排除；每个音频文件只包含对应片段，包括其裁剪和片段编辑。

文件从片段实际可听到的起点开始，不会补齐到项目中的时间位置，也不会添加效果尾音。带编号的片段名称可区分重名片段。

会包含轨道效果；主效果、静音和独奏不会影响此次导出。共享的音频工作流程请参阅[将片段导出为单独文件](/soundscaper/edit-mix-and-export/#export-clips)。

## 验证交付

在单独的播放器中打开导出的文件。检查其持续时间、第一个和最后一个帧、图像方向、音频同步和预期字幕。

渲染的视频无法替换可编辑的项目。当您需要保留时间线和项目媒体时，也导出一份副本`.fscape`。
