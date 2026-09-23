---
title: "编辑器皮肤"
description: "选择一种视觉皮肤，或通过网址临时试用。"
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"zh-CN"} -->

皮肤会更改编辑器的颜色、字体、边框和装饰背景。Soundscaper 和 Framescaper 均提供皮肤。每款产品会分别记住自己的选择。工作区仍控制面板和工具的排列方式。

## 选择皮肤 {#choose-a-skin}

打开 **Edit → Preferences → Appearance**，然后选择一种皮肤：

- **Default** 保留编辑器的原始设计。
- **Sakura** 采用樱花、粉色点缀和圆润字体。
- **Lilac** 使用冷紫色和层叠的紫罗兰纹理。
- **Techno** 将蓝色电路图案与等宽字体相结合。

请另行选择 **Light**、**Dark** 或 **Follow system theme**。每种皮肤都有浅色和深色版本。**Clip style** 是单独的设置；Colorful 配色会与各皮肤协调，同时让片段颜色彼此区分。

高对比度优先于皮肤装饰。关闭高对比度后，会恢复所选皮肤。更改皮肤不会影响片段音频、项目内容或工作区布局。

## 通过链接试用皮肤 {#try-a-skin-from-a-link}

在编辑器网址中添加 `?useskin=sakura`，即可临时预览 Sakura。参数值可使用 `default`、`sakura`、`lilac` 或 `techno`。如果网址已有查询参数，请改为附加 `&useskin=sakura`。未知值会被忽略。

网址预览不会替换已保存的皮肤，即使你更改了其他偏好设置也是如此。重新载入预览网址仍会显示预览；访问不带该参数的网址时，则会使用已保存的选择。此参数不会选择浅色或深色主题。

在 **Preferences → Appearance** 中选择 **Keep this skin** 可保存预览，选择 **End preview** 可返回已保存的皮肤。选择任何皮肤也会保存该选择并结束预览。这些操作只会从当前网址移除皮肤参数，不会重新载入编辑器。
