---
title: "Gravar áudio"
description: "Dê permissão de entrada ao editor, escolha as rotas e proteja uma gravação concluída."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"pt-BR"} -->

## Prepare a entrada

1. Abra os controles do dispositivo de gravação e escolha uma entrada disponível.
2. Permita a permissão do microfone ou captura quando o navegador solicitar.
3. Ative o monitoramento de entrada se você precisar inspecionar o nível de entrada antes
   da gravação.
4. Verifique o medidor de gravação e ajuste o dispositivo ou o nível de entrada para evitar
   clipping.

A permissão do navegador é escopo para o site e o dispositivo. Se nenhuma entrada aparecer,
revisar as permissões do sistema operacional e do navegador.

## Grave uma ou várias faixas

Para uma gravação normal, use o menu **Gravar** ou a ação de gravação de transporte.

Para roteamento multitrack, escolha **Visualizar → Ativar gravação multitrack**, arme as
 faixas que você deseja gravar e atribua uma entrada para cada faixa armada. A gravação
não iniciará se nenhuma entrada disponível for atribuída.

O Soundscaper também expõe fluxos de trabalho de gravação com tempo, punch/count-in,
loop/take e ativados por som através de seus menus. Comece com uma tomada normal antes de adicionar
essas condições.

## Após a tomada

Pare de gravar e reproduza o novo clipe antes de continuar. Aguarde o status do projeto
relatar que a salvagem está completa. Para material irrecuperável, exporte uma
cópia de áudio renderizada e um `.sscape` projeto em vez de confiar apenas na
biblioteca local.
