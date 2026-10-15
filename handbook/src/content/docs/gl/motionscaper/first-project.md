---
title: "O seu primeiro proxecto de movemento"
description: "Cree unha composición, anime unha capa e exporte un proxecto gardado."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"gl"} -->

## Crear e engadir unha capa {#create-and-add-a-layer}

1. Escolla **Ficheiro → Nova composición** e introduza título, dimensións,
   frecuencia de fotogramas e duración en fotogramas.
2. Escolla **Capa → Novo texto** ou **Capa → Novo sólido**. Escolla a composición
   de destino cando o proxecto conteña varias composicións.
3. Abra **Capa → Texto e aspecto** para editar unha capa de texto existente ou os
   recheos e trazos dunha forma. Os tipos de letra importados aquí consérvanse co proxecto.

Use **Ficheiro → Importar medios** para fontes de imaxe, vídeo ou son.
Unha importación que supera os límites actuais do descodificador ou da memoria
rexéitase cunha explicación; o ficheiro de orixe segue intacto.

## Animar e previsualizar {#animate-and-preview}

Abra **Capa → Propiedades e fotogramas clave** para escoller unha propiedade de
capa e engadir claves en posicións exactas de fotogramas. Os controis de curva
cambian a interpolación; a edición espacial cambia os camiños de posición.
**Ver → Liña de tempo** abre os controis de temporización, orde e agrupación de
capas e de área de traballo.

Abra **Ver → Lenzo da composición** para seleccionar e mover unha capa 2D
estática. O cadrado escálaa e o círculo xíraa arredor da áncora definida.
Cada arrastre completado é un paso de desfacer; Escape cancela o arrastre.
As transformacións animadas e as controladas por expresións seguen en
Propiedades e fotogramas clave.

Abra **Ver → Vista previa da composición** para desprazarse ou reproducir a
composición. A vista previa usa os medios de orixe conservados. Os axustes de
escena non compatibles ou non válidos producen un erro en vez dunha imaxe
substituta. Peche a vista previa para liberar os seus recursos activos de renderización.

## Gardar unha copia portátil {#save-a-portable-copy}

Escolla **Ficheiro → Gardar** para publicar a revisión actual e despois
**Ficheiro → Gardar copia** para descargar un arquivo `.mscape`. O arquivo inclúe
o proxecto e os medios orixinais necesarios para reabrilo. Ábrao con
**Ficheiro → Abrir** noutro dispositivo ou desde unha biblioteca nova do navegador.

## Renderizar {#render}

Escolla **Ficheiro → Renderizar**. Seleccione composición, formato de saída e
intervalo de fotogramas. O fotograma final exclúese: os fotogramas 0 a 29 usan o
intervalo de `0` a `30`. Unha área de traballo fraccionaria selecciona os tempos
de mostra enteiros que contén; unha área sen mostras de saída debe cambiarse
antes de renderizar.

Use **Secuencia PNG transparente (.tar)** para alfa. Extraia o arquivo TAR para
obter imaxes PNG normais e metadatos de temporización. MP4 e WebM usan a cor de
fondo seleccionada no diálogo. A renderización fixa a revisión enviada para que
as edicións posteriores non alteren unha saída xa en curso. Pechar o diálogo de
renderización mantén o traballo en marcha. **Ficheiro → Cola de renderización**
mostra o progreso, a cancelación, a repetición da revisión enviada e as descargas
completadas. Pechar o editor cancela os traballos inacabados.

Volver ao [manual de Motionscaper](/motionscaper/).
