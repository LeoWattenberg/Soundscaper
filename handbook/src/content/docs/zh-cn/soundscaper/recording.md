---
title: "录制音频"
description: "授予编辑器输入权限、选择路由，并妥善保存录制完成的素材。"
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"zh-CN"} -->

## 准备输入

1. 打开录音设备控件，然后选择可用的输入设备。
2. 浏览器询问时，允许使用麦克风或进行录制的权限。
3. 如果要在录制前检查输入电平，请开启输入监听。
4. 检查录音电平表，并调整设备或输入电平，以免发生削波。

浏览器权限按网站和设备分别管理。如果没有显示输入设备，请检查操作系统和浏览器的权限设置。

## 录制一个或多个音轨

普通录音可使用 **Record** 菜单或传输控制栏中的录音操作。

要进行多轨路由，请选择 **View → Enable multi-track recording**，启用要录制的音轨，并为每条已启用的音轨指定输入。未分配可用输入时，录音不会开始。

Soundscaper 还可通过菜单提供定时录音、punch/count-in（穿插录音或预备拍录音）、loop/take（循环录音或多次录音），以及声音触发录音等工作流程。请先尝试普通录音，再添加这些条件。

## 录制完成后

停止录音，并在继续操作前播放新片段。等待项目状态显示保存已完成。对于不可重录的素材，请导出渲染后的音频副本和一个 `.sscape` 项目文件，不要只依赖本地资料库。
