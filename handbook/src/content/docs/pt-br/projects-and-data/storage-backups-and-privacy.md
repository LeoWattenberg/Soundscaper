---
title: "Armazenamento, backups e privacidade"
description: "Entenda o armazenamento local-first e proteja os projetos de perdas no navegador ou dispositivo."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"pt-BR"} -->

## O que significa local-first

Projetos, gravações e mídias importadas são processados e armazenados no seu
dispositivo. O editor não requer uma conta ou sincroniza projetos com um
serviço Soundscaper.

Na web, áudio e mídia usam o sistema de arquivos de origem privado do navegador quando
disponível, com IndexedDB como fallback. O Soundscaper solicita armazenamento persistente,
mas o navegador decide se deve ou não concedê-lo.

## O que pode remover um projeto

- Limpar dados do site remove a biblioteca de projetos local do navegador.
- Contextos de navegador privados ou restritos podem cair em memória temporária.
- As políticas de cota e exclusão do navegador permanecem autoritárias.
- Remover manualmente os dados do aplicativo de desktop remove sua biblioteca local.
- Uma falha no dispositivo ou no armazenamento pode remover todas as cópias locais nesse dispositivo.

A desinstalação de uma versão empacotada do desktop é projetada para preservar sua biblioteca, mas
isso não é uma estratégia de backup.

## Rotina de backup

Em marcos úteis e antes de limpar ou migrar o armazenamento:

1. Aguarde a conclusão do salvamento local.
2. Exporte um arquivo de projeto Scape (`.sscape` ou `.fscape`).
3. Exporte e reproduza uma entrega renderizada.
4. Copie ambos para o armazenamento fora dos dados locais do editor.

Use AUP4 além disso quando a troca Audacity for importante, não em vez da
cópia do projeto Scape.

## Privacidade do site de documentação

Este manual é servido como arquivos estáticos e usa pesquisa local do navegador. O site V1 não adiciona um serviço de análise ou um backend de AI/pesquisa.

A política completa de [privacidade Soundscaper e Framescaper](https://soundscaper.org/privacy/en/)
também abrange a entrega do aplicativo, permissões do dispositivo, downloads opcionais,
verificações de atualização do desktop e conexões Framescaper Web VCR.
