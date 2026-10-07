---
title: "Comparación de Soundscaper"
description: "Compara Soundscaper Web y Desktop con Audacity 4 y Adobe Audition en grabación, edición, mezcla, entrega e intercambio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"es"} -->

Soundscaper vuelve a implementar Audacity 4 en la web y añade una capa de producción. Adobe Audition es la herramienta comercial de posproducción con la que suelen compararse ambos. Esta página compara Soundscaper Web y Desktop, Audacity 4 y Audition para que puedas ver qué edición ya hace lo que necesitas.

## Cómo leer esta página

Cada celda empieza con un símbolo de color, seguido de la explicación correspondiente:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — compatible o aplicable
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — alcance limitado, depende de la plataforma o requiere una solución alternativa
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — no disponible o no aplicable

Lee las notas junto con los símbolos. La instalación opcional de un complemento, modelo o códec no convierte por sí sola en limitada una capacidad compatible de escritorio; la nota indica qué necesitas instalar. Web y Desktop tienen columnas distintas, así que una limitación del navegador no reduce la valoración de Desktop.

Las filas describen capacidades, no comandos de menú. Para el inventario exacto
de comandos, consulta [Comandos y atajos](/reference/generated/commands/), y para lo que
cada producto habilita, consulta
[Capacidades del producto](/reference/generated/product-capabilities/).

### Origen de estas afirmaciones

- Las filas de **Soundscaper** proceden de este repositorio: los perfiles de capacidades del producto, el manifiesto de acciones en tiempo de ejecución, el registro de formatos de exportación y las comprobaciones de códecs del navegador y de escritorio.
  Las cargas útiles nativas de escritorio las generan la CI del repositorio o el empaquetado del destino. Un paquete activa una solo después de preparar y verificar el resultado exacto correspondiente; esas filas indican cuándo sigue siendo necesaria una carga útil.
- Las filas de **Audacity 4** parten del inventario upstream fijado en este repositorio, `4.0.0` en el commit `4c177d43`, e incluyen los cambios visibles para el usuario hasta la [versión oficial `4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt), en el commit `d82386ce`. Las capacidades que upstream registra pero deja desactivadas o comenta para excluirlas del menú se indican como tales. Si no hay registro en el inventario auditado ni en las notas de la versión, se indica que no está presente allí, en vez de afirmar que nunca existe. El dibujo de muestras, las envolventes de ganancia del clip y la importación de proyectos antiguos también se documentan en el [registro oficial de cambios de la versión 4.0](https://www.audacityteam.org/changelog/) y en el [manual de ganancia del clip](https://www.audacityteam.org/manual/clips/clip-gain/).
- Las filas de **Audition** provienen de la documentación publicada por Adobe
para la versión actual. No se verifican contra una compilación en ejecución.

## Plataforma y términos

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licencia | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, código abierto | / — propietario y cerrado |
| Coste | + — gratis | + — gratis | + — gratis | / — suscripción a Creative Cloud |
| Se ejecuta en un navegador | + — Chromium, Firefox y WebKit | / — aplicación empaquetada | / — solo escritorio | / — solo escritorio |
| Compilaciones de escritorio | / — usa la edición web | + — Windows y Linux en x64 y ARM64, macOS en ARM64 | + — Windows (instalador o portátil), macOS, Linux | ~ — Windows y macOS, sin Linux |
| Funciona sin cuenta | + — no existe ninguna cuenta | + — no existe ninguna cuenta | + — inicio de sesión solo para audio.com | / — se requiere suscripción iniciada sesión |
| Almacenamiento de proyectos en la nube | / — excluido por el diseño local primero | / — excluido por el diseño local primero | + — guardar y compartir a través de audio.com | ~ — archivos de Creative Cloud, las sesiones no se sincronizan |
| Requisitos del sistema | + — se ejecuta donde se ejecute un navegador actual | + — Windows, Linux o macOS en las arquitecturas de escritorio compatibles | ~ — aumentados sustancialmente respecto a Audacity 3 | ~ — clase de estación de trabajo profesional |

## Modelo de proyecto y sesión

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Formato de proyecto nativo | + — `.sscape`, un archivo portátil sin pérdida | + — `.sscape`, un archivo portátil sin pérdida | + — `.aup4` | + — `.sesx` |
| Abre proyectos de Audacity | + — importación de AUP, AUP3 y AUP4; exportación de AUP3 y AUP4 | + — importación de AUP, AUP3 y AUP4; exportación de AUP3 y AUP4 | + — importación de AUP, AUP3 y AUP4; exportación de AUP4, no exporta AUP3 | / |
| Línea de tiempo de clips no destructiva | + | + | + | + — editor multicanal |
| Editor de archivo único dedicado | + — editor de forma de onda de origen en las propiedades del clip | + — editor de forma de onda de origen en las propiedades del clip | ~ — las ediciones se aplican en su lugar en la línea de tiempo | + — editor de forma de onda |
| Contenido mono y estéreo en una pista | + — una pista contiene uno u otro | + — una pista contiene uno u otro | / — una pista es mono o estéreo | / — el formato de canal es fijo por pista |
| Carpetas de pistas anidadas | + — cualquier profundidad, reversible, con enrutamiento | + — cualquier profundidad, reversible, con enrutamiento | / | ~ — solo buses de submezcla, sin pistas de carpeta |
| Bandeja de proyecto | + — organiza archivos y funciona como portapapeles | + — organiza archivos y funciona como portapapeles | / | ~ — el panel Archivos lista los archivos abiertos |
| Autoguardado y recuperación de errores | + — autoguardado, bloqueos y sobres de recuperación | + — autoguardado, bloqueos y sobres de recuperación | + | + |
| Marcadores y regiones con nombre | + — de primera clase, con navegación y comportamiento de flujo | + — de primera clase, con navegación y comportamiento de flujo | ~ — pistas de etiquetas | + — marcadores y rangos |
| Mapas de tempo y compás | + — mapas ordenados resueltos con precisión de muestra | + — mapas ordenados resueltos con precisión de muestra | ~ — un tempo y compás por proyecto | ~ — un tempo por sesión |

## Grabación

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Grabación multicanal | + — varias fuentes a la vez | + — varias fuentes a la vez | ~ — un dispositivo de entrada a la vez | + — interfaces de múltiples entradas y multicanal |
| Micrófono y audio de escritorio juntos | ~ — integrado cuando el navegador y el sistema operativo permiten capturar el audio de pantalla | + — micrófono y bucle de retorno del escritorio en Windows; otros sistemas usan una entrada de bucle de retorno | / | ~ — requiere un dispositivo de bucle del sistema operativo |
| Grabación programada | + | + | + | / |
| Grabación activada por sonido | + — con umbral ajustable | + — con umbral ajustable | + — con umbral ajustable | / |
| Cuenta atrás antes de la toma | + — tiene en cuenta el mapa de tempo y admite compases compuestos | + — tiene en cuenta el mapa de tempo y admite compases compuestos | ~ — grabación de entrada | ~ — pre-roll como parte de punch and roll |
| Grabación punch | + — una transacción, captura predeterminada y enrutada | + — una transacción, captura predeterminada y enrutada | / | + — punch and roll |
| Grabación en bucle en tomas | + — un carril por pasada, añadido al mismo grupo | + — un carril por pasada, añadido al mismo grupo | / | ~ — tomas en un clip, elegidas de una lista |
| Comping de tomas | + — audición, promoción, edición de regiones de comp, aplanado como una edición reversible | + — audición, promoción, edición de regiones de comp, aplanado como una edición reversible | / | / — sin editor de comp |
| Monitoreo y medición de entrada | + | + | + | + |

## Edición de línea de tiempo

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Variantes de edición en cascada | + — por clip, por pista y todas las pistas, al cortar y eliminar | + — por clip, por pista y todas las pistas, al cortar y eliminar | + — las mismas tres, al cortar y eliminar | ~ — eliminación en cascada en una selección o hueco |
| Dividir, unir y dividir en silencios | + | + | + | ~ — dividir y recortar, sin unión de clips |
| Grupos de clips | + | + | + | + |
| Ganancia de clip | + | + | + | + |
| Tono y velocidad por clip | + — ajustar, renderizar o restablecer | + — ajustar, renderizar o restablecer | + — ajustar, renderizar o restablecer | ~ — el estiramiento sigue siendo editable, el tono es un efecto |
| Seguir cambios de tempo | + — los clips se estiran cuando el mapa se mueve | + — los clips se estiran cuando el mapa se mueve | + | / |
| Cuantización y groove conscientes del compás | + — mapas de deformación con intensidad de groove ajustable | + — mapas de deformación con intensidad de groove ajustable | / | / |
| Ajuste a cruces por cero | + | + | + | + |
| Dibujo a nivel de muestra | + | + | + — disponible al ampliar hasta ver muestras individuales | + — en el editor de forma de onda |
| Edición solo con teclado | + — cada primitiva de edición tiene una acción de navegación | + — cada primitiva de edición tiene una acción de navegación | + — las acciones de edición, la línea de tiempo y las reglas verticales de las pistas se pueden recorrer con el teclado | ~ — atajos extensos, algunos paneles necesitan el ratón |

## Trabajo espectral y restauración

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Vista de espectrograma | + — con ajustes por pista | + — con ajustes por pista | + — con ajustes por pista | + — visualizaciones de frecuencia y tono |
| Selección con límites de frecuencia | + | + | + | + — lazo y lazo libre |
| Brocha espectral | + | + | + | + — pincel y reparación de puntos |
| Eliminar o amplificar una región espectral | + — ambas como acciones directas | + — ambas como acciones directas | + — ambas como acciones directas | ~ — aplicar un efecto a la selección |
| Reparar daños cortos | + — Reparar | + — Reparar | + — Reparar | + — Auto Heal y Spot Healing Brush |
| Reducción de ruido de banda ancha | + — con un perfil capturado | + — con un perfil capturado | + — con un perfil capturado | + — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Desreverberación | / — solo asistencia de escritorio | + — Reducir reverberación, con el modelo y el motor opcionales instalados | / | + — DeReverb |
| Herramientas para clics, zumbidos y sibilancias | ~ — eliminación de clics y De-esser; no incluye una herramienta específica para eliminar zumbidos | ~ — eliminación de clics y De-esser; no incluye una herramienta específica para eliminar zumbidos | ~ — solo Click Removal | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Panel de diagnóstico | ~ — Find Clipping como analizador | ~ — Find Clipping como analizador | ~ — Find Clipping como analizador | + — diagnóstico con reparación por problema |

## Efectos y complementos

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Suite de efectos integrada | + — efectos derivados de Audacity, complementos Nyquist incluidos y efectos propios como Bitcrusher y De-esser | + — efectos derivados de Audacity, complementos Nyquist incluidos y efectos propios como Bitcrusher y De-esser | + — 30 efectos integrados en la versión fijada | + — alrededor de cincuenta, incluidos los de dinámica multibanda |
| Rack de efectos en tiempo real por pista | + — una selección de efectos en tiempo real más amplia que la de la versión de referencia | + — una selección de efectos en tiempo real más amplia que la de la versión de referencia | + | + — dieciséis ranuras por clip, pista y pista maestra |
| EQ paramétrico | + — un nuevo EQ paramétrico con bandas automatizables | + — un nuevo EQ paramétrico con bandas automatizables | ~ — Curva de filtro y EQ gráfico | + — filtros paramétricos, gráficos y FFT |
| Presets de efectos | + — aplicar, guardar, importar, exportar | + — aplicar, guardar, importar, exportar | + — aplicar, guardar, importar, exportar | + |
| Macros y cadenas por lotes | + — biblioteca de macros guardadas con plantillas | + — biblioteca de macros guardadas con plantillas | / — la compilación fijada comenta el menú Macros | + — Favoritos y Procesamiento por lotes |
| Formatos de complementos de terceros | / — los complementos nativos requieren Desktop | + — VST3, CLAP, AU, LV2, LADSPA de Linux y Vamp; según la plataforma, con consentimiento y aislamiento | + — VST3, AU, LV2 y Nyquist, con un gestor de complementos | ~ — VST3 y AU en macOS, sin CLAP ni LV2 |
| Scripting Nyquist | + — complementos incluidos y el prompt de Nyquist | + — complementos incluidos y el prompt de Nyquist | + — complementos incluidos y el prompt de Nyquist | / |
| Paquetes de efectos en sandbox | ~ — paquetes WebAssembly revisados, uno se distribuye y los externos están aislados | ~ — paquetes WebAssembly revisados, uno se distribuye y los externos están aislados | / | / |
| Instrumentos virtuales | / | / | / | / |

## Mezcla, enrutamiento y automatización

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mezclador con tiras de canal | + | + | ~ — controles de pista y una pista master | + |
| Buses y submezclas | + — anidadas, con validación de ciclo | + — anidadas, con validación de ciclo | / | + — pistas de bus |
| Sends | + — pre y post fader, múltiples asignaciones | + — pre y post fader, múltiples asignaciones | / | + — pre y post fader |
| Grupos VCA | + | + | / | / |
| Entrada de sidechain | + | + | / | + — a través de sends |
| Mezclas de cue y sala de control | + | + | / | / |
| Compensación de retardo de complementos | + — reproducción, monitoreo, buses, sidechains, render y congelación | + — reproducción, monitoreo, buses, sidechains, render y congelación | ~ — no expuesto en las fuentes fijadas | + |
| Carriles de automatización | + — ganancia, panorámica, silencio, sends, buses y parámetros de complementos | + — ganancia, panorámica, silencio, sends, buses y parámetros de complementos | ~ — envolventes de ganancia del clip; no hay carriles de automatización de pistas ni efectos | + — volumen, panorámica y parámetros de efectos |
| Modos de automatización | + — lectura, ajuste, tacto, retención y escritura | + — lectura, ajuste, tacto, retención y escritura | / | ~ — lectura, escritura, retención y tacto, sin ajuste |
| Formas de curva | + — línea, retención y curva | + — línea, retención y curva | ~ — solo envolventes de ganancia del clip | + — lineal y spline |
| Congelación de pista | + — congelar, descongelar y confirmar sin perder estado | + — congelar, descongelar y confirmar sin perder estado | / | ~ — rebotar a una nueva pista |

## Medición y análisis

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Medidor de sonoridad | + — estilo EBU R 128, con historial | + — estilo EBU R 128, con historial | / — un efecto de Normalización de Sonoridad pero sin medidor | + — Loudness Radar según ITU-R BS.1770 |
| Medidor de fase y correlación | + | + | / | + — medidor de fase y análisis |
| Medición de sonido envolvente | + | + | / | ~ — hasta 5.1 |
| Gráfico de espectro | + — Plot Spectrum | + — Plot Spectrum | ~ — registrado, pero la versión fijada lo comenta fuera del menú Analizar | + — Frequency Analysis |
| Clipping y RMS en la forma de onda | + — opciones del proyecto con ajustes de RMS por pista | + — opciones del proyecto con ajustes de RMS por pista | + — ambos, conmutados por proyecto | ~ — indicadores de clipping, RMS en Amplitude Statistics |
| Contraste de inteligibilidad del habla | + — analizador de contraste | + — analizador de contraste | ~ — registrado, pero la versión fijada lo comenta fuera del menú Analizar | / |

En Soundscaper, abre el menú **Visualización de pista** de una pista para activar o desactivar **Media onda** o **Mostrar RMS en la forma de onda**. La vista predeterminada, las frecuencias de cruce de 3 bandas y los ajustes del espectrograma están en **Editar → Preferencias → Visualización de pista**.

## Canales y audio inmersivo

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Canales por archivo | + — hasta 32 para formatos PCM | + — hasta 32 para formatos PCM | ~ — pistas mono y estéreo | + — hasta 32 en el editor de forma de onda |
| Mezcla envolvente | + — camas hasta 7.1.4 | + — camas hasta 7.1.4 | / | ~ — hasta 5.1 |
| Audio basado en objetos | + — objetos junto a camas | + — objetos junto a camas | / | / |
| Autoría y passthrough de ADM | + — BW64/ADM con comprobaciones de conformidad | + — BW64/ADM con comprobaciones de conformidad | / | / |
| Renderizado binaural | + — un modelo binaural nombrado | + — un modelo binaural nombrado | / | ~ — binauralizador para ambisonics |
| Ambisonics | / | / | / | + — primer orden, con un panner VR |

## Exportación y entrega

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Salida sin pérdida | + — WAV, AIFF, BWF y BW64 nativos; FLAC y WavPack mediante códecs específicos | + — WAV, AIFF, BWF y BW64 nativos; FLAC y WavPack mediante códecs específicos | + — WAV, AIFF y FLAC | + — WAV, AIFF, FLAC y más |
| Salida con pérdida | ~ — MP3, MP2, Opus y Ogg Vorbis; AAC depende del navegador | + — MP3, MP2, Opus, Ogg Vorbis y AAC mediante proveedores de códecs compatibles, incluido FFmpeg configurado | + — MP3, Opus y Ogg Vorbis; otros formatos mediante FFmpeg opcional | ~ — MP2, MP3 y Ogg Vorbis; más formatos mediante Adobe Media Encoder, sin destino FFmpeg general |
| Configuraciones personalizadas de codificador | ~ — controles por formato; no se admiten argumentos FFmpeg personalizados | ~ — controles por formato; no se admiten argumentos FFmpeg personalizados | + — un destino FFmpeg personalizado | + — opciones por formato |
| Cola de exportación | + — pausar, cancelar, reintentar y reordenar | + — pausar, cancelar, reintentar y reordenar | / — Exportar varios es una única operación secuencial, no una cola de trabajos | ~ — Batch Process sin control de cola |
| Stems y alternativos en un solo paso | + — en cola junto con la mezcla | + — en cola junto con la mezcla | ~ — Exportar varios guarda cada pista por separado, pero no pone en cola la mezcla y las renderizaciones alternativas juntas | ~ — una mezcla por stem |
| Entrega por región | + — secuencias de masterización con metadatos por región, huecos y fundidos | + — secuencias de masterización con metadatos por región, huecos y fundidos | + — Exportar varios guarda cada región etiquetada en su propio archivo | + — exportar marcadores a archivos separados |
| Normalización de sonoridad en la exportación | + — parte del plan de entrega | + — parte del plan de entrega | ~ — ejecutar el efecto primero | + — Match Loudness |
| Dither y mapeo de canales | + — controles explícitos | + — controles explícitos | ~ — dither en preferencias | + — controles explícitos |
| Informe de entrega | + — detallado por trabajo | + — detallado por trabajo | / | / |
| La cola de renderizado sobrevive a un reinicio | / — la recuperación persistente de renderizaciones requiere Desktop | + — se reinicia desde el byte cero con un registro de fallos | / | / |

Soundscaper Desktop puede usar FFmpeg configurado para los formatos de exportación compatibles; el editor actual no ofrece argumentos FFmpeg arbitrarios ni todos los codificadores de FFmpeg. Consulta [Formatos de exportación](/reference/generated/formats/) para ver los destinos registrados. El [flujo de exportación](https://www.audacityteam.org/manual/getting-started/export-your-audio/) de Audacity añade formatos mediante una instalación opcional de FFmpeg. Audition ofrece un conjunto fijo de escritores de archivos y una [transferencia a Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Intercambio con otras herramientas

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Proyectos de Audacity | + — importa AUP, AUP3 y AUP4; exporta AUP3 y AUP4 con un informe de compatibilidad | + — importa AUP, AUP3 y AUP4; exporta AUP3 y AUP4 con un informe de compatibilidad | + — importación de AUP, AUP3 y AUP4; exportación de AUP4, no exporta AUP3 | / |
| Sesiones de Audition | / — la importación de SESX requiere Desktop | ~ — importación de audio `.sesx` con informe de omisiones; no exporta | / — no importa SESX en la versión fijada | + — nativo |
| EDL | ~ — exportación de clase CMX3600, sin importación | ~ — exportación de clase CMX3600, sin importación | / | / |
| OpenTimelineIO | ~ — solo exportación | ~ — solo exportación | / | / |
| FCPXML | ~ — solo exportación | ~ — solo exportación | / | + — importación y exportación |
| DAWproject | + — importación y exportación, con un informe de intercambio | + — importación y exportación, con un informe de intercambio | / | / |
| OMF | / | / | / | ~ — importación y exportación |
| Ida y vuelta con un editor de vídeo | ~ — entrega el mismo proyecto a Framescaper sin copiar los medios | ~ — entrega el mismo proyecto a Framescaper sin copiar los medios | / | + — Dynamic Link con Premiere Pro |
| Intercambio de etiquetas y marcadores | + — importación y exportación | + — importación y exportación | + — importación y exportación | + — listas de marcadores |

Para importar un `.sesx` de Audition, consulta [Archivos de proyecto](/projects-and-data/project-files/) para saber qué ajustes de audio se transfieren y qué marca el informe como omitido.

## Vídeo

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Importar vídeo para referencia | + — en la línea de tiempo, con audio vinculado | + — en la línea de tiempo, con audio vinculado | / | ~ — una pista de vídeo, solo vista previa |
| Edición de línea de tiempo de vídeo | ~ — edición básica, la superficie completa es Framescaper | ~ — edición básica, la superficie completa es Framescaper | / | / |
| Exportación de vídeo | ~ — MP4 y WebM cuando WebCodecs del navegador admite los códecs necesarios | + — MP4 y WebM con un proveedor de códecs de escritorio verificado | / | / — solo audio |
| Composición, corrección de color y efectos | ~ — en Framescaper, en el mismo proyecto | ~ — en Framescaper, en el mismo proyecto | / | / |

## Asistencia por máquina

La asistencia de escritorio está disponible después de instalar pesos de modelo opcionales y un motor nativo correspondiente; estos flujos de trabajo no están disponibles en Web. El administrador de modelos instala ambos. Consulta [Asistencia local](/reference/generated/local-assistance/) para ver los flujos de trabajo y modelos disponibles.

| Capacidad | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mejora de voz | / — solo asistencia de escritorio | + — con el modelo y el motor opcionales instalados | / | + — Enhance Speech |
| Transcripción y diarización | / — solo asistencia de escritorio | + — con los modelos y motores opcionales instalados | / | / — las transcripciones están en Premiere Pro |
| Separación de fuente en tallos | / — solo asistencia de escritorio | + — con el modelo y el motor opcionales instalados | / | / |
| Atenuación automática | + — efecto Auto Duck | + — efecto Auto Duck | + — efecto Auto Duck | + — atenuación de Essential Sound |
| Detección de compás y plano | / — la detección de pulsos requiere Desktop; la detección de planos está en Framescaper | ~ — detección de pulsos con un modelo opcional; la detección de planos está en Framescaper | / | ~ — Remix reprograma la música automáticamente |
| Se ejecuta por completo en tu máquina | + — procesamiento local en el navegador; sin inferencia de modelos | + — procesamiento local e inferencia sin conexión tras instalar el modelo | + — sin inferencia en absoluto | ~ — algunas funciones se procesan en la nube de Adobe |
| Los modelos son opcionales y removibles | / — no se instalan modelos en Web | + — descargados por separado, fijados por resumen, eliminables | + — nada que instalar | / — incluidos con la aplicación |

## A qué suman las diferencias

Audacity 4 es un editor de una sola pasada. En la versión fijada no tiene buses, envíos, carriles de automatización de pista o efectos ni macros. Sus envolventes de ganancia del clip permiten automatizar el volumen dentro de un clip. Soundscaper mantiene ese modelo de edición y le añade automatización de pistas y efectos, mezcla y entrega, además de funciones de grabación, vídeo e intercambio que Audacity no aborda.

Audition sigue liderando en profundidad de restauración, en idas y vueltas con Premiere Pro y en ambisonics. Donde Soundscaper lidera es en entrega inmersiva, manejo de proyectos y el hecho de que se ejecuta en un navegador en hardware que ninguno de los otros soporta.

Si ya trabajas en Audacity, consulta
[archivos de proyecto e intercambio con Audacity](/projects-and-data/project-files/) para
saber cómo mover un proyecto.
