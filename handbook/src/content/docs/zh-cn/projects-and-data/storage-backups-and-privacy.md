---
title: "存储、备份与隐私"
description: "了解本地优先存储并保护项目免受浏览器或设备丢失的影响。"
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"zh-CN"} -->

## 什么是本地优先

项目、录音和导入媒体在您的设备上进行处理和存储。编辑器不需要帐户或将项目同步到 Soundscaper 服务。

在网络上，音频和媒体在可用时使用浏览器的源私有文件系统，IndexedDB 作为备用。Soundscaper 请求持久存储，但浏览器决定是否授予。

## 什么可以删除项目

- 清除站点数据会删除浏览器本地项目库。
- 私人或受限的浏览器上下文可能会回退到临时内存。
- 浏览器配额和驱逐策略仍然具有权威性。
- 手动删除桌面应用程序数据会删除其本地库。
- 设备或存储故障可能会删除该设备上的所有本地副本。

卸载打包的桌面版本旨在保留其库，但这不是备份策略。

## 备份常规

在有用的里程碑和清除或迁移存储之前：

1. 等待本地保存完成。
2. 导出 Scape 项目文件（`.sscape` 或 `.fscape`）。
3. 导出并播放渲染的交付。
4. 将两者复制到编辑器本地数据之外的存储中。

当音频交换格式 Audacity 很重要时，请使用 AUP4，而不是 Scape 项目副本。

## 文档站点隐私

此手册作为静态文件提供，并使用浏览器本地搜索。V1 站点不添加分析服务或 AI/搜索后端。

完整的 [Soundscaper 和 Framescaper 隐私政策](https://soundscaper.org/privacy/en/) 还涵盖了应用程序交付、设备权限、可选下载、桌面更新检查和 Framescaper Web VCR 连接。
