---
title: "导出视频"
description: "验证组合序列并创建MP4或WebM交付文件。"
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"zh-CN"} -->

## 在导出前

- 播放完整序列和每个编辑边界。
- 确认可见和单独轨道产生预期的图像。
- 检查链接音频是否保持同步。
- 确认导出范围以及是否应包含字幕或音频。

## 创建文件

打开导出对话框并选择视频格式。Framescaper通过配置的视频运行时支持MP4和WebM交付。选择适合目的地的尺寸、帧率和其他选项。

视频编码比普通时间线播放更耗资源。在导出报告完成之前，请保持编辑器打开。

## 验证交付

在单独的播放器中打开导出的文件。检查其持续时间、第一个和最后一个帧、图像方向、音频同步和预期字幕。

渲染的视频无法替换可编辑的项目。当您需要保留时间线和项目媒体时，也导出一份副本`.fscape`。
