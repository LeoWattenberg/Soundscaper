---
title: "Importación y exportación"
description: "Distinga los medios de origen, los archivos del proyecto, los archivos de intercambio y las entregas renderizadas."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"es"} -->

Soundscaper utiliza diferentes tipos de archivos para diferentes tareas.

## Medios de origen

Utilice **Archivo → Importar** para audio, video y etiquetas. La pista de sugerencia del editor actual enumera
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF y WebM; se admiten contenedores de video adicionales a través de la ruta de importación de video. La disponibilidad puede depender
de el producto activo y la ejecución.

Importar medios agrega un origen propiedad del proyecto. No hace que el archivo original sea
documento editable del proyecto.

Las exportaciones de audio comprimido y las importaciones del navegador admiten hasta una hora o 1 GB
(1.000.000.000 bytes de archivo), según el límite que se alcance primero. La selección de archivos de escritorio y la importación de audio comprimido no tienen un límite fijo de tamaño o duración por debajo del rango de enteros seguros. Los trabajos largos leen, codifican y guardan en bloques; las grandes exportaciones del navegador requieren almacenamiento de archivos privado de origen y suficiente espacio libre. Las importaciones grandes requieren suficiente almacenamiento local para el audio decodificado. La estructura del formato, la compatibilidad del decodificador y el espacio disponible también pueden limitar una importación.

El nivel del navegador cubre MP3, MP2, FLAC, WavPack, Opus y Ogg Vorbis. El soporte AAC/M4A del navegador depende del códec del navegador. Las exportaciones de transmisión de escritorio cubren los seis formatos integrados, con FLAC de 24 bits y WavPack sin pérdidas float32. Las importaciones de escritorio dependen de la disponibilidad del decodificador; las fuentes MP2 grandes usan el decodificador de paquetes, mientras que las fuentes MP2 más pequeñas usan el nivel de compatibilidad de utilidades.

Un trabajo activo muestra una barra de progreso incluso cuando **Ver → Barra de estado** está oculta. Elija **Cancelar** junto a la barra para detener una importación o exportación de audio.

## Archivos de proyecto editables

- Scape (`.sscape` desde Soundscaper, `.fscape` desde Framescaper, y cualquiera de los dos se puede abrir en ambos) es el formato de proyecto portátil de alta fidelidad compartido por Soundscaper
y Framescaper.
- AUP3 y AUP4 permiten el intercambio de audio con Audacity. Elige AUP3 para el perfil de proyecto de Audacity 3.7.9 o AUP4 para el perfil de intercambio actual. Ninguno es una copia de seguridad completa de un proyecto de Soundscaper con medios mixtos; revisa el informe de compatibilidad después de exportar.
- Las sesiones Adobe Audition SESX (`.sesx`) se pueden abrir en la edición de escritorio para crear un proyecto local a partir de sus archivos de audio referenciados. Conserva la sesión y los medios originales; no se puede exportar a SESX.

Consulte [Archivos de proyecto](/projects-and-data/project-files/) para las consecuencias
de cada elección.

## Entregas renderizadas

Las exportaciones de audio crean archivos destinados a la escucha, publicación o
procesamiento adicional. Las exportaciones de video crean entregas MP4 o WebM. Un archivo renderizado no
retiene la línea de tiempo editable, enrutamiento, efectos o historial del proyecto.

Consulte la sección [referencia](/reference/) para las tablas de formato generado y
capacidades del producto.
