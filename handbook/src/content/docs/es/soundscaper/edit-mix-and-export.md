---
title: "Editar, mezclar y exportar"
description: "Organiza los clips, equilibra las pistas, aplica efectos y crea un archivo de entrega."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"es"} -->

## Organizar clips

Selecciona clips o un rango de tiempo antes de elegir un comando de edición. Split crea un límite de edición en la posición del cabezal de reproducción. Las variantes con preservación de huecos y ripple determinan si el material posterior permanece en su lugar o se mueve para cerrar la región eliminada.

Usa carpetas de pistas, grupos de clips y el Project Bin para mantener organizados los proyectos más grandes.

### Ajustar fundidos de clips {#clip-fades}

Selecciona un clip de audio para revelar pequeños manejadores triangulares a lo largo de la parte superior de su forma de onda, justo debajo del encabezado del clip.
Arrastra el triángulo izquierdo hacia adentro para un fundido de entrada, o el triángulo derecho hacia adentro para un fundido de salida. La forma de onda cambia mientras arrastras, y el área sobre la curva del fundido se vuelve más oscura. Los triángulos siguen los límites del fundido; arrastrar uno de vuelta a su esquina elimina ese fundido. Solo se modifica el clip que arrastras, incluso cuando varios clips están seleccionados.

Los manejadores desaparecen cuando deseleccionas el clip, pero la forma de onda con fundido y el sombreado permanecen. Estos fundidos preservan el audio original y siguen siendo ajustables después de guardar y reabrir el proyecto. Suelta para confirmar un fundido, o presiona **Escape** mientras arrastras para cancelar. **Deshacer** revierte un arrastre completo. La reproducción y la exportación usan los ajustes de fundido confirmados.

Con un clip seleccionado enfocado, presiona **Tab** para llegar a sus manejadores de fundido. Las flechas ajustan la duración en 10 milisegundos, o 100 milisegundos con **Shift**. **Inicio** elimina el fundido; **Fin** lo extiende a lo largo del clip. Para entrada numérica, elige **Editar → Clips de audio → Propiedades del clip** y usa **Fundidos**.

### Editar el origen de un clip {#clip-source-properties}

Elige **Editar → Clips de audio → Propiedades del clip** para abrir el editor de origen. La grabación completa aparece detrás del clip. Arrastra los bordes del clip para cambiar el inicio de origen y la duración, manteniendo el comienzo del clip en la línea de tiempo del proyecto. El panel **Normalizar** contiene la ganancia del clip y las acciones de pico y sonoridad.

Abre **Tono y tempo** y marca **Vincular tono y tempo** para cambiar juntos la velocidad y el tono. Una relación de velocidad de `1` y un cambio de tono de `0%` dejan el sonido sin cambios. La relación `2` reproduce al doble de velocidad y una octava más alto; `0.5` reproduce a la mitad de velocidad y una octava más bajo. Al cambiar cualquiera de los controles vinculados, se actualiza el otro. Desactivar el vínculo restablece el ajuste independiente de tono y conserva la relación de velocidad actual.

Haz **Ctrl+clic** en la forma de onda para añadir un marcador de estiramiento vinculado a esa muestra de origen. Al arrastrarlo cambia el tiempo a ambos lados; la superposición muestra las dos velocidades de reproducción. Los controles del clip siguen siendo propios de cada clip. Al seleccionar audio de origen y aplicarle un efecto, se actualizan todos los clips que usan ese origen.

### Editar clips en una hoja de cálculo {#clip-spreadsheet}

Elige **Vista → Paneles → Hoja de cálculo de clips** para ver todos los clips del proyecto. El panel se abre debajo de la línea de tiempo. Su menú permite moverlo a otro acoplamiento, hacerlo flotante o cerrarlo. El tamaño y la ubicación se guardan con el espacio de trabajo. Cada fila muestra la pista, la posición en la línea de tiempo, el archivo de origen, el desplazamiento de origen, la duración, el tono, la velocidad, la ganancia, los fundidos y las opciones de reproducción. Los tiempos se expresan en segundos, el tono en semitonos y la velocidad como una relación: `1` es la velocidad normal y `2` es el doble.

Haz doble clic en una celda, o selecciónala y pulsa **Intro**, para editar su valor. Pulsa **Intro** para aplicar el cambio o **Escape** para cancelarlo. Las celdas de pista y origen muestran sus ID reales. Cambia el ID de pista para mover un clip a una pista de audio existente. Cambia el ID de origen o introduce una ruta de archivo local para sustituir su audio, conservando su posición en la línea de tiempo, duración, velocidad y desplazamiento de origen en segundos. El archivo nuevo debe contener ese rango de origen. **Invertido** e **Invertido de orden** son casillas; selecciona una celda y pulsa **Espacio** para alternarla. Los clips de pistas bloqueadas y los clips de vídeo son de solo lectura.

Al cambiar la duración, se recorta o amplía el rango de origen desde el desplazamiento actual. Cambiar la velocidad conserva el rango de origen, salvo que también pegues una duración. Desagrupa o desvincula los clips antes de cambiar aquí su tiempo; ajusta el tiempo de los clips estirados en el editor de origen.

Selecciona una celda, arrastra sobre un rango o haz **Mayús+clic** en otra celda para ampliar la selección. Haz clic en un número de fila o encabezado de columna para seleccionar la fila o columna completa. Usa **Ctrl+C** y **Ctrl+V** (**Cmd+C** y **Cmd+V** en macOS) para intercambiar la selección con una hoja de cálculo. Las columnas se separan con tabulaciones y las filas con saltos de línea. Al pegar, se empieza en la celda seleccionada y se actualizan los clips existentes. Se rechaza un pegado que sobrepase las filas existentes. Con una selección, pulsa **Escape** o haz clic en el espacio vacío bajo la tabla para quitarla. Sin selección, el pegado inserta filas nuevas, incluso en un proyecto vacío. Las opciones de reproducción se copian como `true` o `false` y aceptan esos valores al pegarlas. Las filas nuevas siguen el orden de columnas de la tabla y necesitan un nombre de archivo de origen o un ID de origen. Un nombre de pista existente y único coloca el clip en esa pista; un nombre nuevo crea una pista de audio. Los nombres de pista vacíos usan el nombre del origen. Las celdas numéricas vacías toman los valores predeterminados: posición y desplazamiento `0`, velocidad `1`, tono y ganancia `0`, sin fundidos. Si la duración está vacía, se usa el audio restante a la velocidad solicitada.

El panel busca primero el origen en el proyecto, incluida la papelera del proyecto. Si no está, elige **Cargar archivos referenciados** y selecciona los archivos de audio que aparecen en el diálogo. Las rutas del disco también requieren seleccionar el archivo: pegar una ruta no concede acceso a la aplicación. Los archivos seleccionados deben coincidir inequívocamente con los nombres referenciados. El panel importa el audio, valida los límites del origen y las propiedades del clip, y coloca los clips nuevos en las posiciones indicadas. **Ctrl+Z** (**Cmd+Z** en macOS) deshace un pegado completo en un paso; **Ctrl+Mayús+Z** (**Cmd+Mayús+Z**) lo rehace. Si un pegado contiene un valor no válido, los clips no cambian.

## Crear la mezcla

Usa los controles de ganancia de pista, panorámica, silencio y solo para equilibrar el proyecto. El panel Mezclador expone el mismo estado del proyecto en un diseño orientado a la mezcla. Los efectos en tiempo real siguen siendo ajustables; las operaciones destructivas o renderizadas crean cambios en el proyecto que se pueden deshacer mientras la historia esté disponible.

Usa el medidor de reproducción y el análisis de sonoridad para inspeccionar el resultado. Evita tratar una meta de medidor como un sustituto de escuchar la exportación completa.

### Escuchar las frecuencias seleccionadas {#listen-to-selected-frequencies}

Selecciona el pasaje que quieras escuchar. En el menú de la pista, elige **Visualización de pista → Espectrograma** y abre **Opciones de espectrograma → Seleccionar rango de frecuencias espectrales**. Introduce las frecuencias mínima y máxima y elige **Seleccionar rango**, o ajusta los controles de selección en el espectrograma.

Elige **Opciones de reproducción → Reproducir frecuencias seleccionadas** o **Seleccionar → Espectral → Reproducir frecuencias seleccionadas**. El rango de tiempo seleccionado se reproduce una vez a velocidad normal, aunque antes se eligiera otra velocidad o la reproducción en bucle. El filtro de escucha se aplica a la mezcla actual, incluidos los ajustes de silencio, solo, ganancia y efectos. Un rectángulo espectral señala la banda de frecuencias y el rango temporal, pero no pone la pista en solo. Si la reproducción ya está en marcha, el comando la pausa; vuelve a elegirlo para iniciar la escucha filtrada.

Los filtros de frecuencia en tiempo real tienen bordes graduales. Las frecuencias fuera de la banda se atenúan, y también pueden atenuarse las cercanas a sus límites. **Pausa** o **Detener** quita el filtro, por lo que la siguiente reproducción normal usa todo el rango de frecuencias. El audio, las selecciones, el historial de deshacer y los archivos exportados no cambian.

### Reducir sibilancia {#reduce-sibilance}

Elige **Efecto → Eliminación y reparación de ruido → De-esser**. Establece **Frecuencia** cerca de la parte áspera de la voz, luego baja **Umbral** hasta que las sibilantes se suavicen. **Reducción máxima** limita el corte; comienza alrededor de 6–9 dB. Un **Ataque** más corto captura el inicio de una consonante, mientras que **Liberación** controla la rapidez con la que las frecuencias altas se recuperan. Solo se reduce la banda superior.

### Comprimir bandas de frecuencia separadas {#multiband-compression}

Elige **Efecto → Volumen y compresión → Compresor multibanda**. Los dos filtros de cruce dividen la señal en bandas bajas, medias y altas. Cada banda tiene su propio umbral, relación y ganancia de salida. Una relación de 1 deja la dinámica de esa banda sin cambios. El ataque y la liberación se aplican a las tres bandas. Los filtros de cruce tienen pendientes suaves y superpuestas de 6 dB/octava; con todas las relaciones en 1 y las ganancias de banda en 0 dB, la señal original pasa sin cambios.

Ambos efectos vinculan sus canales para conservar el equilibrio estéreo y también están disponibles en los racks de efectos de pista y de la pista maestra. Los ajustes del rack se guardan con el proyecto y se pueden modificar durante la reproducción. **Aplicar a selección** procesa el efecto en el audio seleccionado y admite deshacer. La automatización de la línea de tiempo no está disponible para estos dos efectos.

### Usar efectos LADSPA y analizadores Vamp {#native-audio-plugins}

La aplicación de escritorio puede buscar complementos de terceros solo después de que habilites un formato y una de sus carpetas en **Efecto → Administrador de complementos**. La búsqueda nunca es automática. Habilita cada instalación encontrada antes de usarla e instala solo complementos de confianza: los complementos nativos ejecutan código aunque Soundscaper los aloje en procesos auxiliares supervisados.

Los efectos LADSPA están disponibles en Linux. Después de habilitarlos en el administrador, abre uno desde **Efecto → Complementos de audio**. Soundscaper crea los controles a partir de los puertos LADSPA, ya que este formato no tiene una interfaz de proveedor. Esos valores de control y el estado habilitado o omitido del efecto se guardan con el proyecto.

Los complementos Vamp analizan el audio en vez de modificarlo. Después de habilitar una instalación Vamp, selecciona una pista de audio para analizarla o deja sin seleccionar ninguna pista para analizar la mezcla maestra. Una selección de tiempo limita el análisis; de lo contrario, Soundscaper usa el proyecto completo. Elige **Analizar → Complementos Vamp**, selecciona la salida del analizador y sus ajustes, y ejecútalo. Soundscaper añade las marcas de tiempo devueltas como una nueva pista de etiquetas solo cuando el análisis termina correctamente, para que cancelar o cambiar el proyecto no deje etiquetas parciales.

## Exportar

Elige **Archivo → Exportar audio** para una entrega mezclada o **Exportar audio seleccionado** cuando solo se deba renderizar una selección. Soundscaper también puede exportar stems y etiquetas.

### Exportar clips como archivos independientes {#export-clips}

Elige **Archivo → Exportar audio** y establece **Salida** en **Clips individuales (dividir por clips)**. Elige un formato de audio y pulsa **Exportar** para descargar un archivo comprimido con un archivo por cada clip de audio de las pistas de audio del proyecto. Cada archivo empieza en el inicio audible del clip y termina en su final audible, sin rellenarlo hasta la línea de tiempo del proyecto ni añadir una cola de efectos. Se incluyen los recortes, la ganancia del clip, los fundidos y los cambios de velocidad y tono. Los clips superpuestos permanecen separados.

Los archivos usan los nombres de los clips con prefijos numéricos. Se sustituyen los caracteres no compatibles de los nombres de archivo y los números distinguen los nombres de clip repetidos. Se incluyen los efectos de pista; los efectos maestros, el silencio y el solo no afectan a esta exportación. Descongela primero las pistas congeladas para exportar por separado sus clips editables.

Los formatos comprimidos usan el tiempo de ejecución FFmpeg. Los formatos exactos y la disponibilidad condicional se enumeran en la [referencia de formatos generada](/reference/).

### Incrustar marcadores de capítulo {#embedded-chapters}

En el editor del navegador, elige **Archivo → Exportar audio**, selecciona **MP3** o **AAC / M4A** y activa **Incrustar etiquetas como capítulos** en **Opciones de audio**. La opción está desactivada de forma predeterminada e incluye los títulos y tiempos de las etiquetas en un único archivo mezclado. Añade etiquetas antes de exportar; esta opción no está disponible para stems, divisiones por capítulos ni secuencias de masterización.

Solo se incluyen las etiquetas que coinciden con el rango entregado. Al exportar una selección, los tiempos de capítulo se desplazan al inicio del archivo resultante. MP3 conserva los tiempos finales de las etiquetas de región; una etiqueta puntual termina en el capítulo siguiente o al final del archivo. M4A guarda los inicios de capítulo y cada capítulo continúa hasta el inicio siguiente o el final del archivo. M4A admite hasta 255 capítulos y 255 bytes UTF-8 por título. Que el reproductor muestre los capítulos incrustados depende del reproductor.


Reproduce el archivo exportado en otra aplicación antes de entregarlo o eliminar el material de origen.
