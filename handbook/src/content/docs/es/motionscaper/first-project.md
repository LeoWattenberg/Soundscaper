---
title: "Su primer proyecto Motion"
description: "Cree una composición, anime una capa y exporte un proyecto guardado."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"es"} -->

## Crear y añadir una capa {#create-and-add-a-layer}

1. Elija **Archivo → Nueva composición** e introduzca un título, dimensiones,
   frecuencia de fotogramas y duración en fotogramas.
2. Elija **Capa → Nuevo texto** o **Capa → Nuevo sólido**. Elija la composición
   de destino cuando el proyecto contenga varias composiciones.
3. Abra **Capa → Texto y apariencia** para editar una capa de texto existente o
   los rellenos y trazos de una forma. Las fuentes importadas aquí se conservan con el proyecto.

Use **Archivo → Importar medios** para fuentes de imagen, vídeo o audio. Una
importación que supere los límites actuales del decodificador o la memoria se
rechaza con una explicación; el archivo fuente original no se modifica.

## Animar y previsualizar {#animate-and-preview}

Abra **Capa → Propiedades y fotogramas clave** para elegir una propiedad de capa
y añadir claves en posiciones exactas de fotogramas. Los controles de curva
cambian la interpolación; la edición espacial cambia las trayectorias de posición.
**Ver → Línea de tiempo** abre los controles de temporización, orden, agrupación
y área de trabajo de las capas.

Abra **Ver → Lienzo de composición** para seleccionar y mover una capa 2D estática.
El cuadrado cambia su escala y el círculo la gira alrededor de su anclaje definido.
Cada arrastre completado es un paso de deshacer; Escape cancela un arrastre.
Las transformaciones animadas y dirigidas por expresiones permanecen en
Propiedades y fotogramas clave.

Abra **Ver → Vista previa de composición** para desplazarse o reproducir la
composición. La vista previa usa los medios fuente conservados. Los ajustes de
escena no admitidos o inválidos producen un error en lugar de una imagen de
sustitución. Cierre la vista previa para liberar sus recursos de renderizado activos.

## Guardar una copia portátil {#save-a-portable-copy}

Elija **Archivo → Guardar** para publicar la revisión actual y después
**Archivo → Guardar copia** para descargar un archivo `.mscape`. El archivo
incluye el proyecto y los medios originales necesarios para reabrirlo. Ábralo
con **Archivo → Abrir** en otro dispositivo o desde una biblioteca nueva del navegador.

## Renderizar {#render}

Elija **Archivo → Renderizar**. Seleccione una composición, un formato de salida
y un intervalo de fotogramas. El fotograma final se excluye: los fotogramas 0 a
29 usan el intervalo de `0` a `30`. Un área de trabajo fraccionaria selecciona
los instantes de muestreo enteros que contiene; debe cambiar un área sin
muestras de salida antes de renderizar.

Use **Secuencia PNG transparente (.tar)** para el alfa. Extraiga el archivo
TAR para obtener imágenes PNG normales y metadatos temporales. MP4 y WebM usan
el color de fondo seleccionado en el diálogo. El renderizado fija la revisión
enviada para que las ediciones posteriores no cambien una salida ya en curso.
Cerrar el diálogo de renderizado mantiene su tarea en ejecución. **Archivo →
Cola de renderizado** muestra el progreso, la cancelación, el reintento de la
revisión enviada y las descargas completadas. Cerrar el editor cancela las tareas sin terminar.

Vuelva al [manual de Motionscaper](/motionscaper/).
