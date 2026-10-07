---
title: "导入和导出"
description: "区分源媒体、项目文件、交换文件和渲染后的交付文件。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"zh-CN"} -->

Soundscaper 使用不同的文件类型完成不同工作。

## 源媒体

音频、视频和标签请使用 **文件 → 导入**。当前编辑器提示列出 AUP/AUP3/AUP4、WAV、MP3、FLAC、Opus、OGG、M4A、AIFF 和 WebM；视频导入路径还支持其他视频容器。可用格式可能取决于当前产品和运行环境。

导入媒体会将其添加为项目拥有的源素材，但不会把原始文件变成可编辑的项目文档。

压缩音频导出和浏览器导入支持最长一小时或 1 GB（1,000,000,000 字节），以先达到的限制为准。桌面版文件选择和压缩音频导入在安全整数范围内没有固定的文件大小或时长上限。长任务会分块读取、编码和保存；大型浏览器导出需要来源站点私有文件存储空间以及足够的可用空间。大型导入需要足够的本地存储来保存解码后的音频。格式结构、解码器支持和可用存储空间也可能限制导入。

浏览器版支持 MP3、MP2、FLAC、WavPack、Opus 和 Ogg Vorbis。浏览器版的 AAC/M4A 支持情况取决于浏览器编解码器。桌面版流式导出支持六种内置格式，以及 24 位无损 FLAC 和 float32 无损 WavPack。桌面版导入取决于解码器是否可用；大型 MP2 源文件使用分组解码器，较小的 MP2 源文件使用实用工具兼容级别。

即使 **View → Status bar** 已隐藏，正在执行的任务仍会显示进度条。按进度条旁的 **Cancel** 可停止导入或音频导出。

## 可编辑的项目文件

- Scape（Soundscaper 使用 `.sscape`，Framescaper 使用 `.fscape`，两种格式都可在任一产品中打开）是 Soundscaper 和 Framescaper 共用的便携式无损项目格式。
- AUP3 和 AUP4 可与 Audacity 交换音频。选择 AUP3 使用 Audacity 3.7.9 项目配置，或选择 AUP4 使用当前交换配置。两者都不是混合媒体 Soundscaper 项目的完整备份；导出后请检查兼容性报告。
- 桌面版可以打开 Adobe Audition SESX (`.sesx`) 会话，从引用的音频文件创建本地项目。请保留原始会话和媒体；目前不支持导出 SESX。

请参阅[项目文件](/projects-and-data/project-files/)，了解每种选择的影响。

## 渲染后的交付文件

音频导出会创建用于聆听、发布或后续处理的文件。视频导出会创建 MP4 或 WebM 文件。渲染后的文件不会保留可编辑的时间轴、路由、效果或项目历史记录。

请参阅[参考资料](/reference/)中的格式表和产品功能表。
