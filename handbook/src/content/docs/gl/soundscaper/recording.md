---
title: "Gravar audio"
description: "Concede permisos de entrada ao editor, elixa as rutas e protexe unha toma completada."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"gl"} -->

## Preparar a entrada

1. Abra os controis do dispositivo de gravación e elixa unha entrada dispoñible.
2. Conceda o permiso de micrófono ou captura cando o navegador o solicite.
3. Active a monitorización da entrada se necesita inspeccionar o nivel entrante antes de gravar.
4. Comprobe o medidor de gravación e axuste o dispositivo ou o nivel de entrada para evitar a saturación.

O permiso do navegador está limitado ao sitio e ao dispositivo. Se non aparece ningunha entrada, revise tanto os permisos do sistema operativo como os do navegador.

## Gravar unha ou varias pistas

Para unha gravación normal, use o menú **Gravar** ou a acción de gravación do transporte.

Para o encamiñamento multipista, elixa **Vista → Activar gravación multipista**, arme as pistas que desexe gravar e asigne unha entrada a cada pista armada. A gravación non comezará se non se asina unha entrada dispoñible.

Soundscaper tamén expón fluxos de traballo de gravación temporizada, punch/count-in, loop/take, e activada por son a través dos seus menús. Comece cunha toma normal antes de engadir estas condicións.

## Despois da toma

Pare a gravación e reprodúa o novo clip antes de continuar. Agarde a que o estado do proxecto informe de que a gardado está completo. Para material insubstituíble, exporte unha copia de audio renderizada e un proxecto `.sscape` en lugar de confiar só na biblioteca local.
