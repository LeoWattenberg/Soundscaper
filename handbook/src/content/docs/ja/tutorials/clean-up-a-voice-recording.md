---
title: "音声録音をクリーンアップする"
description: "録音のハムノイズを除去し、ラッブルをカットして、ポッドキャスト向けの音量に調整し、MP3としてエクスポートします。"
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"ja"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

家庭で録音したほとんどの録音には、同じ3つの修正が必要です。除去すべき安定した背景ノイズ、フィルタリングすべき低い唸り音、そして標準レベルまで引き上げる必要があるレベルです。このチュートリアルでは、最初の0.5秒がルームノイズのみで構成される3秒間のサンプルテイクに対してこれら3つの処理を行い、結果をMP3としてエクスポートします。

:::tip[必要なもの]
- [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) をダウンロードしてください。これは、音声が始まる前の最初の0.5秒がルームノイズである短いテイクです。

以下のすべての手順は、これらのファイルをそのまま使用して動作します。そのため、確認できる内容はチュートリアルの説明と一致するはずです。Soundscaperはブラウザで動作し、インストールは不要です。
:::

## 学ぶこと

- Noise Reduction（ノイズリダクション）にプロファイルが必要な理由と、その設定方法。
- ハイパスフィルタが何を除去し、音声に対してどこに設定すべきか。
- ピークレベルとラウドネスの違い、およびラウドネス目標値に達する方法。
- MP3のエクスポート方法。

## 手順

1. Soundscaperを開きます。エディタが読み込まれた時点で、新しい空のプロジェクトが準備されています。
2. **ファイル → 音声のインポート** を選択し、`guide-noisy-take.wav` を選択します。これは、音声が始まる前の最初の0.5秒がルームノイズである短いテイクです。ファイルは独自のトラック上にクリップとして配置されます。
3. **再生** を押して聴き、その後 **停止** を押します。
   *確認できること:* 0.5秒間のヒスノイズ、その後、その下にヒスノイズが重なる形で、音声を代用する安定したトーン。
4. クリップの上にあるルーラーをドラッグし、開始位置から15%の目盛りまで選択して、ノイズのみのイントロ部分を選択します。プロファイルには、除去したいノイズのみを含める必要があります。音声は一切含めてはいけません。
5. **エフェクト → ノイズ除去と修復 → Noise Reduction** を選択し、**ノイズプロファイルの取得** を押します。ステータス行にプロファイルが準備完了と報告されます。しばらくダイアログを残すために **閉じる** を押します。
6. **選択 → すべて選択** を選択します。プロファイルは保持されます。次に、エフェクトが何をクリーンアップすべきかを知る必要があります。
7. **エフェクト → ノイズ除去と修復 → Noise Reduction** を選択します。**Noise Reduction** ダイアログで、**ノイズリダクション** を `12` に設定し、**選択範囲に適用** を押します。12デシベルは良い初期設定です。値を上げるとより多くのノイズを除去できますが、声が空洞っぽく聞こえるようになります。
   *確認できること:* イントロ部分がほぼフラットになり、トーンは影響を受けていません。
8. **エフェクト → レガシーエフェクト → Classic Filters** を選択します。**Classic Filters** ダイアログで、**フィルタタイプ** に **ハイパス** を選択し、**カットオフ周波数** を `100` に設定して、**選択範囲に適用** を押します。100 Hz未満のすべての音——交通機関、ハンドリング、エアコン——がロールオフされます。音声はこれよりはるかに高い周波数帯域に存在します。
9. **エフェクト → ボリュームと圧縮 → ラウドネス正規化** を選択します。**ラウドネス正規化** ダイアログで、**目標ラウドネス** を `-16` に設定し、**選択範囲に適用** を押します。−16 LUFSはステレオポッドキャストの一般的な目標値です。ラウドネスはピークの高さではなく、テイク全体がどれほど大きく聞こえるかを測定します。
   *確認できること:* 波形が高くなり、テイクが快適なレベルで再生されます。
10. **再生** を押して聴き、その後 **停止** を押します。
   *確認できること:* クリーンでレベルが整ったテイク、そして静かなイントロ部分。
11. **ファイル → 音声のエクスポート** を選択し、**形式** を **MP3** に設定して、**エクスポート** を押します。レンダリングが完了するとすぐにファイルがダウンロードされ、そのリンクはダイアログ内に残ります。ファイルはブラウザ内でエンコードされ、コンピュータの外に送信されることはありません。

## 次のステップ

- 独自のテイクで、ハウツーガイドを使用して試してください：[背景ノイズの除去](/guides/cleaning-up/remove-background-noise/)、[低い唸り音の除去](/guides/cleaning-up/remove-low-rumble/) および [ポッドキャスト向けのラウドネス正規化](/guides/volume/normalize-loudness-for-podcasts/)。
- プラットフォームがそうするように結果を確認してください：[ミックスのラウドネスを測定する](/guides/analysis/measure-loudness/)。

## その他のチュートリアル

[最初のSoundscaperプロジェクト](/tutorials/your-first-project/) — 録音のインポート、再生、分割、フェードアウト、ファイルのエクスポート、プロジェクトの保存。
[音声の下に音楽を配置する](/tutorials/put-music-under-a-voice/) — 2つのトラックを重ね、片方を自動的にダッキングし、ミックスダウンしてエクスポート。

## 参考情報

- [ここで使用されるエフェクトのすべてのパラメータ、そのデフォルト値と範囲は、オーディオエフェクトリファレンスに記載されています。](/reference/generated/audio-effects/#parameters)
- [エクスポート形式、そのコンテナとチャネル制限は、エクスポート形式リファレンスに記載されています。](/reference/generated/formats/)
- [すべてのメニューコマンドとそのキーボードショートカットは、コマンドとショートカットリファレンスに記載されています。](/reference/generated/commands/)

## このチュートリアルについて

このチュートリアルは、ブラウザスイート（`tests/browser/soundscaper-tutorials.spec.js`）によって、これらのファイルに対して、ステップごとに再現されます。手順が動作しなくなると、チュートリアルが修正されるまでビルドは失敗するため、読んでいる内容はエディタが実行する内容と一致します。
