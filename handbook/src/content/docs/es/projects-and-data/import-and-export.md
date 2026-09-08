---
title: "Importación y exportación"
description: "Distinga los medios de origen, los archivos del proyecto, los archivos de intercambio y las entregas renderizadas."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","targetLocale":"es"} -->

Soundscaper utiliza diferentes tipos de archivos para diferentes tareas.

## Medios de origen

Utilice **Archivo → Importar** para audio, video y etiquetas. La pista de sugerencias del editor actual enumera
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF y WebM; se admiten contenedores de video adicionales a través de la ruta de importación de video. La disponibilidad puede depender
de el producto activo y el tiempo de ejecución.

Importar medios agrega un origen propiedad del proyecto. No hace que el archivo original sea
documento editable del proyecto.

## Archivos de proyecto editables

- Scape (`.sscape` desde Soundscaper, `.fscape` desde Framescaper, y cualquiera de los dos se puede abrir en ambos) es el formato de proyecto de alta fidelidad portátil compartido por Soundscaper
y Framescaper.
- AUP4 es un intercambio de solo audio con Audacity. No es una copia de seguridad completa de un
proyecto de Soundscaper multimedia.

Consulte [Archivos de proyecto](/projects-and-data/project-files/) para las consecuencias
de cada elección.

## Entregas renderizadas

Las exportaciones de audio crean archivos destinados a la escucha, publicación o
procesamiento adicional. Las exportaciones de video crean entregas MP4 o WebM. Un archivo renderizado no
retiene la línea de tiempo editable, el enrutamiento, los efectos o el historial del proyecto.

Consulte la sección [referencia](/reference/) para las tablas de formato generado y
capacidades del producto.
