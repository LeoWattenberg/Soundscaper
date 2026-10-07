---
title: "Editar, mesturar e exportar"
description: "Organiza os clips, equilibra as pistas, aplica efectos e crea un ficheiro de entrega."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"gl"} -->

## Ordenar clips

Selecciona clips ou un intervalo de tempo antes de escoller un comando de edición. Split crea un límite de edición na cabeceira de reprodución. As variantes de preservación de espazos e ripple determinan se o material posterior permanece no seu lugar ou se move para pechar a rexión eliminada.

Usa carpetas de pistas, grupos de clips e a Caixa de Proxecto para manter proxectos máis grandes organizados.

### Axustar fundidos de clips {#clip-fades}

Selecciona un clip de audio para revelar pequenos manexos triangulares ao longo da parte superior da súa forma de onda, directamente debaixo da cabeceira do clip.
Arrastra o triángulo esquerdo cara dentro para un fundido de entrada, ou o triángulo dereito cara dentro para un fundido de saída. A forma de onda cambia mentres arrastras, e a área sobre a curva do fundido vese máis escura. Os triángulos seguen os límites do fundido; arrastrar un de volta ao seu canto elimina ese fundido. Só cambia o clip que arrastras, aínda que estean seleccionados varios clips.

Os manexos desaparecen cando deseleccionas o clip, pero a forma de onda fundida e a sombreo permanecen. Estes fundidos preservan o audio orixinal e permanecen axustables despois de gardar e reabrir o proxecto. Solta para confirmar un fundido, ou preme **Escape** mentres arrastras para cancelar. **Deshacer** revirte un arrastre completo. A reprodución e a exportación usan os axustes de fundido confirmados.

Cun clip seleccionado e enfocado, preme **Tab** para chegar aos seus manexos de fundido. As teclas de flecha axustan a duración en 10 milisegundos, ou 100 milisegundos con **Shift**. **Home** elimina o fundido; **End** esténdeo por todo o clip. Para entrada numérica, escolle **Editar → Clips de audio → Propiedades do clip** e usa **Fundidos**.

### Editar a orixe dun clip {#clip-source-properties}

Escolle **Editar → Clips de audio → Propiedades del clip** para abrir el editor de orixe. La grabación completa aparece detrás del clip. Arrastra los bordes del clip para cambiar el inicio de orixe y la duración, manteniendo el comienzo del clip en la liña de tempo del proxecto. O panel **Normalizar** contén la ganancia del clip y las acciones de pico y sonoridad.

Abre **Ton y tempo** y marca **Vincular ton y tempo** para cambiar juntos la velocidade y el ton. Una relación de velocidade de `1` y un cambio de ton de `0%` dejan el sonido sin cambios. La relación `2` reproduce al doble de velocidade y una octava más alto; `0.5` reproduce a la mitad de velocidade y una octava más bajo. Ao cambiar cualquiera de los controles vinculados, se actualiza el otro. Desactivar el vínculo restablece el ajuste independiente de ton y conserva la relación de velocidade actual.

Haz **Ctrl+clic** en la forma de onda para añadir un marcador de estiramiento vinculado a esa muestra de orixe. Al arrastrarlo cambia el tempo a ambos lados; la superposición muestra las dos velocidadees de reprodución. Los controles del clip siguen siendo propios de cada clip. Al seleccionar audio de orixe y aplicarle un efecto, se actualizan todos los clips que usan ese origen.

### Editar clips nunha folla de cálculo {#clip-spreadsheet}

Escolle **Vista → Paneles → Hoja de cálculo de clips** para ver todos los clips del proxecto. O panel se abre debajo de la liña de tempo. Su menú permite moverlo a otro acoplamiento, hacerlo flotante o cerrarlo. El tamaño y la ubicación se guardan con el espazo de trabajo. Cada fila muestra la pista, la posición en la liña de tempo, el ficheiro de orixe, el desplazamiento de orixe, la duración, el ton, la velocidade, la ganancia, los fundidos y las opciones de reprodución. Los tempos se expresan en segundos, el ton en semitons y la velocidade como una relación: `1` es la velocidade normal y `2` es el doble.

Haz doble clic en una celda, o selecciónala y preme **Intro**, para editar su valor. Preme **Intro** para aplicar el cambio o **Escape** para cancelarlo. Las celdas de pista y origen muestran sus ID reales. Cambia el ID de pista para mover un clip a una pista de audio existente. Cambia el ID de orixe o introduce una ruta de ficheiro local para sustituir su audio, conservando su posición en la liña de tempo, duración, velocidade y desplazamiento de orixe en segundos. El ficheiro novo debe contener ese intervalo de orixe. **Invertido** e **Invertido de orden** son caixas; selecciona una celda y preme **Espazo** para alternarla. Los clips de pistas bloqueadas y los clips de vídeo son de solo lectura.

Ao cambiar la duración, se recorta o amplía el intervalo de orixe desde el desplazamiento actual. Cambiar la velocidade conserva el intervalo de orixe, salvo que también pegues una duración. Desagrupa o desvincula los clips antes de cambiar aquí su tempo; ajusta el tempo de los clips estirados en el editor de orixe.

Selecciona una celda, arrastra sobre un intervalo o haz **Mayús+clic** en otra celda para ampliar la selección. Haz clic en un número de fila o encabezado de columna para seleccionar la fila o columna completa. Usa **Ctrl+C** y **Ctrl+V** (**Cmd+C** y **Cmd+V** en macOS) para intercambiar la selección con una hoja de cálculo. Las columnas se separan con tabulaciones y las filas con saltos de línea. Ao pegar, se comeza en la celda seleccionada y se actualizan los clips existentes. Se rechaza un pegado que sobrepase las filas existentes. Con una selección, preme **Escape** o haz clic en el espazo baleiro bajo la tabla para quitarla. Sin selección, el pegado inserta filas novas, incluso en un proxecto baleiro. Las opciones de reprodución se copian como `true` o `false` y aceptan esos valores al pegarlas. Las filas novas siguen el orden de columnas de la tabla y necesitan un nombre de ficheiro de orixe o un ID de orixe. Un nombre de pista existente y único coloca el clip en esa pista; un nombre novo crea una pista de audio. Los nombres de pista baleiros usan el nombre del origen. Las celdas numéricas baleiras toman los valores predeterminados: posición y desplazamiento `0`, velocidade `1`, ton y ganancia `0`, sin fundidos. Si la duración está baleira, se usa el audio restante a la velocidade solicitada.

O panel busca primero el origen en el proxecto, incluida la papelera del proxecto. Si no está, escolle **Cargar ficheiros referenciados** y selecciona los ficheiros de audio que aparecen en el diálogo. Las rutas del disco también requieren seleccionar el ficheiro: pegar una ruta no concede acceso a a aplicación. Los ficheiros seleccionados deben coincidir inequívocamente con los nombres referenciados. O panel importa el audio, valida los límites del origen y las propiedades del clip, y coloca los clips novos en las posiciones indicadas. **Ctrl+Z** (**Cmd+Z** en macOS) deshace un pegado completo en un paso; **Ctrl+Mayús+Z** (**Cmd+Mayús+Z**) lo rehace. Si un pegado contén un valor no válido, los clips no cambian.

## Construír a mestura

Usa os controis de ganancia de pista, panorámica, silencio e solo para equilibrar o proxecto. O panel de Mezclador expón o mesmo estado do proxecto nunha disposición orientada á mestura. Os efectos en tempo real permanecen axustables; as operacións destructivas ou renderizadas crean cambios no proxecto que se poden desfacer mentres a historia estea dispoñible.

Usa o medidor de reprodución e a análise de sonoridade para inspeccionar o resultado. Evita tratar un obxectivo de medidor como substituto de escoitar a exportación completa.

### Escoitar as frecuencias seleccionadas {#listen-to-selected-frequencies}

Selecciona el pasaje que quieras escuchar. En el menú de la pista, escolle **Visualización de pista → Espectrograma** y abre **Opciones de espectrograma → Seleccionar intervalo de frecuencias espectrales**. Introduce las frecuencias mínima y máxima y escolle **Seleccionar intervalo**, o ajusta los controles de selección en el espectrograma.

Escolle **Opciones de reprodución → Reproducir frecuencias seleccionadas** o **Seleccionar → Espectral → Reproducir frecuencias seleccionadas**. El intervalo de tempo seleccionado se reproduce una vez a velocidade normal, aunque antes se eligiera otra velocidade o la reprodución en bucle. El filtro de escucha se aplica a la mezcla actual, incluidos los ajustes de silencio, solo, ganancia y efectos. Un rectángulo espectral señala la banda de frecuencias y el intervalo temporal, pero no pone la pista en solo. Si la reprodución ya está en marcha, el comando la pausa; vuelve a elegirlo para iniciar la escucha filtrada.

Los filtros de frecuencia en tempo real tienen bordes graduales. Las frecuencias fóra de la banda se atenúan, y también pueden atenuarse las pretonas a sus límites. **Pausa** o **Detener** quita el filtro, por lo que la siguiente reprodución normal usa todo el intervalo de frecuencias. El audio, las selecciones, el historial de desfacer y los ficheiros exportados no cambian.

### Reducir sibilancia {#reduce-sibilance}

Escolle **Efecto → Eliminación e reparación de ruído → De-esser**. Establece **Frecuencia** preto da parte áspera da voz, e despois baixa **Limiar** ata que as sibilantes se suavicen. **Redución máxima** limita o corte; comeza arredor de 6–9 dB. Un **Ataque** máis curto captura o inicio dunha consonante, mentres que **Liberación** controla a rapidez coa que as frecuencias altas se recuperan. Só se reduce a banda superior.

### Comprimir bandas de frecuencia separadas {#multiband-compression}

Escolle **Efecto → Volume e compresión → Compresor multibanda**. Os dous cruzamentos dividen a sinal en bandas baixa, media e alta. Cada banda ten o seu propio limiar, relación e ganancia de saída. Unha relación de 1 deixa a dinámica dese banda sen cambios. O ataque e a liberación aplícanse ás tres bandas. Os cruzamentos teñen pendentes suaves e solapadas de 6 dB/octava; con todas as relacións en 1 e as ganancias de banda en 0 dB, a sinal orixinal pasa sen cambios.

Ambos os efectos ligan os seus canles para preservar o equilibrio estéreo e tamén están dispoñibles nos racks de efectos de pista e mestre. Os axustes dos racks gárdanse co proxecto e poden axustarse durante a reprodución. **Aplicar á selección** renderiza o efecto no audio seleccionado e admite Desfacer. A automatización da liña de tempo non está dispoñible para estes dous efectos.

### Usar efectos LADSPA e analizadores Vamp {#native-audio-plugins}

A aplicación de escritorio só pode escanear complementos de terceiros despois de que permitas un formato e un dos seus cartabeis en **Efecto → Xestor de complementos**. O escaneo nunca é automático. Permite cada instalación descuberta antes de usala, e instala só complementos nos que confíes: os complementos nativos executan código executable aínda que Soundscaper os aloxe en procesos auxiliares supervisados.

Os efectos LADSPA están dispoñibles en Linux. Abre un desde **Efecto → Complementos de audio** despois de habilitalo no xestor. Soundscaper constrúe controis a partir dos portos LADSPA porque este formato non ten unha interface do fabricante. Eses valores de control e o estado habilitado ou desactivado do efecto gárdanse co proxecto.

Os complementos Vamp analizan o audio en vez de cambialo. Despois de habilitar unha instalación Vamp, selecciona unha pista de audio para analizar esa pista, ou deixa sen seleccionar ningunha pista de audio para analizar a mestura mestra. Unha selección de tempo limita a análise; en caso contrario, Soundscaper usa o proxecto completo. Escolle **Analizar → Complementos Vamp**, selecciona a saída do analizador e os seus axustes, e despois execútao. Soundscaper engade as marcas de tempo devoltas como unha nova pista de etiquetas só despois de que a análise completa teña éxito, de modo que cancelar ou cambiar o proxecto non pode deixar etiquetas parciais atrás.

## Exportar

Escolle **Ficheiro → Exportar audio** para unha entrega mesturada ou **Exportar audio seleccionado** cando só se debe renderizar unha selección. Soundscaper tamén pode exportar stems e etiquetas.


### Exportar clips como ficheiros separados {#export-clips}

Escolle **Ficheiro → Exportar audio** e configura **Saída** como **Clips individuais (dividir por clips)**. Escolle un formato de audio e preme **Exportar** para descargar un arquivo cun ficheiro por cada clip de audio das pistas de audio do proxecto. Cada ficheiro comeza no inicio audible do clip e remata no seu final audible, sen enchelo ata a liña de tempo do proxecto nin engadir unha cola de efectos. Inclúense os recortes, a ganancia do clip, os esvaecementos e os cambios de velocidade e ton. Os clips solapados seguen separados.

Os ficheiros usan os nomes dos clips con prefixos numerados. Substitúense os caracteres non admitidos nos nomes e os números distinguen os nomes de clip repetidos. Inclúense os efectos das pistas; os efectos mestres, o silencio e o solo non afectan a esta exportación. Desconxela primeiro as pistas conxeladas para exportar por separado os seus clips editables.

Reproduce el ficheiro exportado en otra aplicación antes de entregarlo o eliminar el material de orixe.
Os formatos comprimidos usan o tempo de execución FFmpeg. Os formatos exactos e a dispoñibilidade condicional están listados na [referencia de formatos xerada](/reference/).

### Incrustar etiquetas de capítulo {#embedded-chapters}

En el editor del navegador, escolle **Ficheiro → Exportar audio**, selecciona **MP3** o **AAC / M4A** y activa **Incrustar etiquetas como capítulos** en **Opciones de audio**. La opción está desactivada de forma predeterminada e incluye los títulos y tempos de las etiquetas en un único ficheiro mezclado. Añade etiquetas antes de exportar; esta opción no está disponible para stems, divisiones por capítulos ni secuencias de masterización.

Solo se incluyen las etiquetas que coinciden con el intervalo entregado. Al exportar una selección, los tempos de capítulo se desplazan al inicio del ficheiro resultante. MP3 conserva los tempos finales de las etiquetas de región; una etiqueta puntual termina en el capítulo siguiente o al final del ficheiro. M4A guarda los inicios de capítulo y cada capítulo continúa hasta el inicio siguiente o el final del ficheiro. M4A admite hasta 255 capítulos y 255 bytes UTF-8 por título. Que el reproductor muestre los capítulos incrustados depende del reproductor.

Reproduce o ficheiro exportado noutro aplicativo antes de entregar ou eliminar o material de orixe.
