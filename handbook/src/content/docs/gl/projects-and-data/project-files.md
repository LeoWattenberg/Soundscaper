---
title: "Ficheiros do proxecto"
description: "Escolle entre a biblioteca local, ficheiros Scape, intercambio con Audacity, importación SESX e copias de seguridade renderizadas."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"gl"} -->

## Biblioteca local de proxectos

O editor garda os proxectos de traballo na súa biblioteca local. Nun navegador, isto é un almacenamento privado de orixe; na edición de escritorio, son datos da aplicación. Esta é a copia de traballo cómoda, non a única copia que debes conservar.

## Ficheiros de proxecto de Scape

No escritorio, o audio e o vídeo importados seguen sendo referencias aos seus ficheiros orixinais por defecto. Conserva eses ficheiros nas localizacións orixinais ao volver abrir o proxecto. A biblioteca local tamén garda cachés de edición. As gravacións e os medios xerados ou procesados inclúense porque non teñen un orixinal externo inalterado.

Escolle **Ficheiro → Xestión do proxecto → Consolidar medios** para incluír os medios referenciados no ficheiro do proxecto. A consolidación garda o proxecto inmediatamente; escolle un destino no diálogo de gardado. Unha vez gardada, a copia consolidada pódese mover ou compartir sen os ficheiros multimedia orixinais. Se algún medio non se pode consolidar ou falla o gardado, o editor informa do problema.

As exportacións do navegador inclúen os medios automaticamente. Antes de abrir no navegador un proxecto de escritorio con referencias externas, consolídao no escritorio.


Usa **Ficheiro → Exportar ficheiro de proxecto** para gardar o proxecto de edición. Cada produto escribe o seu propio sufixo: Soundscaper garda `.sscape` e Framescaper
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

## Audacity AUP3 e AUP4

A exportación de proxectos de Audacity está dispoñible en **Ficheiro → Exportar outros**. Escolle **Exportar AUP3** para o perfil de proxecto de Audacity 3.7.9 ou **Exportar AUP4** para o perfil de intercambio actual de Audacity. Cada exportación xera un informe de compatibilidade que describe conversións, efectos non dispoñibles e estados exclusivos de Soundscaper que se omiten.

Ambos formatos son só de audio. O vídeo omítese e non se transfiren as preferencias do navegador, o historial de desfacer, o encamiñamento da mesa de mestura nin a biblioteca de proxectos do navegador. Non uses ningún como única copia de seguridade dun proxecto de Soundscaper ou Framescaper.

## Adobe Audition SESX

Na edición de escritorio, usa **Ficheiro → Abrir** para importar unha sesión Adobe Audition `.sesx`. Mantén os ficheiros de audio referenciados na estrutura de carpetas relativa baixo o cartafol da sesión ou escolle un cartafol de medios cando se solicite. A importación crea un novo proxecto local coas pistas de audio, clips, colocación, recortes, fundidos simples e axustes estáticos da mesa de mestura compatibles.

A importación SESX é unidireccional. Non se transfiren os efectos de Audition, a automatización, o encamiñamento, o vídeo, os marcadores, os bucles, o estiramento, os fundidos cruzados enlazados nin as curvas exactas de fundido. Abre **Ficheiro → Informe de entrega** despois da importación para revisar os medios que faltan e outro contido omitido. Conserva o ficheiro SESX e os medios orixinais para continuar o traballo en Audition.

## Copia de seguridade renderizada

Para traballo importante, conserva ambos:

1. Unha copia do proxecto de Scape (`.sscape` ou `.fscape`) para edición futura.
2. Un ficheiro de audio ou vídeo renderizado que se poida reproducir sen o editor.

Garda eses ficheiros fóra do directorio de datos do navegador ou da aplicación.
