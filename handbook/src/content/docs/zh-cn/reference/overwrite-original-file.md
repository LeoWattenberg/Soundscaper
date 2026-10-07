---
title: "在桌面版中覆盖导入的文件"
description: "在 Soundscaper 或 Framescaper 中，将编辑后的项目保存到原始媒体文件中。"
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"zh-CN"} -->

在 Soundscaper 和 Framescaper 的 Electron 版本中，选择**文件 → 覆盖文件名**会将完整编辑后的项目导出到最初导入的媒体文件。它使用原始文件支持的导出设置，并立即保存，不会打开导出对话框或文件选择器。音频会保留源格式、采样率和声道数。受支持的 MP4 和 WebM 视频会保留源容器、尺寸和帧率。

通过**文件 → 导入**导入一个媒体文件，完成编辑后选择**文件 → 覆盖文件名**。继续编辑后可以再次执行此操作。时间选区不会限制覆盖范围：始终会渲染整个项目。项目会保留已导入的媒体和编辑历史。

如果项目没有受支持的原始文件、导入了多个原始文件，或正在导入、录音或处理，此命令将不可用。浏览器版本使用常规导出对话框。

如果要选择其他目标位置或更改交付设置，请在 Soundscaper 中选择**文件 → 导出音频**，或在 Framescaper 中选择**文件 → 导出视频**。覆盖会替换原始文件的内容；如果需要未编辑的录音，请另存一份副本。
