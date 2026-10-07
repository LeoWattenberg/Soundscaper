---
title: "Exportar vídeo"
description: "Validar a sequência composta e criar uma entrega em MP4 ou WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"pt-BR"} -->

## Antes de exportar

- Execute a sequência completa e cada limite de edição.
- Confirme se as faixas visíveis e soloadas produzem a imagem pretendida.
- Verifique se o áudio vinculado permanece sincronizado.
- Confirme o intervalo de exportação e se as legendas ou o áudio devem ser incluídos.

## Criar o arquivo

Abra o diálogo de exportação e selecione um formato de vídeo. O Framescaper suporta a entrega de MP4 e WebM por meio do tempo de execução de vídeo configurado. Escolha as dimensões, taxa de quadros e outras opções adequadas para o destino.

A codificação de vídeo é mais intensiva em recursos do que a reprodução de linha do tempo comum. Mantenha o editor aberto até que a exportação relate a conclusão.

## Exportar clipes de áudio separadamente {#export-audio-clips}

Escolha **Arquivo → Exportar vídeo**, selecione um formato de áudio como **WAV** e defina **Saída** como **Clipes individuais (separar por clipe)**. A exportação baixa um arquivo compactado com um arquivo para cada clipe de áudio. Clipes de vídeo são excluídos, e cada arquivo de áudio contém apenas o próprio clipe, incluindo cortes e edições do clipe.

Os arquivos começam no início audível do clipe, sem preenchimento até a posição no projeto nem cauda de efeito. Nomes numerados diferenciam clipes com o mesmo nome.

Os efeitos da faixa são incluídos; efeitos master, mudo e solo não afetam esta exportação. Veja o fluxo de áudio compartilhado em [Exportar clipes como arquivos separados](/soundscaper/edit-mix-and-export/#export-clips).

## Verificar a entrega

Abra o arquivo exportado em um player separado. Verifique sua duração, primeiros e últimos quadros, orientação da imagem, sincronização de áudio e legendas esperadas.

O vídeo renderizado não pode substituir o projeto editável. Exporte uma cópia `.fscape` também quando você precisar preservar a linha do tempo e os meios de comunicação do projeto.
