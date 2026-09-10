---
title: "インポートとエクスポート"
description: "ソースメディア、プロジェクトファイル、交換ファイル、レンダリング済み納品物を区別します。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","targetLocale":"ja"} -->

Soundscaperは、異なる用途に応じて異なるファイルタイプを使用します。

## ソースメディア

オーディオ、ビデオ、ラベルには**ファイル → インポート**を使用します。現在のエディタのヒントには、AUP/AUP3/AUP4、WAV、MP3、FLAC、Opus、OGG、M4A、AIFF、WebMが記載されています。追加のビデオコンテナは、ビデオインポートパスによってサポートされています。利用可能性は、アクティブなプロダクトとランタイムによって異なる場合があります。

メディアのインポートにより、プロジェクト所有のソースが追加されます。元のファイルを編集可能なプロジェクト文書にするものではありません。

## 編集可能なプロジェクトファイル

- Scape（Soundscaperからの`.sscape`、Framescaperからの`.fscape`、およびどちらでも開けるもの）は、SoundscaperとFramescaperで共有される、ポータブルで完全な忠実度のプロジェクト形式です。
- AUP4は、Audacityとのオーディオ専用の相互運用です。これは、ミックスメディアのSoundscaperプロジェクトの完全なバックアップではありません。

各選択の結果については、[プロジェクトファイル](/projects-and-data/project-files/)を参照してください。

## レンダリングされた成果物

オーディオエクスポートは、聴取、公開、またはさらなる処理を目的としたファイルを作成します。ビデオエクスポートは、MP4またはWebMの成果物を作成します。レンダリングされたファイルは、編集可能なタイムライン、ルーティング、エフェクト、プロジェクト履歴を保持しません。

生成される形式とプロダクト機能のテーブルについては、[リファレンスセクション](/reference/)を参照してください。
