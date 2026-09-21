---
title: "Editar, mesturar e exportar"
description: "Organiza os clips, equilibra as pistas, aplica efectos e crea un ficheiro de entrega."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"gl"} -->

## Ordenar clips

Selecciona clips ou un intervalo de tempo antes de escoller un comando de edición. Split crea un límite de edición na cabeceira de reprodución. As variantes de preservación de espazos e ripple determinan se o material posterior permanece no seu lugar ou se move para pechar a rexión eliminada.

Usa carpetas de pistas, grupos de clips e a Caixa de Proxecto para manter proxectos máis grandes organizados.

### Axustar fundidos de clips {#clip-fades}

Selecciona un clip de audio para revelar pequenos manexos triangulares ao longo da parte superior da súa forma de onda, directamente debaixo da cabeceira do clip.
Arrastra o triángulo esquerdo cara dentro para un fundido de entrada, ou o triángulo dereito cara dentro para un fundido de saída. A forma de onda cambia mentres arrastras, e a área sobre a curva do fundido vese máis escura. Os triángulos seguen os límites do fundido; arrastrar un de volta ao seu canto elimina ese fundido. Só cambia o clip que arrastras, aínda que estean seleccionados varios clips.

Os manexos desaparecen cando deseleccionas o clip, pero a forma de onda fundida e a sombreo permanecen. Estes fundidos preservan o audio orixinal e permanecen axustables despois de gardar e reabrir o proxecto. Solta para confirmar un fundido, ou preme **Escape** mentres arrastras para cancelar. **Deshacer** revirte un arrastre completo. A reprodución e a exportación usan os axustes de fundido confirmados.

Cun clip seleccionado e enfocado, preme **Tab** para chegar aos seus manexos de fundido. As teclas de flecha axustan a duración en 10 milisegundos, ou 100 milisegundos con **Shift**. **Home** elimina o fundido; **End** esténdeo por todo o clip. Para entrada numérica, escolle **Editar → Clips de audio → Propiedades do clip** e usa **Fundidos**.

## Construír a mestura

Usa os controis de ganancia de pista, panorámica, silencio e solo para equilibrar o proxecto. O panel de Mezclador expón o mesmo estado do proxecto nunha disposición orientada á mestura. Os efectos en tempo real permanecen axustables; as operacións destructivas ou renderizadas crean cambios no proxecto que se poden desfacer mentres a historia estea dispoñible.

Usa o medidor de reprodución e a análise de sonoridade para inspeccionar o resultado. Evita tratar un obxectivo de medidor como substituto de escoitar a exportación completa.

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

Os formatos comprimidos usan o tempo de execución FFmpeg. Os formatos exactos e a dispoñibilidade condicional están listados na [referencia de formatos xerada](/reference/).

Reproduce o ficheiro exportado noutro aplicativo antes de entregar ou eliminar o material de orixe.

Para traballo con imaxe — compoñer unha secuencia, efectos de vídeo e unha entrega MP4 ou WebM — pasa o proxecto a [Framescaper](/framescaper/) e consulta [exportar vídeo](/framescaper/video-export/).
