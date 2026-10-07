---
title: "Arquivos do projeto"
description: "Escolha entre a biblioteca local, arquivos de projeto Scape, AUP4 e backups renderizados."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"pt-PT"} -->

## Biblioteca local do projeto

O editor salva os projetos de trabalho na sua biblioteca local. Num navegador, isto é
armazenamento privado de origem; na edição de ambiente de trabalho, é dados de aplicação. Esta é
a cópia de trabalho conveniente, não a única cópia que deve guardar.

## Arquivos de projeto Scape

Utilize **Arquivo → Exportar ficheiro de projeto** para guardar o projeto de edição. Cada
produto escreve o seu próprio sufixo: o Soundscaper salva `.sscape` e o Framescaper
salva `.fscape`, e a entrada do menu nomeia aquele que se aplica. O formato
trazido por ambos é o mesmo, por isso é a escolha apropriada quando precisa
de preservar o estado de edição multimédia.

Na aplicação para computador, o áudio e o vídeo importados mantêm-se, por predefinição, como referências aos ficheiros originais. Mantenha esses ficheiros nas localizações originais quando voltar a abrir o projeto. A biblioteca local também guarda caches de edição. As gravações e os ficheiros multimédia gerados ou processados são incluídos, pois não têm um original externo inalterado.

Escolha **Ficheiro → Gestão do projeto → Consolidar multimédia** para incluir os ficheiros multimédia referenciados no ficheiro de projeto. A consolidação guarda imediatamente o projeto; escolha um destino na caixa de diálogo de gravação. Depois de guardada, a cópia consolidada pode ser movida ou partilhada sem os ficheiros multimédia originais. Se não for possível consolidar algum ficheiro ou se a gravação falhar, o editor comunica o problema.

As exportações do navegador incluem automaticamente os ficheiros multimédia. Antes de abrir no navegador um projeto da aplicação para computador com referências externas, consolide-o na aplicação para computador.

Qualquer produto abre qualquer sufixo. `.sscape`, `.fscape`, o reservado
`.liscape`, e os mais antigos arquivos `.scape` exportados antes de os produtos terem os seus próprios
sufixos abrem em todo o lado, e salvar um de um produto diferente simplesmente
renomeia-o - por exemplo, um `Mix.sscape` salvo do Framescaper torna-se
`Mix.fscape`. Nada sobre o projeto muda com o nome.

A importação ou abertura de uma cópia Scape pode encontrar um projeto existente com o
mesmo ID. Utilize o fluxo de trabalho de cópia oferecido quando ambas as versões devem permanecer na
biblioteca local.

## Audacity AUP3 e AUP4

A exportação de projetos do Audacity está disponível em **Ficheiro → Exportar outros**. Escolha **Exportar AUP3** para o perfil de projeto do Audacity 3.7.9 ou **Exportar AUP4** para o perfil de intercâmbio atual do Audacity. Cada exportação gera um relatório de compatibilidade que descreve conversões, efeitos indisponíveis e estados exclusivos do Soundscaper que foram omitidos.

Ambos os formatos contêm apenas áudio. O vídeo é omitido, e as preferências do navegador, o histórico de anulação, o encaminhamento do misturador e a biblioteca de projetos do navegador não são transferidos. Não utilize nenhum dos formatos como única cópia de segurança de um projeto Soundscaper ou Framescaper.

## Adobe Audition SESX

Na edição para computador, utilize **Ficheiro → Abrir** para importar uma sessão Adobe Audition `.sesx`. Mantenha os ficheiros de áudio referenciados na estrutura de pastas relativa abaixo da pasta da sessão, ou escolha uma pasta de ficheiros multimédia quando solicitado. A importação cria um novo projeto local com as faixas de áudio, os clipes, o posicionamento, os recortes, os fades simples e as definições estáticas do misturador que são suportados.

A importação SESX funciona apenas num sentido. Os efeitos do Audition, a automatização, o encaminhamento, o vídeo, os marcadores, os ciclos, o alongamento, os crossfades ligados e as curvas de fade exatas não são transferidos. Abra **Ficheiro → Relatório de entrega** após a importação para rever os ficheiros multimédia em falta e outros conteúdos omitidos. Guarde o ficheiro SESX e os ficheiros multimédia originais para continuar a trabalhar no Audition.

## Cópia de segurança renderizada

Para trabalhos importantes, mantenha ambos:

1. Uma cópia do projeto Scape (`.sscape` ou `.fscape`) para futura edição.
2. Um ficheiro de áudio ou vídeo renderizado que pode ser reproduzido sem o editor.

Guarde esses arquivos fora do diretório do navegador ou dos dados da aplicação.
