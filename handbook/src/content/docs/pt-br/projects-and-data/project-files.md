---
title: "Arquivos do projeto"
description: "Escolha entre a biblioteca local, arquivos do projeto Scape, AUP4 e backups renderizados."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"pt-BR"} -->

## Biblioteca local do projeto

O editor salva os projetos em trabalho em sua biblioteca local. Em um navegador, isso é armazenamento privado de origem; na edição de desktop, é dado do aplicativo. Esta é a cópia de trabalho conveniente, não a única cópia que você deve manter.

## Arquivos de projeto Scape

Use **Arquivo → Exportar arquivo do projeto** para um projeto portátil sem perdas. Cada produto escreve seu próprio sufixo: o Soundscaper salva `.sscape` e o Framescaper salva `.fscape`, e a entrada do menu nomeia aquele que se aplica. O formato por trás de ambos é o mesmo, então é a escolha adequada quando você precisa preservar o estado de edição multimídia.

Qualquer produto abre qualquer sufixo. `.sscape`, `.fscape`, o reservado `.liscape`, e os arquivos mais antigos `.scape` exportados antes de os produtos terem seus próprios sufixos abrem em todos os lugares, e salvar um de um produto diferente simplesmente o renomeia - por exemplo, um `Mix.sscape` salvo do Framescaper se torna `Mix.fscape`. Nada sobre o projeto muda com o nome.

Importar ou abrir uma cópia Scape pode encontrar um projeto existente com o mesmo ID. Use o fluxo de trabalho de cópia oferecido quando ambas as versões devem permanecer na biblioteca local.

## AUP4

O AUP4 existe para intercâmbio de áudio compatível com o Audacity. A exportação produz um relatório de compatibilidade descrevendo conversões, efeitos indisponíveis e estado específico do Soundscaper omitido.

O AUP4 é apenas de áudio. O vídeo é omitido, e as preferências do navegador, o histórico de desfazer, o roteamento do mixer e a biblioteca de projetos do navegador não são transferidos. Não use o AUP4 como a única cópia de segurança de um projeto Soundscaper ou Framescaper.

## Backup renderizado

Para trabalhos importantes, mantenha ambos:

1. Uma cópia do projeto Scape (`.sscape` ou `.fscape`) para edição futura.
2. Um arquivo de áudio ou vídeo renderizado que pode ser reproduzido sem o editor.

Armazene esses arquivos fora do diretório do navegador ou dos dados do aplicativo.
