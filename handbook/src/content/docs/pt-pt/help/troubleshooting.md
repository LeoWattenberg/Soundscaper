---
title: "Resolução de problemas"
description: "Resolva problemas comuns de gravação, armazenamento, importação e exportação."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"pt-PT"} -->

## Falta uma entrada de gravação

Verifique as permissões do microfone no sistema operativo e no navegador e, em
seguida, volte a abrir o seletor de dispositivos. Para gravar várias faixas,
confirme que cada faixa armada tem uma entrada disponível atribuída.

## Um comando está desativado

Muitos comandos dependem do estado atual. Selecione o projeto, a faixa, o clipe
ou o intervalo de tempo necessário e tente novamente. Uma funcionalidade também
pode estar deliberadamente limitada ao Soundscaper ou ao Framescaper.

## Uma importação consome demasiada memória

A descodificação de ficheiros comprimidos e algumas operações de grandes
dimensões podem exigir bastante memória temporária, apesar de o áudio do projeto
estar dividido em blocos. Feche os separadores ou as aplicações que não está a
utilizar, tente novamente com um ficheiro de origem mais pequeno ou, se for
adequado, use a edição para computador.

## Um projeto desapareceu do navegador

Confirme que abriu o mesmo perfil do navegador, a mesma origem e o mesmo site do
produto. O Soundscaper e o Framescaper partilham a biblioteca na mesma origem
`soundscaper.org`, mas outro domínio, perfil do navegador ou armazenamento do
site limpo terá uma biblioteca diferente.

Se os dados do site tiverem sido limpos e não existir uma exportação de projeto
Scape, o editor não tem uma cópia na nuvem que possa restaurar.

## O AUP4 omitiu parte do projeto

Leia o relatório de compatibilidade. O AUP4 transporta o estado de edição de
áudio compatível, mas omite o vídeo e pode converter ou omitir efeitos e o
estado de mistura exclusivo do Soundscaper. Para transferir o projeto completo,
use um ficheiro de projeto Scape — `.sscape` ou `.fscape`; ambos podem ser
abertos em qualquer um dos produtos.

## Uma exportação falha ou não é reproduzida

Tente novamente depois de confirmar que o intervalo selecionado contém
material reproduzível. Para áudio ou vídeo comprimido, verifique se os recursos
de execução podem ser carregados. Depois de uma exportação bem-sucedida, teste o
ficheiro noutra aplicação de reprodução.

Se o problema persistir, use **Ajuda → Suporte** para contactar o responsável
pela manutenção e indique o produto, a plataforma, a versão do navegador ou da
aplicação para computador, os passos para reproduzir o problema e a mensagem de
erro exata.
