---
title: "Exportar vídeo"
description: "Validar a sequência composta e criar uma entrega em MP4 ou WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"pt-BR"} -->

## Antes de exportar

- Execute a sequência completa e cada limite de edição.
- Confirme se as faixas visíveis e soloadas produzem a imagem pretendida.
- Verifique se o áudio vinculado permanece sincronizado.
- Confirme o intervalo de exportação e se as legendas ou o áudio devem ser incluídos.

## Criar o arquivo

Abra o diálogo de exportação e selecione um formato de vídeo. O Framescaper suporta a entrega de MP4 e WebM por meio do tempo de execução de vídeo configurado. Escolha as dimensões, taxa de quadros e outras opções adequadas para o destino.

A codificação de vídeo é mais intensiva em recursos do que a reprodução de linha do tempo comum. Mantenha o editor aberto até que a exportação relate a conclusão.

## Verificar a entrega

Abra o arquivo exportado em um player separado. Verifique sua duração, primeiros e últimos quadros, orientação da imagem, sincronização de áudio e legendas esperadas.

O vídeo renderizado não pode substituir o projeto editável. Exporte uma cópia `.fscape` também quando você precisar preservar a linha do tempo e os meios de comunicação do projeto.
