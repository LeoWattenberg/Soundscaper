---
title: "Comparación de Soundscaper"
description: "Compara Soundscaper Web e Desktop con Audacity 4 e Adobe Audition en gravación, edición, mestura, entrega e intercambio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"gl"} -->

Soundscaper volve implementar Audacity 4 na web e engade unha capa de produción. Adobe Audition é a ferramenta comercial de posprodución coa que se adoitan comparar ambos. Esta páxina compara Soundscaper Web e Desktop, Audacity 4 e Audition para que poidas ver que edición xa fai o que necesitas.

## Como ler esta páxina

Cada cela comeza cun símbolo de cor, seguido da explicación correspondente:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — admitido ou aplicable
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — alcance limitado, depende da plataforma ou require unha solución alternativa
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — non dispoñible ou non aplicable

Le as notas xunto cos símbolos. Instalar un complemento, modelo ou códec opcional non limita por si só unha capacidade admitida no escritorio; a nota indica o que cómpre instalar. Web e Desktop teñen columnas separadas, así que unha limitación do navegador non reduce a valoración de Desktop.

As filas describen capacidades, non comandos de menú. Para o inventario exacto
de comandos, consulta [Comandos e atallos](/reference/generated/commands/), e para o que cada
produto permite, consulta
[Capacidades do produto](/reference/generated/product-capabilities/).

### De onde proceden estas afirmacións

- As filas de **Soundscaper** proceden deste repositorio: os perfís de capacidades do produto, o manifesto de accións en tempo de execución, o rexistro de formatos de exportación e as comprobacións dos códecs de navegador e escritorio.
  CI do repositorio ou o empaquetado do destino xeran as cargas nativas de escritorio. Un paquete activa unha capacidade só despois de preparar e verificar o resultado exacto correspondente; as filas indican cando aínda se precisa esa carga.
- As filas de **Audacity 4** parten do inventario upstream fixado neste repositorio, a versión `4.0.0` no commit `4c177d43`, e inclúen os cambios visibles ata a [versión oficial `4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt) no commit `d82386ce`. Indícanse as capacidades que upstream rexistra pero mantén desactivadas ou exclúe do menú con comentarios. Se non aparecen no inventario auditado nin nas notas da versión, dicimos que non están presentes neles, non que estean ausentes permanentemente. O debuxo de mostras, as envolventes de ganancia do clip e a importación de proxectos antigos tamén se documentan no [rexistro oficial de cambios de 4.0](https://www.audacityteam.org/changelog/) e no [manual da ganancia do clip](https://www.audacityteam.org/manual/clips/clip-gain/).
- As filas de **Audition** proceden da documentación publicada por Adobe para a
  versión actual. Non se verifican contra unha compilación en execución.

## Plataforma e termos

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licenza | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, código aberto | / — propietario e pechado |
| Custo | + — gratuíto | + — gratuíto | + — gratuíto | / — subscrición de Creative Cloud |
| Funciona nun navegador | + — Chromium, Firefox e WebKit | / — aplicación empaquetada | / — só escritorio | / — só escritorio |
| Compilacións de escritorio | / — usa a edición para navegador | + — Windows e Linux en x64 e ARM64, macOS en ARM64 | + — Windows (instalador ou portátil), macOS e Linux | ~ — Windows e macOS, sen Linux |
| Funciona sen conta | + — non existe conta | + — non existe conta | + — só inicio de sesión para audio.com | / — requírese subscrición con inicio de sesión |
| Almacenamento de proxectos na nube | / — excluído polo deseño local primeiro | / — excluído polo deseño local primeiro | + — gardar e compartir a través de audio.com | ~ — ficheiros de Creative Cloud, as sesións non se sincronizan |
| Requisitos do sistema | + — funciona onde funcione un navegador actual | + — Windows, Linux ou macOS nas arquitecturas de escritorio admitidas | ~ — aumentou substancialmente respecto a Audacity 3 | ~ — clase de estación de traballo profesional |

## Modelo de proxecto e sesión

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Formato de proxecto nativo | + — `.sscape`, un arquivo portátil sen perda | + — `.sscape`, un arquivo portátil sen perda | + — `.aup4` | + — `.sesx` |
| Abre proxectos de Audacity | + — importa AUP, AUP3 e AUP4; exporta AUP3 e AUP4 | + — importa AUP, AUP3 e AUP4; exporta AUP3 e AUP4 | + — importa AUP, AUP3 e AUP4; exporta AUP4, non AUP3 | / |
| Liña de tempo de clips non destructiva | + | + | + | + — editor multirrastre |
| Editor de ficheiro único dedicado | + — editor da forma de onda fonte en Propiedades do clip | + — editor da forma de onda fonte en Propiedades do clip | ~ — as edicións aplícanse no sitio na liña de tempo | + — editor de forma de onda |
| Contido mono e estéreo nunha pista | + — unha pista contén calquera | + — unha pista contén calquera | / — unha pista é mono ou estéreo | / — o formato de canal está fixado por pista |
| Cartas de pistas anidadas | + — calquera profundidade, desfacible, con enrutamento | + — calquera profundidade, desfacible, con enrutamento | / | ~ — só buses de submix, sen pistas de carta |
| Caixa de proxecto | + — organiza ficheiros e serve como portapapeis | + — organiza ficheiros e serve como portapapeis | / | ~ — o panel Ficheiros lista os ficheiros abertos |
| Autogardado e recuperación de erros | + — autogardado, bloqueos e envoltorios de recuperación | + — autogardado, bloqueos e envoltorios de recuperación | + | + |
| Marcadores e rexións nomeadas | + — de primeira clase, con navegación e comportamento de fluxo | + — de primeira clase, con navegación e comportamento de fluxo | ~ — pistas de etiquetas | + — marcadores e rangos |
| Mapas de tempo e clave | + — mapas ordenados resoltos con precisión de mostra | + — mapas ordenados resoltos con precisión de mostra | ~ — un tempo e clave de proxecto | ~ — un tempo de sesión |

## Gravación

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Gravación multirrastre | + — varias fontes á vez | + — varias fontes á vez | ~ — un dispositivo de entrada á vez | + — interfaces de múltiples entradas e multicanal |
| Micrófono e audio de escritorio xuntos | ~ — integrado cando o navegador e o sistema operativo ofrecen audio da pantalla | + — micrófono e retorno de audio do escritorio en Windows; os demais sistemas usan unha entrada de retorno | / | ~ — require un dispositivo de retroalimentación do sistema operativo |
| Gravación temporizada | + | + | + | / |
| Gravación activada por son | + — cun limiar axustable | + — cun limiar axustable | + — cun limiar axustable | / |
| Conteo antes da toma | + — consciente do mapa de tempo, manexa compás composto | + — consciente do mapa de tempo, manexa compás composto | ~ — gravación de introdución | ~ — pre-roll como parte de punch and roll |
| Gravación punch | + — unha transacción, captura predeterminada e enrutada | + — unha transacción, captura predeterminada e enrutada | / | + — punch and roll |
| Gravación en bucle en tomas | + — un carril por pasada, engadido ao mesmo grupo | + — un carril por pasada, engadido ao mesmo grupo | / | ~ — tomas nun clip, escollidas dunha lista |
| Comping de tomas | + — audición, promoción, edición de rexións de comp, achatar como unha edición desfacible | + — audición, promoción, edición de rexións de comp, achatar como unha edición desfacible | / | / — sen editor de comp |
| Monitorización e medición de entrada | + | + | + | + |

## Edición da liña de tempo

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Variantes de edición en cascada | + — por clip, por pista e todas as pistas, ao cortar e eliminar | + — por clip, por pista e todas as pistas, ao cortar e eliminar | + — as mesmas tres, ao cortar e eliminar | ~ — eliminación en cascada nunha selección ou espazo |
| Dividir, unir e dividir en silencios | + | + | + | ~ — dividir e recortar, sen unir clips |
| Grupos de clips | + | + | + | + |
| Ganancia de clip | + | + | + | + |
| Ton e velocidade por clip | + — axustar, renderizar ou reiniciar | + — axustar, renderizar ou reiniciar | + — axustar, renderizar ou reiniciar | ~ — o estiramento permanece editable, o ton é un efecto |
| Seguir cambios de tempo | + — os clips estíranse cando o mapa se move | + — os clips estíranse cando o mapa se move | + | / |
| Cuantización e groove conscientes do compás | + — mapas de deformación con forza de groove axustable | + — mapas de deformación con forza de groove axustable | / | / |
| Axustar a cruces por cero | + | + | + | + |
| Dibuño a nivel de mostra | + | + | + — dispoñible ao ampliar ata as mostras individuais | + — no editor de forma de onda |
| Edición só con teclado | + — cada primitiva de edición ten unha acción de navegación | + — cada primitiva de edición ten unha acción de navegación | + — as accións de edición, a liña de tempo e as regras verticais das pistas pódense percorrer co teclado | ~ — atallos extensos, algúns paneis necesitan o rato |

## Traballo espectral e restauración

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Vista de espectrograma | + — con axustes por pista | + — con axustes por pista | + — con axustes por pista | + — mostraxes de frecuencia e ton |
| Selección con límites de frecuencia | + | + | + | + — lazo e lazo de selección |
| Pincel espectral | + | + | + | + — pincel e curación de puntos |
| Eliminar ou amplificar unha rexión espectral | + — ambas como accións directas | + — ambas como accións directas | + — ambas como accións directas | ~ — aplicar un efecto á selección |
| Reparar dano curto | + — Reparar | + — Reparar | + — Reparar | + — Curación automática e Pincel de curación de puntos |
| Redución de ruído de banda ancha | + — cun perfil capturado | + — cun perfil capturado | + — cun perfil capturado | + — Redución de ruído, Redución adaptativa de ruído, DeNoise |
| Desreverberación | / — asistencia só en Desktop | + — Reduce Reverb coa instalación do modelo e do motor opcionais | / | + — DeReverb |
| Ferramentas de clics, zumbidos e sibilancia | ~ — eliminación de clics e De-esser; sen eliminador de zumbido dedicado | ~ — eliminación de clics e De-esser; sen eliminador de zumbido dedicado | ~ — só Eliminación de clics | + — DeClicker, DeHummer, DeEsser, Eliminador de clics/pops |
| Panel de diagnóstico | ~ — Buscar recortes como analizador | ~ — Buscar recortes como analizador | ~ — Buscar recortes como analizador | + — diagnóstico con reparación por problema |

## Efectos e complementos

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Suite de efectos integrados | + — efectos derivados de Audacity, complementos Nyquist incluídos e efectos propios como Bitcrusher e De-esser | + — efectos derivados de Audacity, complementos Nyquist incluídos e efectos propios como Bitcrusher e De-esser | + — 30 efectos integrados na versión fixada | + — arredor de cincuenta, incluíndo dinámica multibanda |
| Rack de efectos en tempo real por pista | + — un conxunto en tempo real máis amplo que a montante | + — un conxunto en tempo real máis amplo que a montante | + | + — dezaseis slots por clip, pista e mestre |
| EQ paramétrico | + — un novo EQ paramétrico con bandas automatizables | + — un novo EQ paramétrico con bandas automatizables | ~ — Curva de filtro e EQ gráfico | + — filtros paramétricos, gráficos e FFT |
| Presets de efectos | + — aplicar, gardar, importar, exportar | + — aplicar, gardar, importar, exportar | + — aplicar, gardar, importar, exportar | + |
| Macros e cadeas por lotes | + — biblioteca de macros gardadas con modelos | + — biblioteca de macros gardadas con modelos | / — a versión fixada comenta o menú Macros | + — Favoritos e Proceso por lotes |
| Formatos de complementos de terceiros | / — os complementos nativos requiren Desktop | + — VST3, CLAP, AU, LV2, LADSPA de Linux e Vamp; específicos da plataforma, con consentimento e illamento | + — VST3, AU, LV2 e Nyquist, cun xestor de complementos | ~ — VST3 e AU en macOS, sen CLAP nin LV2 |
| Scripting Nyquist | + — complementos empaquetados e o prompt Nyquist | + — complementos empaquetados e o prompt Nyquist | + — complementos empaquetados e o prompt Nyquist | / |
| Paquetes de efectos en sandbox | ~ — paquetes WebAssembly revisados, un se distribúe e os externos están illados | ~ — paquetes WebAssembly revisados, un se distribúe e os externos están illados | / | / |
| Instrumentos virtuais | / | / | / | / |

## Mezcla, enrutamento e automatización

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mezclador con tiras de canal | + | + | ~ — controis de pista e unha pista mestra | + |
| Barras e submezclas | + — anidadas, con validación de ciclo | + — anidadas, con validación de ciclo | / | + — pistas de barra |
| Envolventes | + — pre e post fader, múltiples asignacións | + — pre e post fader, múltiples asignacións | / | + — pre e post fader |
| Grupos VCA | + | + | / | / |
| Entrada de cadea lateral | + | + | / | + — a través de envolventes |
| Mezclas de pista e sala de control | + | + | / | / |
| Compensación de atraso de complementos | + — reprodución, monitorización, barras, cadeas laterais, renderizado e conxelación | + — reprodución, monitorización, barras, cadeas laterais, renderizado e conxelación | ~ — non exposto nas fontes fixadas | + |
| Carrís de automatización | + — ganancia, panorámica, silencio, envolventes, barras e parámetros de complementos | + — ganancia, panorámica, silencio, envolventes, barras e parámetros de complementos | ~ — envolventes de ganancia do clip; sen pistas de automatización de pista ou efectos | + — volume, panorámica e parámetros de efectos |
| Modos de automatización | + — ler, recortar, tocar, retención e escribir | + — ler, recortar, tocar, retención e escribir | / | ~ — ler, escribir, retención e tocar, sen recortar |
| Formas de curva | + — liña, manter e curva | + — liña, manter e curva | ~ — só envolventes de ganancia do clip | + — lineal e spline |
| Conxelación de pista | + — conxelar, desconxelar e confirmar sen perder estado | + — conxelar, desconxelar e confirmar sen perder estado | / | ~ — rebotar a unha nova pista |

## Medición e análise

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Medidor de sonoridade | + — estilo EBU R 128, con histórico | + — estilo EBU R 128, con histórico | / — un efecto de Normalización de sonoridade pero sen medidor | + — Radar de sonoridade a ITU-R BS.1770 |
| Medidor de fase e correlación | + | + | / | + — medidor de fase e análise |
| Medición de son envolvente | + | + | / | ~ — ata 5.1 |
| Gráfico de espectro | + — Gráfico de espectro | + — Gráfico de espectro | ~ — rexistrado, pero a versión fixada coméntao no menú Analizar | + — Análise de frecuencia |
| Recortes e RMS na forma de onda | + — alternadores do proxecto con sobrescrituras RMS por pista | + — alternadores do proxecto con sobrescrituras RMS por pista | + — ambos, conmutados por proxecto | ~ — indicadores de recorte, RMS en Estatísticas de amplitude |
| Contraste de intelixibilidade da fala | + — Analizador de contraste | + — Analizador de contraste | ~ — rexistrado, pero a versión fixada coméntao no menú Analizar | / |

En Soundscaper, abre o menú **Visualización da pista** dunha pista para activar ou desactivar **Media onda** ou **Mostrar RMS na forma de onda**. A vista predeterminada, as frecuencias de corte de 3 bandas e os axustes do espectrograma están en **Editar → Preferencias → Visualización da pista**.

## Canais e son inmersivo

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Canais por ficheiro | + — ata 32 para formatos PCM | + — ata 32 para formatos PCM | ~ — pistas mono e estéreo | + — ata 32 no editor de forma de onda |
| Mezcla envolvente | + — leitos ata 7.1.4 | + — leitos ata 7.1.4 | / | ~ — ata 5.1 |
| Audio baseado en obxectos | + — obxectos xunto con leitos | + — obxectos xunto con leitos | / | / |
| Creación e passthrough de ADM | + — BW64/ADM con comprobacións de conformidade | + — BW64/ADM con comprobacións de conformidade | / | / |
| Render binaural | + — un modelo binaural nomeado | + — un modelo binaural nomeado | / | ~ — binauralizador para ambisonics |
| Ambisonics | / | / | / | + — primeira orde, cun panner VR |

## Exportación e entrega

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Saída sen perdas | + — WAV, AIFF, BWF e BW64 nativos; FLAC e WavPack mediante códecs dedicados | + — WAV, AIFF, BWF e BW64 nativos; FLAC e WavPack mediante códecs dedicados | + — WAV, AIFF e FLAC | + — WAV, AIFF, FLAC e máis |
| Saída con perdas | ~ — MP3, MP2, Opus e Ogg Vorbis; AAC depende do navegador | + — MP3, MP2, Opus, Ogg Vorbis e AAC mediante provedores de códecs admitidos, incluído FFmpeg configurado | + — MP3, Opus e Ogg Vorbis; formatos adicionais mediante FFmpeg opcional | ~ — MP2, MP3 e Ogg Vorbis; máis mediante Adobe Media Encoder, sen destino xeral de FFmpeg |
| Ajustes personalizados de codificador | ~ — controis por formato; non se admiten argumentos FFmpeg personalizados | ~ — controis por formato; non se admiten argumentos FFmpeg personalizados | + — un obxectivo FFmpeg personalizado | + — opcións por formato |
| Cola de exportación | + — pausar, cancelar, reintentar e reordenar | + — pausar, cancelar, reintentar e reordenar | / — Exportar varios é unha única operación secuencial, non unha cola de tarefas | ~ — Procesamento por lotes sen control de cola |
| Stems e alternativos nunha pasada | + — en cola xunto coa mestura | + — en cola xunto coa mestura | ~ — Exportar varios garda cada pista por separado, pero non pon a mestura e as renderizacións alternativas xuntas na cola | ~ — unha mestura por stem |
| Entrega rexión a rexión | + — secuencias de mestura con metadatos por rexión, espazos e fundidos | + — secuencias de mestura con metadatos por rexión, espazos e fundidos | + — Exportar varios garda cada rexión etiquetada nun ficheiro propio | + — exportación de marcadores a ficheiros separados |
| Normalización de sonoridade na exportación | + — parte do plan de entrega | + — parte do plan de entrega | ~ — executar o efecto primeiro | + — Match Loudness |
| Dither e mapeo de canais | + — controis explícitos | + — controis explícitos | ~ — dither nas preferencias | + — controis explícitos |
| Informe de entrega | + — detallado por traballo | + — detallado por traballo | / | / |
| A cola de render sobrevive a un reinicio | / — a recuperación persistente da renderización require Desktop | + — reinicia desde o byte cero cun diario de fallos | / | / |

Soundscaper Desktop pode usar FFmpeg configurado para os formatos de exportación admitidos; o editor actual non ofrece argumentos FFmpeg arbitrarios nin todos os codificadores de FFmpeg. Consulta [Formatos de exportación](/reference/generated/formats/) para ver os destinos rexistrados. O [fluxo de exportación](https://www.audacityteam.org/manual/getting-started/export-your-audio/) de Audacity engade formatos mediante unha instalación opcional de FFmpeg. Audition ofrece un conxunto fixo de escritores de ficheiros e unha [transferencia a Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Intercambio con outras ferramentas

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Proxectos de Audacity | + — importa AUP, AUP3 e AUP4; exporta AUP3 e AUP4 cun informe de compatibilidade | + — importa AUP, AUP3 e AUP4; exporta AUP3 e AUP4 cun informe de compatibilidade | + — importa AUP, AUP3 e AUP4; exporta AUP4, non AUP3 | / |
| Sesións de Audition | / — a importación de SESX require Desktop | ~ — importación de audio `.sesx` cun informe de omisións; sen exportación | / — non hai importación de SESX na versión fixada | + — nativo |
| EDL | ~ — exportación de clase CMX3600, sen importación | ~ — exportación de clase CMX3600, sen importación | / | / |
| OpenTimelineIO | ~ — só exportación | ~ — só exportación | / | / |
| FCPXML | ~ — só exportación | ~ — só exportación | / | + — importación e exportación |
| DAWproject | + — importación e exportación, cun informe de intercambio | + — importación e exportación, cun informe de intercambio | / | / |
| OMF | / | / | / | ~ — importación e exportación |
| Ida e volta cun editor de vídeo | ~ — pasa o mesmo proxecto a Framescaper sen copiar medios | ~ — pasa o mesmo proxecto a Framescaper sen copiar medios | / | + — Dynamic Link con Premiere Pro |
| Intercambio de etiquetas e marcadores | + — importación e exportación | + — importación e exportación | + — importación e exportación | + — listas de marcadores |

Para importar un `.sesx` de Audition, consulta [Ficheiros de proxecto](/projects-and-data/project-files/) para saber que axustes de audio se transfiren e que marca o informe como omitido.

## Vídeo

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Importar vídeo para referencia | + — na liña de tempo, con audio vinculado | + — na liña de tempo, con audio vinculado | / | ~ — unha pista de vídeo, só previsualización |
| Edición da liña de tempo de vídeo | ~ — edición básica, a superficie completa é Framescaper | ~ — edición básica, a superficie completa é Framescaper | / | / |
| Exportación de vídeo | ~ — MP4 e WebM cando os WebCodecs do navegador admiten os códecs necesarios | + — MP4 e WebM cun provedor de códecs de escritorio verificado | / | / — só audio |
| Composición, corrección de cor e efectos | ~ — en Framescaper, no mesmo proxecto | ~ — en Framescaper, no mesmo proxecto | / | / |

## Axuda da máquina

A asistencia de escritorio está dispoñible tras instalar pesos de modelo opcionais e un motor nativo correspondente; estes fluxos de traballo non están dispoñibles en Web. O xestor de modelos instala ambos. Consulta [Asistencia local](/reference/generated/local-assistance/) para ver os fluxos de traballo e modelos dispoñibles.

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mellora da fala | / — asistencia só en Desktop | + — co modelo e o motor opcionais instalados | / | + — Enhance Speech |
| Transcripción e diarización | / — asistencia só en Desktop | + — cos modelos e motores opcionais instalados | / | / — as transcripcións están en Premiere Pro |
| Separación de fontes en stems | / — asistencia só en Desktop | + — co modelo e o motor opcionais instalados | / | / |
| Ducking automático | + — efecto Auto Duck | + — efecto Auto Duck | + — efecto Auto Duck | + — ducking de Essential Sound |
| Detección de compás e disparos | / — a detección do ritmo require Desktop; a detección de planos está en Framescaper | ~ — detección do ritmo cun modelo opcional; detección de planos en Framescaper | / | ~ — Remix retemporiza a música automaticamente |
| Funciona por completo na túa máquina | + — procesamento local no navegador; sen inferencia de modelos | + — procesamento local e inferencia sen conexión tras instalar o modelo | + — sen inferencia en absoluto | ~ — algúns recursos procesan na nube de Adobe |
| Os modelos son opcionais e eliminables | / — non se instalan modelos en Web | + — descargados separadamente, fixados por resumo, eliminables | + — nada que instalar | / — incluídos coa aplicación |

## A que se suman as diferenzas

Audacity 4 é un editor dunha soa pasada. Na versión fixada non hai buses, envíos, pistas de automatización de pista ou efectos nin macros. As envolventes de ganancia do clip permiten automatizar o volume dentro dun clip. Soundscaper mantén ese modelo de edición e engade automatización de pistas e efectos, mestura e entrega, ademais de funcións de gravación, vídeo e intercambio que Audacity non aborda.

Audition segue destacando pola profundidade da restauración, os intercambios con Premiere Pro e o audio ambisónico. Soundscaper destaca pola entrega inmersiva, a xestión de proxectos e a posibilidade de funcionar nun navegador en hardware que os outros dous non admiten.

Se xa traballas con Audacity, consulta [Ficheiros de proxecto e intercambio con Audacity](/projects-and-data/project-files/) para saber como trasladar un proxecto.
