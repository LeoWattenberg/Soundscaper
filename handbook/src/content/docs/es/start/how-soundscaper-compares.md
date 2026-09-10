---
title: "Comparación de Soundscaper"
description: "Compare Soundscaper con Audacity 4 y Adobe Audition en grabación, edición, mezcla, entrega e intercambio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"5b9d7c73cc9a759d623469a935b0c57325920832ea7775ef89dee9cdede4a17f","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5b9d7c73cc9a759d623469a935b0c57325920832ea7775ef89dee9cdede4a17f","targetLocale":"es"} -->

Soundscaper reimplementa Audacity 4 en la web y añade una capa de producción sobre ella. Adobe Audition es la herramienta comercial de postproducción contra la que normalmente se miden ambas. Esta página compara las tres para que puedas determinar cuál ya realiza la tarea que necesitas.

## Cómo leer esta página

Cada celda indica **Sí**, **Parcial** o **No**, seguido del detalle que lo califica.

**Parcial** cubre tres situaciones diferentes, y la nota indica cuál aplica: la capacidad existe pero es más limitada que en otras, existe pero depende de algo que debes proporcionar, o solo es accesible mediante un trabajo de contorno para suplir una ausencia.

Las filas describen capacidades, no comandos de menú. Para el inventario exacto de comandos, consulta [Comandos y atajos](/reference/generated/commands/), y para lo que cada producto habilita, consulta
[Capacidades del producto](/reference/generated/product-capabilities/).

### Origen de estas afirmaciones

- Las filas de **Soundscaper** provienen de este repositorio: los perfiles de capacidades del producto, el manifiesto de acciones de tiempo de ejecución y el registro de formatos de exportación.
  Varias rutas nativas de escritorio están implementadas pero siguen sujetas a cargas de máquina firmadas; esas filas lo indican.
- Las filas de **Audacity 4** provienen del inventario de aguas arriba fijado en este
  repositorio, `4.0.0` en el commit `4c177d43`. Una capacidad que aguas arriba
  registra pero deja deshabilitada o comenta fuera del menú se
  registra como tal, y una capacidad sin registro en la compilación fijada se
  informa como no presente en esa compilación, en lugar de como ausente permanentemente.
- Las filas de **Audition** provienen de la documentación publicada de Adobe para la versión
  actual. No se han verificado contra una compilación en ejecución.

## Plataforma y términos

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licencia | Sí — AGPL-3.0-only | Sí — GPL, código abierto | No — propietaria y cerrada |
| Costo | Sí — gratis | Sí — gratis | No — suscripción a Creative Cloud |
| Se ejecuta en un navegador | Sí — Chromium, Firefox y WebKit | No — solo escritorio | No — solo escritorio |
| Compilaciones de escritorio | Sí — Windows y Linux en x64 y ARM64, macOS en ARM64 | Sí — Windows, macOS, Linux | Parcial — Windows y macOS, sin Linux |
| Funciona sin cuenta | Sí — no existe cuenta | Sí — inicio de sesión solo para audio.com | No — se requiere suscripción iniciada sesión |
| Almacenamiento de proyectos en la nube | No — excluido por el diseño local primero | Sí — guardar y compartir a través de audio.com | Parcial — archivos de Creative Cloud, las sesiones no se sincronizan |
| Requisitos del sistema | Sí — se ejecuta donde se ejecute un navegador actual | Parcial — aumentados sustancialmente respecto a Audacity 3 | Parcial — clase de estación de trabajo profesional |

## Modelo de proyecto y sesión

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Formato de proyecto nativo | Sí — `.sscape`, un archivo portátil sin pérdida | Sí — `.aup4` | Sí — `.sesx` |
| Abre proyectos de Audacity | Sí — importación y exportación de AUP4 | Sí — nativo | No |
| Línea de tiempo de clips no destructiva | Sí | Sí | Sí — editor multicanal |
| Editor de archivo único dedicado | Parcial — la edición de muestras ocurre en la línea de tiempo | Parcial — las ediciones se aplican en el lugar en la línea de tiempo | Sí — editor de forma de onda |
| Contenido mono y estéreo en una pista | Sí — una pista contiene uno u otro | No — una pista es mono o estéreo | No — el formato de canal es fijo por pista |
| Carpetas de pistas anidadas | Sí — cualquier profundidad, reversible, con enrutamiento | No | Parcial — solo buses de submezcla, sin pistas de carpeta |
| Bandeja de proyecto | Sí — organiza archivos y sirve como portapapeles | No | Parcial — el panel de Archivos lista archivos abiertos |
| Autoguardado y recuperación de errores | Sí — autoguardado, bloqueos y sobres de recuperación | Sí | Sí |
| Marcadores y regiones nombradas | Sí — de primera clase, con navegación y comportamiento de flujo | Parcial — pistas de etiquetas | Sí — marcadores y rangos |
| Mapas de tempo y compás | Sí — mapas ordenados resueltos con precisión de muestra | Parcial — un tempo y compás por proyecto | Parcial — un tempo por sesión |

## Grabación

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Grabación multicanal | Sí — varias fuentes a la vez | Parcial — un dispositivo de entrada a la vez | Sí — interfaces de múltiples entradas y multicanal |
| Micrófono y audio de escritorio juntos | Sí — integrado | No | Parcial — requiere un dispositivo de bucle de retorno del sistema operativo |
| Grabación programada | Sí | Sí | No |
| Grabación activada por sonido | Sí — con umbral ajustable | Sí — con umbral ajustable | No |
| Cuenta previa a la toma | Sí — consciente del mapa de tempo, maneja compás compuesto | Parcial — grabación de entrada | Parcial — pre-rodaje como parte de punch and roll |
| Grabación punch | Sí — una transacción, captura predeterminada y enrutada | No | Sí — punch and roll |
| Grabación en bucle en tomas | Sí — un carril por pasada, añadido al mismo grupo | No | Parcial — tomas en un clip, elegidas de una lista |
| Comping de tomas | Sí — audición, promoción, edición de regiones de comp, aplanado como una edición reversible | No | No — sin editor de comp |
| Monitoreo y medición de entrada | Sí | Sí | Sí |

## Edición de línea de tiempo

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Variantes de edición en cascada | Sí — por clip, por pista y todas las pistas, al cortar y eliminar | Sí — las mismas tres, al cortar y eliminar | Parcial — eliminación en cascada en una selección o hueco |
| Dividir, unir y dividir en silencios | Sí | Sí | Parcial — dividir y recortar, sin unión de clips |
| Grupos de clips | Sí | Sí | Sí |
| Ganancia de clip | Sí | Sí | Sí |
| Tono y velocidad por clip | Sí — ajustar, renderizar o restablecer | Sí — ajustar, renderizar o restablecer | Parcial — el estiramiento sigue siendo editable, el tono es un efecto |
| Seguir cambios de tempo | Sí — los clips se estiran cuando el mapa se mueve | Sí | No |
| Cuantización y groove conscientes del compás | Sí — mapas de deformación con intensidad de groove ajustable | No | No |
| Ajuste a cruces por cero | Sí | Sí | Sí |
| Dibujo a nivel de muestra | Sí | Parcial — no hay acción de dibujo registrada en la versión fijada | Sí — en el editor de forma de onda |
| Edición solo con teclado | Sí — cada primitiva de edición tiene una acción de navegación | Sí — cada primitiva de edición tiene una acción de navegación | Parcial — atajos extensos, algunos paneles necesitan el ratón |

## Trabajo espectral y restauración

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vista de espectrograma | Sí — con ajustes por pista | Sí — con ajustes por pista | Sí — visualizaciones de frecuencia y tono |
| Selección con límites de frecuencia | Sí | Sí | Sí — lazo y lazo libre |
| Pincel espectral | Sí | Sí | Sí — pincel y reparación de puntos |
| Eliminar o amplificar una región espectral | Sí — ambas como acciones directas | Sí — ambas como acciones directas | Parcial — aplicar un efecto a la selección |
| Reparar daños cortos | Sí — Reparar | Sí — Reparar | Sí — Auto Heal y Spot Healing Brush |
| Reducción de ruido de banda ancha | Sí — con un perfil capturado | Sí — con un perfil capturado | Sí — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Desreverberación | No | No | Sí — DeReverb |
| Herramientas de clics, zumbidos y sibilancia | Parcial — solo Click Removal | Parcial — solo Click Removal | Sí — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Panel de diagnóstico | Parcial — Find Clipping como analizador | Parcial — Find Clipping como analizador | Sí — diagnóstico con reparación por problema |

## Efectos y complementos

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suite de efectos integrada | Sí — los 30 efectos de Audacity, complementos Nyquist integrados y efectos de primera parte sin equivalente aguas arriba, como el bitcrusher | Sí — la misma colección integrada de 30 efectos | Sí — alrededor de cincuenta, incluyendo dinámica multibanda |
| Rack de efectos en tiempo real por pista | Sí — un conjunto en tiempo real más amplio que el aguas arriba | Sí | Sí — dieciséis slots por clip, pista y master |
| EQ paramétrico | Sí — un nuevo EQ paramétrico con bandas automatizables | Parcial — Filter Curve y Graphic EQ | Sí — filtros paramétricos, gráficos y FFT |
| Presets de efectos | Sí — aplicar, guardar, importar, exportar | Sí — aplicar, guardar, importar, exportar | Sí |
| Macros y cadenas por lotes | Sí — biblioteca de macros guardadas con plantillas | No — la versión fijada comenta el menú Macros | Sí — Favorites y Batch Process |
| Formatos de complementos de terceros | Parcial — VST3, CLAP, AU y LV2 en escritorio detrás de consentimiento y contención, ninguno en el navegador | Sí — VST3, AU, LV2 y Nyquist, con un gestor de complementos | Parcial — VST3 y AU en macOS, sin CLAP ni LV2 |
| Scripting Nyquist | Sí — complementos integrados y el prompt de Nyquist | Sí — complementos integrados y el prompt de Nyquist | No |
| Paquetes de efectos en sandbox | Parcial — paquetes WebAssembly revisados, uno se entrega y los externos están aislados | No | No |
| Instrumentos virtuales | No — después de la 1.0 | No | No |

## Mezcla, enrutamiento y automatización

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mezclador con tiras de canal | Sí | Parcial — controles de pista y una pista master | Sí |
| Buses y submezclas | Sí — anidadas, con validación de ciclo | No | Sí — pistas de bus |
| Envíos | Sí — pre y post fader, múltiples asignaciones | No | Sí — pre y post fader |
| Grupos VCA | Sí | No | No |
| Entrada de sidechain | Sí | No | Sí — a través de envíos |
| Mezclas de cue y sala de control | Sí | No | No |
| Compensación de retardo de complementos | Sí — reproducción, monitoreo, buses, sidechains, renderizado y congelación | Parcial — no expuesto en las fuentes fijadas | Sí |
| Carriles de automatización | Sí — ganancia, panorámica, silencio, envíos, buses y parámetros de complementos | No — sin carriles y sin herramienta de envolvente en la versión fijada | Sí — volumen, panorámica y parámetros de efectos |
| Modos de automatización | Sí — lectura, recorte, tacto, retención y escritura | No | Parcial — lectura, escritura, retención y tacto, sin recorte |
| Formas de curva | Sí — línea, retención y curva | No | Sí — lineal y spline |
| Congelación de pista | Sí — congelar, descongelar y confirmar sin perder estado | No | Parcial — rebotar a una nueva pista |

## Medición y análisis

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Medidor de sonoridad | Sí — estilo EBU R 128, con historial | No — un efecto de Loudness Normalization pero sin medidor | Sí — Loudness Radar a ITU-R BS.1770 |
| Medidor de fase y correlación | Sí | No | Sí — medidor de fase y análisis |
| Medición de sonido envolvente | Sí | No | Parcial — hasta 5.1 |
| Gráfico de espectro | Sí — Plot Spectrum | Parcial — registrado, pero la versión fijada lo comenta fuera del menú Analyze | Sí — Frequency Analysis |
| Clipping y RMS en la forma de onda | Sí — ambos, conmutados por proyecto | Sí — ambos, conmutados por proyecto | Parcial — indicadores de clip, RMS en Amplitude Statistics |
| Contraste de inteligibilidad del habla | Sí — analizador Contrast | Parcial — registrado, pero la versión fijada lo comenta fuera del menú Analyze | No |

## Canales y audio inmersivo

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canales por archivo | Sí — hasta 32 para formatos PCM | Parcial — pistas mono y estéreo | Sí — hasta 32 en el editor de forma de onda |
| Mezcla envolvente | Sí — camas hasta 7.1.4 | No | Parcial — hasta 5.1 |
| Audio basado en objetos | Sí — objetos junto a camas | No | No |
| Autoría y paso directo de ADM | Sí — BW64/ADM con comprobaciones de conformidad | No | No |
| Renderizado binaural | Sí — un modelo binaural con nombre | No | Parcial — binarizador para ambisónicos |
| Ambisónicos | No | No | Sí — primer orden, con un panerador VR |

## Exportación y entrega

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Salida sin pérdida | Sí — WAV, AIFF, BWF y BW64 escritos de forma nativa | Sí — WAV, AIFF y FLAC | Sí — WAV, AIFF, FLAC y más |
| Salida con pérdida | Parcial — MP3, AAC, Opus, Vorbis, MP2, FLAC y WavPack, todo a través del tiempo de ejecución de FFmpeg | Parcial — MP3 integrado, el resto a través de una instalación opcional de FFmpeg | Sí — integrado |
| Configuraciones personalizadas de codificador | Sí — un destino personalizado de FFmpeg | Sí — un destino personalizado de FFmpeg | Sí — opciones por formato |
| Cola de exportación | Sí — pausar, cancelar, reintentar y reordenar | No — una exportación a la vez | Parcial — Proceso por lotes sin control de cola |
| Stems y alternativos en un solo paso | Sí — en cola junto con la mezcla | No | Parcial — una mezcla por stem |
| Entrega por región | Sí — secuencias de masterización con metadatos por región, huecos y fundidos | Parcial — exportar etiquetas, sin exportación de múltiples archivos en la versión fijada | Sí — exportar marcadores a archivos separados |
| Normalización de sonoridad en la exportación | Sí — parte del plan de entrega | Parcial — ejecutar el efecto primero | Sí — Coincidir sonoridad |
| Dither y mapeo de canales | Sí — controles explícitos | Parcial — dither en preferencias | Sí — controles explícitos |
| Informe de entrega | Sí — detallado por trabajo | No | No |
| La cola de renderizado sobrevive a un reinicio | Sí — en escritorio, reiniciando desde el byte cero con un diario de errores | No | No |

## Intercambio con otras herramientas

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Proyectos de Audacity | Sí — entrada y salida AUP4, con un informe de omisiones | Sí — nativo | No |
| EDL | Parcial — exportación de clase CMX3600, sin importación | No | No |
| OpenTimelineIO | Parcial — solo exportación | No | No |
| FCPXML | Parcial — solo exportación | No | Sí — importación y exportación |
| DAWproject | Sí — importación y exportación, con un informe de intercambio | No | No |
| OMF | No | No | Parcial — importación y exportación |
| Ida y vuelta con un editor de vídeo | Parcial — entrega el mismo proyecto a Framescaper sin copiar medios | No | Sí — Enlace dinámico con Premiere Pro |
| Intercambio de etiquetas y marcadores | Sí — importación y exportación | Sí — importación y exportación | Sí — listas de marcadores |

## Vídeo

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Importar vídeo para referencia | Sí — en la línea de tiempo, con audio vinculado | No | Parcial — una pista de vídeo, solo vista previa |
| Edición de línea de tiempo de vídeo | Parcial — edición básica, la superficie completa es Framescaper | No | No |
| Exportación de vídeo | Sí — MP4 y WebM a través del tiempo de ejecución de FFmpeg | No | No — solo audio |
| Composición, gradación y efectos | Parcial — en Framescaper, en el mismo proyecto | No | No |

## Asistencia por máquina

| Capacidad | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mejora de voz | Parcial — solo escritorio, una vez instalado el paquete del modelo | No | Sí — Mejorar voz |
| Transcripción y diarización | Parcial — solo escritorio, modelos opcionales | No | No — las transcripciones están en Premiere Pro |
| Separación de fuente en stems | Parcial — solo escritorio, modelos opcionales | No | No |
| Atenuación automática | Sí — efecto Auto Duck | Sí — efecto Auto Duck | Sí — atenuación de Sonido esencial |
| Detección de ritmo y plano | Parcial — solo escritorio, modelos opcionales | No | Parcial — Remix reprograma la música automáticamente |
| Se ejecuta por completo en su máquina | Sí — la inferencia es solo de escritorio y sin conexión tras la instalación | Sí — sin inferencia en absoluto | Parcial — algunas funciones se procesan en la nube de Adobe |
| Los modelos son opcionales y removibles | Sí — descargados por separado, fijados por resumen, eliminables | Sí — nada que instalar | No — incluidos con la aplicación |

## A qué se suman las diferencias

Audacity 4 es un editor de un solo paso. No tiene buses, no tiene envíos, no
carriles de automatización y no macros en la versión fijada. Soundscaper mantiene ese
modelo de edición y añade la capa de mezcla, automatización y entrega sobre él,
más grabación, vídeo e intercambio de trabajo que Audacity no intenta.

Audition sigue liderando en profundidad de restauración, en idas y vueltas con Premiere Pro y en
ambisónicos. Donde Soundscaper lidera es en entrega inmersiva, manejo de proyectos y
el hecho de que se ejecuta en un navegador en hardware que ninguno de los otros soporta.

Si ya trabaja en Audacity, vea
[archivos de proyecto e intercambio con Audacity](/projects-and-data/project-files/) para
saber cómo mover un proyecto.
