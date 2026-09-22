---
title: "Solução de problemas"
description: "Resolva problemas comuns de gravação, armazenamento, importação e exportação."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"pt-BR"} -->

## Falta uma entrada de gravação

Verifique as permissões de microfone do sistema operacional e do navegador e reabra o seletor de dispositivos. Para gravação multifaixa, confira se todas as faixas armadas têm uma entrada disponível atribuída.

## Um comando está desativado

Muitos comandos dependem do estado atual. Selecione o projeto, a faixa, o clipe ou o intervalo de tempo necessário e tente novamente. Um recurso também pode estar limitado intencionalmente ao Soundscaper ou ao Framescaper.

## Uma importação usa memória demais

A decodificação comprimida e algumas operações grandes podem precisar de bastante memória temporária, mesmo que o áudio armazenado do projeto seja dividido em blocos. Feche abas ou aplicativos que não estejam relacionados, tente novamente com uma fonte menor ou use a edição para desktop quando apropriado.

## Um projeto desapareceu do navegador

Confirme se você abriu o mesmo perfil do navegador, a mesma origem e o mesmo site do produto. Soundscaper e Framescaper compartilham a biblioteca na mesma origem `soundscaper.org`, mas outro domínio, perfil do navegador ou armazenamento do site limpo terá uma biblioteca diferente.

Se os dados do site foram apagados e não existe uma exportação de projeto Scape, o editor não tem uma cópia na nuvem para restaurar.

## O AUP4 omitiu parte do projeto

Leia o relatório de compatibilidade. O AUP4 transporta o estado compatível de edição de áudio, mas omite vídeo e pode converter ou omitir efeitos e o estado de mixagem exclusivo do Soundscaper. Use um arquivo de projeto Scape — `.sscape` ou `.fscape`, ambos abertos por qualquer um dos produtos — para transferir o projeto completo.

## Uma exportação falha ou não reproduz

Tente novamente depois de confirmar que o intervalo selecionado contém material reproduzível. Para áudio ou vídeo comprimido, verifique se os recursos de execução podem ser carregados. Depois de uma exportação bem-sucedida, teste o arquivo real em outro reprodutor.

Para problemas que continuarem sem solução, use **Ajuda → Suporte** para contatar o mantenedor e inclua o produto, a plataforma, o navegador ou a versão para desktop, os passos e a mensagem exata de erro.
