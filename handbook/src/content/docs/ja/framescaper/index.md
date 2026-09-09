---
title: "フレームスケーパー"
description: "ビデオを配置し、画像を合成し、ローカル優先のビデオプロジェクトを配信します。"
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","targetLocale":"ja"} -->

Framescaperは、共有エディターのビデオに焦点を当てたビューです。ビデオプレビュー、ソースモニタリング、ピクチャエフェクト、コンポジティング、ネストされたシーケンス、マルチカメラ作業を重視しています。

SoundscaperとFramescaperは、互いのプロジェクトファイルを開くことができます：`.sscape`、`.fscape`、および古い`.scape`は両方で動作します。詳細なオーディオ制作と録音にはSoundscaperを使用し、次にプロジェクトをFramescaperに戻して画像作業を行います。

## 配置

Framescaperは画像を管理します：ビデオのインポート、ソースモニターおよびビデオプレビュー、画像エフェクト、幾何学およびコンポジティング、ネストされたシーケンス、マルチカメラ作業、ビデオ配信。リンクされた画像およびオーディオレーンは、ここでリンクを解除するまで同期されます。

Soundscaperはサウンドを管理します：オーディオ録音、エフェクトおよび分析、ミキシング、オーディオ配信。Framescaperは異なるキャプチャワークフローを使用し、Soundscaperのオーディオ録音ツールセットを公開しないため、Soundscaperで録音し、プロジェクトを戻します。ステップバイステップの[ガイド](/guides/)はSoundscaperに対して記述および検証されており、ビデオプロジェクトのオーディオ側もカバーしています。

## 推奨パス

1. [最初のFramescaperプロジェクトを作成する](/framescaper/first-project/)。
2. [ビデオを準備してエクスポートする](/framescaper/video-export/)。
3. [プロジェクトファイルとバックアップの動作](/projects-and-data/project-files/)を確認します。

ブラウザエディターを[soundscaper.org/framescaper/en](https://soundscaper.org/framescaper/en/)で開きます。