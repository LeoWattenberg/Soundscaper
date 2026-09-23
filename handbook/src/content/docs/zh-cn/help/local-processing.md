---
title: "本地处理、模型和插件"
description: "按任务查找本地辅助功能，并在桌面版编辑器中管理模型和插件。"
---
<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"zh-CN"} -->

Soundscaper 和 Framescaper 桌面版编辑器会在你的设备上运行本地辅助功能。选择媒体，然后从菜单中选择任务。对话框会显示所选内容、任务设置，以及所需模型是否已安装。

桌面版套件包含已发布本地模型的原生处理引擎。请通过 Model Manager 安装模型权重，然后对所选媒体运行任务。每个模型的[指南](/reference/local-models/)都列出了支持的平台、菜单项和要求。

## 查找任务 {#find-a-task}

| 菜单 | 任务 |
| --- | --- |
| Effect → Noise removal and repair | Enhance Dialogue、Reduce Reverb、Clean Filler & Silence |
| Effect → Source Separation | Separate Dialogue / Music / Effects |
| Analyze → Speech | Transcribe & Captions、Identify Speakers、Mark Reactions |
| Analyze → Music | Detect Beats & Tempo |
| Analyze → Video | Mark Cuts |
| Effect → Video effects | Reframe |
| Edit | Make Highlights |
| Generate | Generate Editorial Text |
| Tools → Search | Indexed Search、Index Transcript、Index Video |

视频任务仅适用于 Framescaper。可用命令取决于桌面运行环境和产品功能。Soundscaper 的字母排序效果菜单选项也会按名称排列本地处理效果。

选择 **Run locally** 开始处理，并回应本地同意提示。处理期间可以取消。选择 **Review result**，选取所需结果，然后选择 **Apply selected**。已接受的项目编辑可以撤销。关闭任务不会应用其建议。

**Tools → Advanced Local Processing** 保留了单独的操作和模型选择器。如有需要，任务对话框中的技术详情会显示底层步骤和确切设置。

## 管理模型 {#manage-models}

打开 **Tools → Model Manager**，或在任务中使用 **Manage Models**。任务中的链接会将列表筛选为兼容的模型；**Show all models** 会清除筛选。按名称或任务搜索，也可按安装状态筛选。

请显式安装模型。下载时会显示进度，也可以取消。返回任务时会保留任务设置并刷新模型可用性，但不会开始处理。展开 **Storage and verification** 可执行修复、清理、存储位置迁移、查看许可证声明，以及从文件夹进行离线安装。

请参阅[各模型指南](/reference/local-models/)，了解每个已发布模型的用途、菜单项、下载大小、要求、限制，以及 nightly-with-tests 桌面版套件执行的实际推理检查。

## 管理插件和设备 {#manage-plugins-and-devices}

**Effect → Plugin Manager** 会列出 Soundscaper 中的音频插件，以及 Framescaper 中的 OpenFX 插件。搜索或筛选列表，然后选择插件以查看其版本、权限和恢复控制项。**Scanning & Settings** 包含发现设置。即使处理功能已禁用，仍可访问插件管理。

通过 **Effect → Audio Plugins** 使用音频插件。Framescaper 的添加或编辑视频效果命令仍位于 **Effect → Video effects** 下。

打开 **Edit → Preferences → Audio settings** 可设置原生音频设备和辅助控件。**Media** 包含原生媒体设置；**Effects** 链接到 Plugin Manager，并包含插件发现开关。插件权限和隔离恢复仍需显式操作。
