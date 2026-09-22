---
title: "Limpar uma gravação de voz"
description: "Remova o zumbido de uma gravação, corte o ruído grave, ajuste o volume para o padrão de podcast e exporte um MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. It lands as a clip on its own track.\",\"text\":\"Choose File → Import and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. It lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"96727487ae82c7f76b646047856630f73eb756ee7832615587e24e1e6db0b0ee","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"96727487ae82c7f76b646047856630f73eb756ee7832615587e24e1e6db0b0ee","targetLocale":"pt-BR"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

A maioria das gravações feitas em casa precisa dos mesmos três reparos: remover um ruído de fundo constante, filtrar um ruído grave e elevar o nível ao padrão. Este tutorial faz os três em uma gravação de exemplo de três segundos cuja primeira metade do segundo é apenas ruído ambiente e depois exporta o resultado como MP3.

:::tip[O que você precisará]
- Baixe [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — uma gravação curta cuja primeira metade do segundo é ruído ambiente antes de a voz começar.

Cada etapa abaixo funciona nesses arquivos exatamente como estão, portanto o que você vê deve corresponder ao que o tutorial diz. O Soundscaper roda no navegador; nada precisa ser instalado.
:::

## O que você aprenderá

- Por que a Redução de ruído precisa de um perfil e como fornecê-lo.
- O que um filtro passa-alta remove e onde ajustá-lo para voz.
- A diferença entre nível de pico e intensidade e como atingir uma meta de intensidade.
- Como exportar um MP3.

## Passos

1. Abra o Soundscaper. Um novo projeto vazio estará pronto assim que o editor carregar.
2. Escolha **Arquivo → Importar** e selecione `guide-noisy-take.wav` — uma gravação curta cuja primeira metade do segundo é ruído ambiente antes de a voz começar. Ela será colocada como um clipe em sua própria faixa.
3. Pressione **Reproduzir** para ouvir, depois **Parar**.
   *Você deve ver:* Meio segundo de chiado, depois um tom constante representando uma voz, com o chiado por baixo.
4. Arraste na régua acima do clipe, do início até a marca de 15%, para selecionar a introdução que contém apenas ruído. O perfil não pode conter nada além do ruído que você quer remover — nenhuma voz.
5. Escolha **Efeito → Remoção e reparo de ruído → Redução de ruído** e pressione **Obter perfil de ruído**. A linha de status informa que o perfil está pronto. Pressione **Fechar** para sair da caixa de diálogo por enquanto.
6. Escolha **Selecionar → Selecionar tudo**. O perfil é mantido; agora o efeito precisa saber o que limpar.
7. Escolha **Efeito → Remoção e reparo de ruído → Redução de ruído**. Na caixa de diálogo **Redução de ruído**, defina **Redução de ruído** como `12` e pressione **Aplicar à seleção**. Doze decibéis é um bom primeiro ajuste. Mais redução remove mais ruído, mas deixa as vozes ocas.
   *Você deve ver:* A introdução fica quase plana e o tom permanece intacto.
8. Escolha **Efeito → Efeitos legados → Filtros clássicos**. Na caixa de diálogo **Filtros clássicos**, escolha **Passa-alta** para **Tipo de filtro** e defina **Frequência de corte** como `100`; depois pressione **Aplicar à seleção**. Tudo abaixo de 100 Hz — trânsito, manuseio e ar-condicionado — é atenuado. A fala fica bem acima dessa faixa.
9. Escolha **Efeito → Volume e compressão → Normalização de intensidade**. Na caixa de diálogo **Normalização de intensidade**, defina **Intensidade alvo** como `-16` e pressione **Aplicar à seleção**. −16 LUFS é a meta comum para podcasts estéreo. A intensidade mede o quão alto o take inteiro parece, não a altura de seus picos.
   *Você deve ver:* A forma de onda fica mais alta e a gravação é reproduzida em um nível confortável.
10. Pressione **Reproduzir** para ouvir, depois **Parar**.
   *Você deve ver:* Uma gravação limpa e nivelada, com uma introdução silenciosa.
11. Escolha **Arquivo → Exportar áudio**, defina **Formato** como **MP3** e pressione **Exportar**. O arquivo é baixado assim que a renderização termina, e seu link permanece na caixa de diálogo. O arquivo é codificado no navegador; nada sai do seu computador.

## Próximos passos

- Faça o mesmo em sua própria gravação com os guias: [Remover ruído de fundo](/guides/cleaning-up/remove-background-noise/), [Remover ruído grave](/guides/cleaning-up/remove-low-rumble/) e [Normalizar a intensidade para um podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Confira o resultado como uma plataforma faria: [Medir a intensidade da sua mixagem](/guides/analysis/measure-loudness/).

## Outros tutoriais

[Seu primeiro projeto Soundscaper](/tutorials/your-first-project/) — Importe uma gravação, ouça, divida, aplique um desvanecimento de saída, exporte um arquivo e salve o projeto.
[Colocar música sob uma voz](/tutorials/put-music-under-a-voice/) — Sobreponha duas faixas, reduza automaticamente uma sob a outra, faça a mixagem e exporte.

## Referência

- [Todos os parâmetros dos efeitos usados aqui, com seus valores padrão e intervalos, estão na referência de efeitos de áudio.](/reference/generated/audio-effects/#parameters)
- [Os formatos de exportação, seus contêineres e limites de canais estão na referência de formatos de exportação.](/reference/generated/formats/)
- [Todo comando de menu e seu atalho de teclado estão na referência de comandos e atalhos.](/reference/generated/commands/)

## Sobre este tutorial

Este tutorial é reproduzido, passo a passo e nesses mesmos arquivos, em cada compilação do Soundscaper pelo conjunto de navegadores (`tests/browser/soundscaper-tutorials.spec.js`). Se uma etapa parar de funcionar, a compilação falha até que o tutorial seja corrigido; portanto, o que você lê é o que o editor faz.
