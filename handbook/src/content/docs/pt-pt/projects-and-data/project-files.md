---
title: "Arquivos do projeto"
description: "Escolha entre a biblioteca local, arquivos de projeto Scape, AUP4 e backups renderizados."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"pt-PT"} -->

## Biblioteca local do projeto

O editor salva os projetos de trabalho na sua biblioteca local. Num navegador, isto é
armazenamento privado de origem; na edição de ambiente de trabalho, é dados de aplicação. Esta é
a cópia de trabalho conveniente, não a única cópia que deve guardar.

## Arquivos de projeto Scape

Utilize **Arquivo → Exportar arquivo de projeto** para um projeto portátil sem perdas. Cada
produto escreve o seu próprio sufixo: o Soundscaper salva `.sscape` e o Framescaper
salva `.fscape`, e a entrada do menu nomeia aquele que se aplica. O formato
trazido por ambos é o mesmo, por isso é a escolha apropriada quando precisa
de preservar o estado de edição multimédia.

Qualquer produto abre qualquer sufixo. `.sscape`, `.fscape`, o reservado
`.liscape`, e os mais antigos arquivos `.scape` exportados antes de os produtos terem os seus próprios
sufixos abrem em todo o lado, e salvar um de um produto diferente simplesmente
renomeia-o - por exemplo, um `Mix.sscape` salvo do Framescaper torna-se
`Mix.fscape`. Nada sobre o projeto muda com o nome.

A importação ou abertura de uma cópia Scape pode encontrar um projeto existente com o
mesmo ID. Utilize o fluxo de trabalho de cópia oferecido quando ambas as versões devem permanecer na
biblioteca local.

## AUP4

O AUP4 existe para intercâmbio de áudio compatível com o Audacity. A exportação produz um
relatório de compatibilidade que descreve conversões, efeitos indisponíveis e estado
próprio do Soundscaper omitido.

O AUP4 é apenas áudio. O vídeo é omitido, e as preferências do navegador, o histórico de anulação,
a roteamento do misturador e a biblioteca de projetos do navegador não são transferidos. Não
utilize o AUP4 como a única cópia de segurança de um projeto Soundscaper ou Framescaper.

## Cópia de segurança renderizada

Para trabalhos importantes, mantenha ambos:

1. Uma cópia do projeto Scape (`.sscape` ou `.fscape`) para futura edição.
2. Um ficheiro de áudio ou vídeo renderizado que pode ser reproduzido sem o editor.

Guarde esses arquivos fora do diretório do navegador ou dos dados da aplicação.
