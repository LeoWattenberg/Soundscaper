---
title: "Almacenamento, copias de seguridade e privacidade"
description: "Comprende o almacenamento local-first e protexe os proxectos da perda do navegador ou do dispositivo."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"gl"} -->

## Que significa local-first

Os proxectos, as gravacións e os medios importados trátanse e almacénanse no
teu dispositivo. O editor non require unha conta nin sincroniza os proxectos cun
servizo de Soundscaper.

Na web, o audio e os medios usan o sistema de ficheiros privado de orixe do
navegador cando está dispoñible, con alternativas mediante IndexedDB. Soundscaper
solicita almacenamento persistente, pero é o navegador o que decide se o concede.

## Que pode eliminar un proxecto

- Limpar os datos do sitio elimina a biblioteca local de proxectos do navegador.
- Os contextos de navegador privados ou restrinxidos poden volver a memoria temporal.
- As políticas de cota e desaloio do navegador seguen sendo autoritativas.
- Eliminar manualmente os datos da aplicación de escritorio elimina a súa biblioteca local.
- Un fallo do dispositivo ou do almacenamento pode eliminar todas as copias locais dese dispositivo.

Desinstalar unha versión de escritorio empaquetada está deseñada para preservar a súa biblioteca, pero
iso non é unha estratexia de copia de seguridade.

## Rutina de copia de seguridade

Nos puntos de control útiles e antes de limpar ou migrar o almacenamento:

1. Agarda a que se complete o gardado local.
2. Exporta un ficheiro de proxecto Scape (`.sscape` ou `.fscape`).
3. Exporta e reproduce unha entrega renderizada.
4. Copia ambos a un almacenamento fóra dos datos locais do editor.

Usa AUP4 ademais cando o intercambio con Audacity sexa importante, non en lugar da
copia do proxecto Scape.

## Privacidade do sitio de documentación

Este manual servese como ficheiros estáticos e usa busca local do navegador. O sitio
V1 non engade un servizo de analítica nin un backend AI/search.

A [política de privacidade completa de Soundscaper e Framescaper](https://soundscaper.org/privacy/en/)
tampouco cubre a entrega da aplicación, os permisos do dispositivo, as descargas opcionais,
as comprobacións de actualizacións de escritorio e as conexións de Framescaper Web VCR.
