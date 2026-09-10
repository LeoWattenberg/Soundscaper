---
title: "Gravar áudio"
description: "Dê permissão de entrada ao editor, escolha as rotas e proteja uma gravação concluída."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"pt-PT"} -->

## Preparar a entrada

1. Abra os controlos do dispositivo de gravação e escolha uma entrada disponível.
2. Permita a permissão do microfone ou captura quando o navegador solicitar.
3. Ative o monitoramento de entrada se precisar de inspecionar o nível de entrada antes
   da gravação.
4. Verifique o medidor de gravação e ajuste o dispositivo ou o nível de entrada para evitar
   clipping.

A permissão do navegador é limitada ao site e ao dispositivo. Se nenhuma entrada aparecer,
revisar as permissões do sistema operativo e do navegador.

## Gravar uma ou várias faixas

Para uma gravação normal, utilize o menu **Gravar** ou a ação de gravação de transporte.

Para roteamento multicanal, escolha **Ver → Ativar gravação multicanal**, arme as
faixas que pretende gravar e atribua uma entrada a cada faixa armada. A gravação
não iniciará se nenhuma entrada disponível for atribuída.

O Soundscaper também expõe fluxos de trabalho de gravação cronometrados, punch/count-in,
loop/take e ativados por som através dos seus menus. Comece com uma tomada normal antes de adicionar
estas condições.

## Após a tomada

Pare a gravação e reproduza o novo clipe antes de continuar. Aguarde que o estado do projeto
relate que a gravação está completa. Para material irrecuperável, exporte uma
cópia de áudio renderizada e um projeto `.sscape` em vez de confiar apenas na
biblioteca local.
