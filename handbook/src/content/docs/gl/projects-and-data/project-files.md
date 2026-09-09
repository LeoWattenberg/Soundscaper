---
title: "Ficheiros do proxecto"
description: "Escolle entre a biblioteca local, os ficheiros de proxecto de Scape, AUP4 e as copias de seguridade renderizadas."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"gl"} -->

## Biblioteca local de proxectos

O editor garda os proxectos de traballo na súa biblioteca local. Nun navegador, isto é un almacenamento privado de orixe; na edición de escritorio, son datos da aplicación. Esta é a copia de traballo cómoda, non a única copia que debes conservar.

## Ficheiros de proxecto de Scape

Usa **Ficheiro → Exportar ficheiro de proxecto** para un proxecto portátil sen perda. Cada produto escribe o seu propio sufixo: Soundscaper garda `.sscape` e Framescaper
 Garda `.fscape`, e a entrada do menú indica cal dos dous se aplica. O formato
 detrás de ambos é o mesmo, polo que é a opción adecuada cando necesites
 conservar o estado de edición multimedia mixta.

Cualquera dos dous produtos abre calquera dos dous sufixos. `.sscape`, `.fscape`, o reservado
`.liscape`, e os ficheiros máis antigos `.scape` exportados antes de que os produtos tivesen os seus propios
sufixos, todos se abren en todas partes, e gardar un desde un produto diferente simplemente
o renomea — por exemplo, un `Mix.sscape` gardado desde Framescaper convértese en
`Mix.fscape`. Nada do proxecto cambia co nome.

Importar ou abrir unha copia de Scape pode atopar un proxecto existente co
mesmo ID. Usa o fluxo de copia ofrecido cando ambas as versións deben permanecer na
biblioteca local.

## AUP4

AUP4 existe para o intercambio de audio compatible con Audacity. A exportación produce un
informe de compatibilidade que describe as conversións, os efectos non dispoñibles e o estado
exclusivo de Soundscaper omitido.

AUP4 é só audio. O vídeo omítese, e as preferencias do navegador, o historial de desfacer,
a enrutación da mesa de mestura e a biblioteca de proxectos do navegador non se transfiren. Non
uses AUP4 como única copia de seguridade dun proxecto de Soundscaper ou Framescaper.

## Copia de seguridade renderizada

Para traballo importante, conserva ambos:

1. Unha copia do proxecto de Scape (`.sscape` ou `.fscape`) para edición futura.
2. Un ficheiro de audio ou vídeo renderizado que se poida reproducir sen o editor.

Garda eses ficheiros fóra do directorio de datos do navegador ou da aplicación.
