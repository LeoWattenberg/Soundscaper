---
title: "Como se compara Soundscaper"
description: "Compara Soundscaper con Audacity 4 e Adobe Audition en canto á gravación, edición, mestura, entrega e intercambio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"703e76cffbe1464f1283f6c8f45cee52c0d37faae852b7efc163879710a2ddb2","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"703e76cffbe1464f1283f6c8f45cee52c0d37faae852b7efc163879710a2ddb2","targetLocale":"gl"} -->

Soundscaper reimplementa Audacity 4 na web e engade unha capa de produción por
demais. Adobe Audition é a ferramenta comercial de posprodución contra a que
normalmente se comparan ambas. Esta páxina compara as tres para que poidas
saber cal delas xa realiza a tarefa que tes.

## Como ler esta páxina

Cada cela léese **Si**, **Parcial** ou **Non**, seguida do detalle que a
matura.

**Parcial** cubre tres situacións diferentes, e a nota di cal se aplica: a
capacidade existe pero é máis estreita que noutra parte, existe pero depende
dalgo que ti debas proporcionar, ou só é accesible traballando arredor dunha
ausencia.

As filas describen capacidades, non comandos de menú. Para o inventario exacto
de comandos, consulta [Comandos e atallos](/reference/generated/commands/), e para o que cada
produto permite, consulta
[Capacidades do produto](/reference/generated/product-capabilities/).

### De onde proceden estas afirmacións

- As filas de **Soundscaper** proceden deste repositorio: os perfís de
  capacidade do produto, o manifesto de accións en tempo de execución e o
  rexistro de formatos de exportación. As cargas de destino nativas de
  escritorio xéranse mediante CI do repositorio ou empaquetado do destino. Un
  paquete só permite unha tras a colocación e verificación do resultado exacto
  correspondente; esas filas indican cando aínda se require unha carga.
- As filas de **Audacity 4** proceden do inventario de montante fixado neste
  repositorio, `4.0.0` no commit `4c177d43`. Unha capacidade que o montante
  rexistra pero deixa desactivada ou comenta fóra do menú
  regístrase como tal, e unha capacidade sen rexistro na compilación fixada
  infórmase como ausente nesa compilación en lugar de como permanentemente
  ausente.
- As filas de **Audition** proceden da documentación publicada por Adobe para a
  versión actual. Non se verifican contra unha compilación en execución.

## Plataforma e termos

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licenza | Si — AGPL-3.0-only | Si — GPL, código aberto | Non — propietario e pechado |
| Custo | Si — gratuíto | Si — gratuíto | Non — subscrición de Creative Cloud |
| Funciona nun navegador | Si — Chromium, Firefox e WebKit | Non — só escritorio | Non — só escritorio |
| Compilacións de escritorio | Si — Windows e Linux en x64 e ARM64, macOS en ARM64 | Si — Windows, macOS, Linux | Parcial — Windows e macOS, sen Linux |
| Funciona sen conta | Si — non existe conta | Si — só inicio de sesión para audio.com | Non — requírese subscrición iniciada sesión |
| Almacenamento de proxectos na nube | Non — excluído polo deseño local-first | Si — gardar e compartir a través de audio.com | Parcial — ficheiros de Creative Cloud, as sesións non se sincronizan |
| Requisitos do sistema | Si — funciona onde funcione un navegador actual | Parcial — aumentou substancialmente respecto a Audacity 3 | Parcial — clase de estación de traballo profesional |

## Modelo de proxecto e sesión

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Formato de proxecto nativo | Si — `.sscape`, un arquivo portátil sen perda | Si — `.aup4` | Si — `.sesx` |
| Abre proxectos de Audacity | Si — importación e exportación AUP4 | Si — nativo | Non |
| Liña de tempo de clips non destructiva | Si | Si | Si — editor multicanle |
| Editor de ficheiro único dedicado | Parcial — a edición de mostras ocorre na liña de tempo | Parcial — as edicións aplícanse no sitio na liña de tempo | Si — editor de forma de onda |
| Contido mono e estéreo nunha pista | Si — unha pista contén unha ou outra | Non — unha pista é mono ou estéreo | Non — o formato de canle está fixado por pista |
| Cartas de pistas anidadas | Si — calquera profundidade, desfacible, con enrutamento | Non | Parcial — só buses de submix, sen pistas de carta |
| Caixa de proxecto | Si — organiza ficheiros e serve como portapapeis | Non | Parcial — o panel Ficheiros lista os ficheiros abertos |
| Gardado automático e recuperación de erros | Si — gardado automático, bloqueos e envoltorios de recuperación | Si | Si |
| Marcadores e rexións nomeadas | Si — de primeira clase, con navegación e comportamento de fluxo | Parcial — pistas de etiquetas | Si — marcadores e rangos |
| Mapas de tempo e compás | Si — mapas ordenados resoltos con precisión de mostra | Parcial — un tempo e compás de proxecto | Parcial — un tempo de sesión |

## Gravación

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Gravación multicanle | Si — varias fontes á vez | Parcial — un dispositivo de entrada á vez | Si — interfaces de múltiples entradas e multicanle |
| Micrófono e audio de escritorio xuntos | Si — integrado | Non | Parcial — require un dispositivo de bucle do sistema operativo |
| Gravación temporizada | Si | Si | Non |
| Gravación activada por son | Si — cun limiar axustable | Si — cun limiar axustable | Non |
| Contaxe antes da toma | Si — consciente do mapa de tempo, manexa compás composto | Parcial — gravación de introdución | Parcial — pre-roll como parte de punch and roll |
| Gravación punch | Si — unha transacción, captura predeterminada e enrutada | Non | Si — punch and roll |
| Gravación en bucle en tomas | Si — un carril por pasada, engadido ao mesmo grupo | Non | Parcial — tomas nun clip, escollidas dunha lista |
| Comping de tomas | Si — audición, promoción, edición de rexións de comp, achatar como unha edición desfacible | Non | Non — sen editor de comp |
| Monitorización e medición de entrada | Si | Si | Si |

## Edición da liña de tempo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Variantes de edición en cascada | Si — por clip, por pista e todas as pistas, ao cortar e eliminar | Si — as mesmas tres, ao cortar e eliminar | Parcial — eliminación en cascada nunha selección ou espazo |
| Dividir, unir e dividir en silencios | Si | Si | Parcial — dividir e recortar, sen unir clips |
| Grupos de clips | Si | Si | Si |
| Ganancia de clip | Si | Si | Si |
| Ton e velocidade por clip | Si — axustar, renderizar ou restablecer | Si — axustar, renderizar ou restablecer | Parcial — o estirado permanece editable, o ton é un efecto |
| Seguir cambios de tempo | Si — os clips estíranse cando o mapa se move | Si | Non |
| Cuantización e groove conscientes do compás | Si — mapas de deformación con forza de groove axustable | Non | Non |
| Axustar a cruces por cero | Si | Si | Si |
| Debuxado a nivel de mostra | Si | Parcial — non hai acción de debuxo rexistrada na versión fixada | Si — no editor de forma de onda |
| Edición só con teclado | Si — cada primitiva de edición ten unha acción de navegación | Si — cada primitiva de edición ten unha acción de navegación | Parcial — atallos extensos, algúns paneis necesitan o rato |

## Traballo espectral e restauración

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vista de espectrograma | Si — con axustes por pista | Si — con axustes por pista | Si — mostraxes de frecuencia e ton |
| Selección con límites de frecuencia | Si | Si | Si — lazo e lazo de selección |
| Pincel espectral | Si | Si | Si — pincel e curación de puntos |
| Eliminar ou amplificar unha rexión espectral | Si — ambas como accións directas | Si — ambas como accións directas | Parcial — aplicar un efecto á selección |
| Reparar dano curto | Si — Reparar | Si — Reparar | Si — Curación automática e Pincel de curación de puntos |
| Redución de ruído de banda ancha | Si — cun perfil capturado | Si — cun perfil capturado | Si — Redución de ruído, Redución adaptativa de ruído, DeNoise |
| Desreverberación | Non | Non | Si — DeReverb |
| Ferramentas de clics, zumbidos e sibilancia | Parcial — só Eliminación de clics | Parcial — só Eliminación de clics | Si — DeClicker, DeHummer, DeEsser, Eliminador de clics/pops |
| Panel de diagnóstico | Parcial — Buscar recortes como analizador | Parcial — Buscar recortes como analizador | Si — diagnóstico con reparación por problema |

## Efectos e complementos

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suite de efectos integrada | Si — os 30 efectos de Audacity, os complementos Nyquist empaquetados e os efectos de primeira parte sena equivalente a montante, como o bitcrusher | Si — a mesma colección integrada de 30 efectos | Si — arredor de cincuenta, incluíndo dinámica multibanda |
| Rack de efectos en tempo real por pista | Si — un conxunto en tempo real máis amplo que a montante | Si | Si — dezaseis slots por clip, pista e mestre |
| EQ paramétrico | Si — un novo EQ paramétrico con bandas automatizables | Parcial — Curva de Filtro e EQ Gráfico | Si — filtros paramétricos, gráficos e FFT |
| Presets de efectos | Si — aplicar, gardar, importar, exportar | Si — aplicar, gardar, importar, exportar | Si |
| Macros e cadeas por lotes | Si — biblioteca de macros gardadas con plantillas | Non — a compilación fixada comenta o menú Macros | Si — Favoritos e Procesamento por lotes |
| Formatos de complementos de terceiros | Parcial — VST3, CLAP, AU e LV2 no escritorio baixo consentimento e contención, ningunha no navegador | Si — VST3, AU, LV2 e Nyquist, cun xestor de complementos | Parcial — VST3 e AU en macOS, sen CLAP nin LV2 |
| Scripting Nyquist | Si — complementos empaquetados e o prompt de Nyquist | Si — complementos empaquetados e o prompt de Nyquist | Non |
| Paquetes de efectos en sandbox | Parcial — paquetes WebAssembly revisados, un se distribúe e os externos están illados | Non | Non |
| Instrumentos virtuais | Non — despois da 1.0 | Non | Non |

## Mezcla, enrutamento e automatización

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mezclador con tiras de canles | Si | Parcial — controis de pista e unha pista mestre | Si |
| Barras e submezclas | Si — anidadas, con validación de ciclo | Non | Si — pistas de barra |
| Envolventes (Sends) | Si — pre e post fader, múltiples asignacións | Non | Si — pre e post fader |
| Grupos VCA | Si | Non | Non |
| Entrada de sidechain | Si | Non | Si — a través de envolventes |
| Mezclas de cue e sala de control | Si | Non | Non |
| Compensación de atraso de complementos | Si — reprodución, monitorización, barras, sidechains, render e conxelación | Parcial — non exposto nas fontes fixadas | Si |
| Carrís de automatización | Si — ganancia, panorámica, silencio, envolventes, barras e parámetros de complementos | Non — sen carrís nin ferramenta de envolventes na compilación fixada | Si — volume, panorámica e parámetros de efectos |
| Modos de automatización | Si — lectura, recorte, toque, retención e escritura | Non | Parcial — lectura, escritura, retención e toque, sen recorte |
| Formas de curva | Si — liña, mantemento e curva | Non | Si — lineal e spline |
| Conxelación de pista | Si — conxelar, desconxelar e confirmar sen perder estado | Non | Parcial — rebotar a unha nova pista |

## Medición e análise

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Medidor de sonoridade | Si — estilo EBU R 128, con histórico | Non — un efecto de Normalización de Sonoridade pero sen medidor | Si — Radar de Sonoridade segundo ITU-R BS.1770 |
| Medidor de fase e correlación | Si | Non | Si — medidor de fase e análise |
| Medición de son envolvente | Si | Non | Parcial — ata 5.1 |
| Gráfico de espectro | Si — Gráfico de Espectro | Parcial — rexistrado, pero a compilación fixada coméntao no menú Analizar | Si — Análise de Frecuencia |
| Saturación e RMS na forma de onda | Si — ambas, conmutables por proxecto | Si — ambas, conmutables por proxecto | Parcial — indicadores de saturación, RMS en Estatísticas de Amplitude |
| Contraste de intelixibilidade da fala | Si — Analizador de Contraste | Parcial — rexistrado, pero a compilación fixada coméntao no menú Analizar | Non |

## Canais e son inmersivo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canais por ficheiro | Si — ata 32 para formatos PCM | Parcial — pistas mono e estéreo | Si — ata 32 no editor de formas de onda |
| Mezcla de son envolvente | Si — leitos ata 7.1.4 | Non | Parcial — ata 5.1 |
| Audio baseado en obxectos | Si — obxectos xunto con leitos | Non | Non |
| Creación e passthrough de ADM | Si — BW64/ADM con comprobacións de conformidade | Non | Non |
| Renderizado binaural | Si — un modelo binaural nomeado | Non | Parcial — binarizador para ambisonics |
| Ambisonics | Non | Non | Si — primeira orde, cun panificador VR |

## Exportación e entrega

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Saída sen perdas | Si — WAV, AIFF, BWF e BW64 escritos nativamente | Si — WAV, AIFF e FLAC | Si — WAV, AIFF, FLAC e máis |
| Saída con perdas | Parcial — MP3, AAC, Opus, Vorbis, MP2, FLAC e WavPack, todos a través do tempo de execución FFmpeg | Parcial — MP3 integrado, o resto a través dunha instalación opcional de FFmpeg | Si — integrado |
| Ajustes personalizados do codificador | Si — un obxectivo FFmpeg personalizado | Si — un obxectivo FFmpeg personalizado | Si — opcións por formato |
| Cola de exportación | Si — pausa, cancelar, reintentar e reordenar | Non — unha exportación á vez | Parcial — Procesamento por Lotes sen control de cola |
| Estem e alternativos nunha pasada | Si — en cola xunto coa mestura | Non | Parcial — unha mestura por stem |
| Entrega rexión a rexión | Si — secuencias de mestura con metadatos por rexión, espazos e desvanecementos | Parcial — exportar etiquetas, sen exportación de múltiples ficheiros na compilación fixada | Si — exportar marcadores a ficheiros separados |
| Normalización de sonoridade na exportación | Si — parte do plan de entrega | Parcial — executar o efecto primeiro | Si — Coincidir Sonoridade |
| Dither e mapeo de canais | Si — controis explícitos | Parcial — dither nas preferencias | Si — controis explícitos |
| Informe de entrega | Si — detallado por traballo | Non | Non |
| A cola de renderizado sobrevive a un reinicio | Si — no escritorio, reiniciando desde o byte cero cun xornal de erros | Non | Non |

## Intercambio con outras ferramentas

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Proxectos de Audacity | Si — entrada e saída AUP4, cun informe de omisións | Si — nativo | Non |
| EDL | Parcial — exportación de clase CMX3600, sen importación | Non | Non |
| OpenTimelineIO | Parcial — só exportación | Non | Non |
| FCPXML | Parcial — só exportación | Non | Si — importación e exportación |
| DAWproject | Si — importación e exportación, cun informe de intercambio | Non | Non |
| OMF | Non | Non | Parcial — importación e exportación |
| Ida e volta cun editor de vídeo | Parcial — pasa o mesmo proxecto a Framescaper sen copiar os medios | Non | Si — Dynamic Link con Premiere Pro |
| Intercambio de etiquetas e marcadores | Si — importación e exportación | Si — importación e exportación | Si — listas de marcadores |

## Vídeo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Importar vídeo para referencia | Si — na liña de tempo, con audio vinculado | Non | Parcial — unha pista de vídeo, só previsualización |
| Edición da liña de tempo de vídeo | Parcial — edición básica, a superficie completa é Framescaper | Non | Non |
| Exportación de vídeo | Si — MP4 e WebM a través do tempo de execución FFmpeg | Non | Non — só audio |
| Composición, corrección de cor e efectos | Parcial — en Framescaper, no mesmo proxecto | Non | Non |

## Axuda por máquina

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mellora da fala | Parcial — só escritorio, unha vez instalado o payload do modelo | Non | Si — Enhance Speech |
| Transcripción e diarización | Parcial — só escritorio, modelos opcionais | Non | Non — as transcripcións están en Premiere Pro |
| Separación de fontes en stems | Parcial — só escritorio, modelos opcionais | Non | Non |
| Atenuación automática | Si — efecto Auto Duck | Si — efecto Auto Duck | Si — atenuación de Essential Sound |
| Detección de compás e planos | Parcial — só escritorio, modelos opcionais | Non | Parcial — Remix retemporiza a música automaticamente |
| Funciona por completo na túa máquina | Si — a inferencia é só de escritorio e sen conexión tras a instalación | Si — sen inferencia en absoluto | Parcial — algúns recursos procesan na nube de Adobe |
| Os modelos son opcionais e eliminables | Si — descargados por separado, fixados por resumo, eliminables | Si — nada que instalar | Non — incluídos coa aplicación |

## A que se suman as diferenzas

Audacity 4 é un editor de paso único. Non ten buses, nin envíos, nin carrís de automatización, nin macros na versión fixada. Soundscaper mantén ese modelo de edición e engade por riba del a capa de mestura, automatización e entrega, ademais de gravación, vídeo e traballo de intercambio que Audacity non intenta.

Audition segue liderando en profundidade de restauración, en idas e voltas con Premiere Pro e en ambisonics. Onde Soundscaper lidera é na entrega inmersiva, no manexo de proxectos e no feito de que funciona nun navegador en hardware que ningún dos outros dous soporta.

Se xa traballas en Audacity, consulta
[arquivos de proxecto e intercambio con Audacity](/projects-and-data/project-files/) para
saber como mover un proxecto.
