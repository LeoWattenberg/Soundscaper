---
title: "Importación y exportación"
description: "Distinga los medios de origen, los archivos del proyecto, los archivos de intercambio y las entregas renderizadas."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"es"} -->

Soundscaper utiliza diferentes tipos de archivos para diferentes tareas.

## Medios de origen

Utilice **Archivo → Importar** para audio, video y etiquetas. La pista de sugerencia del editor actual enumera
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF y WebM; se admiten contenedores de video adicionales a través de la ruta de importación de video. La disponibilidad puede depender
de el producto activo y la ejecución.

Importar medios agrega un origen propiedad del proyecto. No hace que el archivo original sea
documento editable del proyecto.

Las importaciones y exportaciones de audio comprimido admiten hasta una hora o 1 GB
(1.000.000.000 bytes de archivo), según cuál se alcance primero. Se admite un archivo estéreo de 48 kHz de una hora cuando se ajusta a ese límite de archivo. Los trabajos largos leen,
codifican y guardan en fragmentos; las exportaciones grandes del navegador requieren almacenamiento de archivos privado de origen y suficiente espacio libre. Las importaciones grandes requieren almacenamiento local persistente
para el audio decodificado. Los formatos PCM conservan sus límites separados.

El nivel del navegador cubre MP3, MP2, FLAC, WavPack, Opus y Ogg Vorbis. El soporte AAC/M4A del navegador depende del códec del navegador. Las exportaciones de transmisión de escritorio cubren los seis formatos integrados, con FLAC de 24 bits y WavPack sin pérdidas float32. Las importaciones de escritorio dependen de la disponibilidad del decodificador nativo; MP2 utiliza el nivel de compatibilidad más pequeño. Los proveedores AAC y de compatibilidad conservan sus
límites separados.

Un trabajo activo muestra una barra de progreso incluso cuando **Ver → Barra de estado** está oculta. Elija **Cancelar** junto a la barra para detener una importación o exportación de audio.

## Archivos de proyecto editables

- Scape (`.sscape` desde Soundscaper, `.fscape` desde Framescaper, y cualquiera de los dos se puede abrir en ambos) es el formato de proyecto portátil de alta fidelidad compartido por Soundscaper
y Framescaper.
- AUP4 es un intercambio de audio solamente con Audacity. No es una copia de seguridad completa de un
proyecto de Soundscaper de medios mixtos.

Consulte [Archivos de proyecto](/projects-and-data/project-files/) para las consecuencias
de cada elección.

## Entregas renderizadas

Las exportaciones de audio crean archivos destinados a la escucha, publicación o
procesamiento adicional. Las exportaciones de video crean entregas MP4 o WebM. Un archivo renderizado no
retiene la línea de tiempo editable, enrutamiento, efectos o historial del proyecto.

Consulte la sección [referencia](/reference/) para las tablas de formato generado y
capacidades del producto.
