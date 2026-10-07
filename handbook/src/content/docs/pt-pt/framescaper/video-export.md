---
title: "Exportar vídeo"
description: "Validar a sequência composta e criar uma entrega MP4 ou WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"pt-PT"} -->

## Antes de exportar

- Reproduza a sequência completa e cada limite de edição.
- Confirme se as faixas visíveis e soloadas produzem a imagem pretendida.
- Verifique se o áudio ligado permanece sincronizado.
- Confirme o intervalo de exportação e se as legendas ou o áudio devem ser incluídos.

## Criar o ficheiro

Abra o diálogo de exportação e selecione um formato de vídeo. O Framescaper suporta a entrega de MP4 e WebM através do tempo de execução de vídeo configurado. Escolha as dimensões, taxa de quadros e outras opções adequadas ao destino.

A codificação de vídeo é mais intensiva em recursos do que a reprodução normal da linha do tempo. Mantenha o editor aberto até que a exportação relate a conclusão.

## Exportar clips de áudio em separado {#export-audio-clips}

Escolha **Ficheiro → Exportar vídeo**, selecione um formato de áudio como **WAV** e defina **Saída** como **Clips individuais (dividir por clip)**. A exportação transfere um arquivo com um ficheiro por cada clip de áudio. Os clips de vídeo são excluídos e cada ficheiro de áudio contém apenas o respetivo clip, incluindo cortes e edições.

Os ficheiros começam no início audível do clip, sem preenchimento até à posição no projeto nem cauda de efeito. Os nomes numerados distinguem clips com o mesmo nome.

Os efeitos da faixa são incluídos; os efeitos principais, o silêncio e o solo não afetam esta exportação. Consulte o fluxo de áudio comum em [Exportar clips como ficheiros separados](/soundscaper/edit-mix-and-export/#export-clips).

## Verificar a entrega

Abra o ficheiro exportado num reprodutor separado. Verifique a sua duração, os primeiros e últimos quadros, a orientação da imagem, a sincronização de áudio e as legendas esperadas.

O vídeo renderizado não pode substituir o projeto editável. Exporte uma cópia `.fscape` também quando precisar de preservar a linha do tempo e os meios de comunicação do projeto.
