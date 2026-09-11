---
title: "项目文件"
description: "在本地库、Scape项目文件、AUP4和渲染备份之间进行选择。"
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"zh-CN"} -->

## 本地项目库

编辑器将工作项目保存在其本地库中。在浏览器中，这是原点私有存储；在桌面版中，它是应用程序数据。这是方便的工作副本，而不是您应该保留的唯一副本。

## 导出项目文件

使用 **文件 → 导出项目文件** 获得无损可移植项目。每个产品都有自己的后缀：Soundscaper 保存 `.sscape`，Framescaper 保存 `.fscape`，菜单条目命名适用于哪个产品。两种格式相同，因此当您需要保留混合媒体编辑状态时，这是合适的选择。

任一产品都可以打开任一后缀。 `.sscape`, `.fscape`, 保留的 `.liscape`, 和较旧的 `.scape` 文件在所有地方都可以打开，并且从不同产品保存一个文件只是重命名它——例如，从 Framescaper 保存的 `Mix.sscape` 成为 `Mix.fscape`。项目名称不变。

导入或打开 Scape 副本可能会遇到本地库中相同的 ID 的现有项目。当两个版本都必须保留在本地库中时，使用提供的复制工作流程。

## AUP4

AUP4 用于与 Audacity 兼容的音频交换。导出会生成兼容性报告，描述转换、不可用的效果和省略的 Soundscaper 专用状态。

AUP4 仅限音频。视频被省略，浏览器偏好、撤销历史、混音路由和浏览器的项目库不会被传输。不要将 AUP4 作为 Soundscaper 或 Framescaper 项目的唯一备份。

## 渲染备份

对于重要工作，请保留以下内容：

1. Scape 项目副本 (`.sscape` 或 `.fscape`) 用于未来编辑。
2. 渲染的音频或视频文件，可以在不使用编辑器的情况下播放。

将这些文件存储在浏览器或应用程序数据目录之外。
