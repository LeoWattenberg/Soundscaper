---
title: "Programas de macros"
description: "La API de JavaScript contra la que se ejecuta un programa de macros, los límites bajo los que se ejecuta y el archivo en el que se transporta."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"es"} -->

Un programa de macro es una macro escrita en JavaScript en lugar de como una lista de pasos.
Se ejecuta dentro del editor contra una pequeña API llamada `sound`, que le permite leer
el proyecto abierto, mover la selección y aplicar los mismos efectos y comandos que una
macro de lista de pasos puede aplicar. Todo lo demás, desde archivos y la red hasta sus
otros proyectos, está fuera de su alcance.

Los programas son una función de Soundscaper. Framescaper no tiene un gestor de macros.

## Dónde residen los programas

Elija **Herramientas → Gestor de macros**. El diálogo lista las macros de lista de pasos y, bajo
**Programas**, los programas que ha guardado. **Nuevo programa** crea uno, y el
panel de detalles muestra su **Nombre del programa**, el texto del **Programa** y un botón **Ejecutar
programa**. El texto se guarda mientras escribe; no hay un paso de guardado separado.

Un programa se almacena con la configuración del editor, no dentro de un proyecto, por lo que está
disponible en cada proyecto que abra en este editor. Use **Exportar programa** y
**Importar programa** para moverlo a otra máquina o a otra persona; consulte
[Compartir programas](#sharing-programs) para ver qué implica eso.


La guía [Aplicar la misma cadena de efectos cada vez](/guides/effects/apply-the-same-effects-every-time/)
cubre el lado de la lista de pasos del mismo diálogo.

## Escribir un programa

Un programa es el cuerpo de una función `async`, ejecutado en modo estricto. Esto significa que
puede `await` en el nivel superior, declarar variables y funciones, y usar cada
función de lenguaje ordinaria. El objeto `sound` es la única conexión del programa con
el editor, y cada llamada en él devuelve una promesa.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab inserta dos espacios en el campo de programa. Presiona Escape y luego Tab para salir
del campo.

### Lo que un programa puede usar

La biblioteca estándar de JavaScript habitual está presente: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, los typed arrays, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` y `queueMicrotask`. `console`
también está presente, y todo lo que se escriba en él aparecerá en el registro del programa.

### Lo que un programa no puede usar

Un programa se ejecuta en un worker al que se le han retirado sus capacidades antes de que
se ejecute la primera línea. Ninguno de los siguientes existe dentro de un programa: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` y `setInterval`. Leer cualquiera de ellos devuelve `undefined`.

Un programa no puede `import` un módulo; un `import` estático es un error de sintaxis en la
línea que lo contiene. Todo lo que el programa necesite debe estar dentro del programa.

La frontera de seguridad no son las globales ausentes, sino el propio editor: solo
responde a las llamadas enumeradas en esta página y rechaza todo lo demás por nombre,
cualquiera que sea lo que un programa logre enviarle.

## Ejecución de un programa

Presiona **Ejecutar programa**. Toda la ejecución es una sola entrada en el historial del proyecto, por lo
que un solo **Deshacer** revierte todo lo que el programa hizo, sin importar cuántos cambios haya realizado.
Si el programa lanza una excepción, se cancela o supera su plazo de tiempo, el proyecto se
restaura exactamente como estaba antes de que comenzara la ejecución.

**Cancelar ejecución** detiene un programa de inmediato. Un programa que lleva dos
minutos en ejecución se detiene de la misma manera, con el mensaje *La macro se ejecutó durante más de
120 segundos.*

Después de la ejecución, el panel muestra el registro del programa, seguido de *Programa aplicado.*
cuando la ejecución se completó. Una ejecución fallida muestra *El programa falló en la línea N:* y
el mensaje del error, donde el número de línea es la línea de tu programa que
lanzó la excepción.

### Qué audio toca un efecto

Un efecto aplicado por un programa se ejecuta sobre la selección de tiempo actual en la
pista enfocada, que es la pista cuya cabecera hiciste clic por última vez o cuyo clip
seleccionaste por última vez. Cuando no hay una selección de tiempo pero sí un clip seleccionado, el
efecto cubre ese clip. Las llamadas de selección de un programa cambian el rango de tiempo y
el conjunto de pistas seleccionadas, pero no qué pista tiene el enfoque, por lo que una ejecución procesa
una sola pista. Si nada está enfocado o la selección está vacía, la ejecución falla con
el mismo mensaje que da el menú Efecto.

## La API de `sound`

Cada método a continuación devuelve una promesa a menos que se indique lo contrario. Espera cada llamada
antes de realizar la siguiente; un programa que inicie más de ocho llamadas sin
esperarlas tiene la novena rechazada.

### `sound.env`

Un objeto simple que describe la ejecución.

| Campo | Significado |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | El idioma de la interfaz del editor, como `"en"` o `"de"`. |
| `seed` | La semilla de la que provienen los números aleatorios de la ejecución. Nueva en cada ejecución. |
| `startedAt` | La hora real en que comenzó la ejecución, como una cadena ISO 8601. |
| `dryRun` | Siempre `false` por el momento. Reservado. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` y `sound.log.debug(...values)` escriben una línea
cada uno en el registro de la ejecución. `console.log`, `console.info`, `console.warn`,
`console.error` y `console.debug` hacen lo mismo. Los valores que no son cadenas se
escriben como JSON. Estos métodos no devuelven nada y no necesitan ser esperados.

Un registro contiene como máximo 1.000 líneas o 256 KiB, lo que ocurra primero, y cada línea
se corta en 4.096 caracteres. Las líneas que excedan ese límite se descartan y se cuentan; la cuenta
se informa como una advertencia final.

### `sound.project`

Leer el proyecto nunca lo modifica y no cuenta contra el presupuesto de cambios de la ejecución.

`sound.project.snapshot()` devuelve `{ sampleRate, tracks, selection }`, con
`tracks` y `selection` tal como las devuelven las dos llamadas siguientes. `sampleRate` es la
tasa de muestreo del proyecto en hercios, que es la unidad en la que se miden todos los recuentos de fotogramas en esta página.

`sound.project.tracks()` devuelve un array de pistas en orden de línea de tiempo:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` devuelve las clips en una pista, o en todas las pistas
si se omite `trackId`:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` devuelve la selección actual:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Cada llamada de selección cuenta como un cambio y devuelve la selección que produjo,
en la forma que devuelve `sound.project.selection()`.

`sound.select.time(start, end, options)` establece el rango de tiempo en segundos. Es
el comando `SelectTime` de Audacity, y `options.relativeTo` elige desde dónde se mide cada
borde. Ambos bordes pueden ser tan bajos como -100 segundos.

| `relativeTo` | Borde inicial | Borde final |
| --- | --- | --- |
| `'project-start'` (predeterminado) | `start` segundos desde el inicio del proyecto | `end` segundos desde el inicio del proyecto |
| `'project'` | `start` segundos desde el inicio del proyecto | `end` segundos después del final del proyecto |
| `'project-end'` | `start` segundos antes del final del proyecto | `end` segundos antes del final del proyecto |
| `'selection-start'` | `start` segundos después del inicio de la selección | `end` segundos después del inicio de la selección |
| `'selection'` | `start` segundos después del inicio de la selección | `end` segundos después del final de la selección |
| `'selection-end'` | `start` segundos antes del final de la selección | `end` segundos antes del final de la selección |

El final del proyecto es el último cuadro al que llega cualquier clip. Las pistas seleccionadas se dejan
como estaban.

`sound.select.frames(startFrame, endFrame, options)` establece el rango de tiempo en
marcos a la tasa de muestreo del proyecto. `options.trackIds` nombra las pistas a
seleccionar; cuando se omite, las pistas que ya están seleccionadas permanecen seleccionadas.
El rango se limita a la línea de tiempo y los bordes se intercambian si están invertidos.

`sound.select.tracks(options)` es el comando `SelectTracks` de Audacity. Selecciona
las pistas cuyo índice (contado desde 0) está en el rango desde `options.track`
(predeterminado 0) abarcando `options.trackCount` pistas (predeterminado 1). `options.mode` es
`'set'` para reemplazar la selección de pistas, `'add'` para ampliarla, o `'remove'` para
quitar esas pistas de ella. El rango de tiempo se deja como estaba.

`sound.select.frequencies(options)` es el comando `SelectFrequencies` de Audacity.
Establece la selección espectral en `options.low` y `options.high` en hercios;
un borde que se omite mantiene su valor actual.

`sound.select.all()` selecciona todo el proyecto en cada pista.
`sound.select.none()` limpia la selección.

### `sound.effect(type, params)`

Aplica un efecto sobre la selección actual, en la pista enfocada. `type` es
un ID de efecto de [Efectos que un programa puede aplicar](#effects-a-program-can-apply),
y `params` es un objeto de los parámetros de ese efecto. Los parámetros que se omiten toman
los valores predeterminados del efecto; los valores se comprueban contra los rangos en la
[referencia de efectos de audio](/reference/generated/audio-effects/). Se resuelve en
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Aplica una cadena de efectos sobre la selección actual en una sola pasada, exactamente como lo haría una macro de lista de pasos con esos pasos. Cada paso es `{ type, params }`, y la cadena necesita al menos un paso. Se resuelve en `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Ejecuta uno de los comandos de macros de Audacity enumerados en
[Comandos que un programa puede ejecutar](#commands-a-program-can-run). Los cuatro comandos de selección toman los parámetros descritos allí; los demás no toman ninguno. Se resuelve en la selección posteriormente.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Ejecuta una macro de lista de pasos guardada en el mismo gestor de macros, por su nombre exacto,
incluyendo cualquier comando de selección que contenga. Una macro guardada no puede ser un
programa, por lo que los programas no se anidan. Se resuelve a `null`; un nombre desconocido se rechaza.

### Tiempo y aleatoriedad

Una ejecución es reproducible: dos ejecuciones del mismo programa sobre el mismo proyecto leen
lo mismo, porque el reloj y los números aleatorios no son los de la máquina.

`Date.now()` y `new Date()` sin argumentos devuelven un reloj virtual que
comienza en 0 y avanza en uno por cada llamada respondida al editor, y en
`ms` por cada `sound.wait(ms)`. `sound.wait` se resuelve inmediatamente; no hay
forma de que un programa se detenga por tiempo real, y no es necesario, porque cada llamada
al editor se completa antes de que su promesa se resuelva.

`Math.random()` y `sound.random()` son el mismo generador, sembrado desde
`sound.env.seed`. Registre la semilla si necesita saber qué secuencia usó una ejecución.

### Verificar sus suposiciones

`sound.assert(condition, message)` lanza `message` cuando `condition` es falso.
`sound.assertEqual(actual, expected, message)` compara los dos valores como JSON
y lanza una excepción cuando difieren, con un mensaje que nombra ambos valores si no
proporciona ninguno. Dado que un error lanzado termina la ejecución y revierte todo lo anterior, una
aserción fallida deja el proyecto intacto. Ninguno de los dos métodos devuelve una promesa.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Valores que se transmiten al editor

Cada argumento que un programa pasa y cada valor que recibe son datos simples:
`null`, booleanos, números finitos, cadenas de caracteres y matrices y objetos simples de
dichos tipos. `NaN`, `Infinity`, funciones, instancias de clases, matrices tipadas y objetos `Date`
se rechazan con un error, al igual que cualquier valor mayor que 1 MiB, anidado más
de 12 niveles de profundidad o que contenga más de 4.096 entradas en una sola matriz u objeto.
Se descartan las propiedades `undefined`.

## Límites

| Límite | Valor |
| --- | --- |
| Longitud del programa | 256 KiB |
| Llamadas al editor por ejecución | 4.096 |
| Cambios en el proyecto por ejecución (llamadas de selección, efectos, comandos) | 256 |
| Llamadas esperando una respuesta a la vez | 8 |
| Tiempo de ejecución | 120 segundos |
| Un valor que se transmite al o desde el editor | 1 MiB, 12 niveles de profundidad, 4.096 entradas por matriz u objeto |
| Registro | 1.000 líneas o 256 KiB; 4.096 caracteres por línea |
| Programas en la biblioteca | 128 |
| Nombre del programa | 256 caracteres |
| Archivo de programa importado | 1 MiB |

Un bucle que selecciona cada clip y aplica un efecto consume dos cambios por
clip, por lo que puede cubrir 128 clips antes de agotar el presupuesto.

## Errores

Una llamada que el editor rechaza rechaza su promesa con un `Error` cuyo `message`
indica la razón: un comando fuera del vocabulario, un efecto sobre una selección vacía,
un parámetro fuera de rango. El error también incluye un `code`, que es
`MACRO_CALL_FAILED` a menos que el editor proporcione uno más específico. Un programa
puede capturar estos errores y continuar:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Ese programa se completa y su registro dice *refused: Unsupported macro command:
ExportWav.*

Un error que el programa no captura termina la ejecución, revierte el proyecto y se
muestra en el panel con la línea de la que proviene. Un programa que no se puede
compilar se informa de la misma manera antes de que se ejecute nada.

## Efectos que un programa puede aplicar {#effects-a-program-can-apply}

Estos son los IDs de efecto que `sound.effect` y `sound.effects` aceptan, con las
claves de parámetros que cada uno toma y sus valores predeterminados. Los rangos y unidades están en la
[referencia de efectos de audio](/reference/generated/audio-effects/). Los complementos
Nyquist no se pueden aplicar desde un programa.

| Efecto | ID de efecto | Parámetros y valores predeterminados |
| --- | --- | --- |
| Amplificar | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Auto Duck | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Graves y Agudos | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Cambiar tono | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Cambiar velocidad y tono | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Cambiar tempo | `audacity-change-tempo` | `tempoPercent: 0` |
| Filtros clásicos | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Eliminación de clics | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compresor | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Compresor (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Retardo | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distorsión | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Eco | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Fundido de entrada | `audacity-fade-in` | ninguno |
| Fundido de salida | `audacity-fade-out` | ninguno |
| EQ de curva de filtro | `audacity-filter-curve-eq` | `points`: un arreglo de `{ frequency, gain }`, predeterminado dos puntos planos a 20 Hz y 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| EQ paramétrico de cuatro bandas | `eq` | `outputGain: 0`; `bands`: cuatro objetos `{ id, enabled, type, frequency, gain, q, slope }`, con picos en 100, 500, 2000 y 8000 Hz con `gain: 0`, `q: 1`, `slope: 12` |
| Puerta | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| EQ gráfico | `audacity-graphic-eq` | `gains`: ganancias de 31 bandas en dB, todas 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Filtro paso alto | `highpass` | `frequency: 80`, `q: 0.707` |
| Invertir | `audacity-invert` | ninguno |
| Compresor heredado | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limitador | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limitador (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalización de sonoridad | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Filtro paso bajo | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Reducción de ruido | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalizar | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Eliminar desplazamiento DC | `audacity-remove-dc-offset` | ninguno |
| Reparar | `audacity-repair` | ninguno |
| Repetir | `audacity-repeat` | `count: 1` |
| Reverberación | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverse | `audacity-reverse` | none |
| Sliding Stretch | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncate Silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Utility Gain (Reviewed) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Dos efectos requieren algo que un programa no puede proporcionar. Noise Reduction necesita un perfil de ruido capturado en el propio diálogo del efecto, y Auto Duck necesita una pista de control debajo de la pista enfocada.

## Comandos que un programa puede ejecutar {#commands-a-program-can-run}

`sound.command` acepta los nombres de comandos de macros de Audacity a continuación. Son los mismos nombres que puede contener una macro de lista de pasos, por lo que un programa y una lista de pasos tienen exactamente el mismo alcance. Cada comando ejecuta la acción del editor que describe la [referencia de comandos](/reference/generated/commands/).

### Comandos de selección con parámetros

| Comando | Parámetros |
| --- | --- |
| `SelectTime` | `start`, `end` en segundos; `relativeTo` como para `sound.select.time` |
| `SelectFrequencies` | `low`, `high` en hercios |
| `SelectTracks` | `track`, `trackCount` (0 a 100); `mode` de `'set'`, `'add'` o `'remove'` |
| `Select` | Cualquier combinación de los tres conjuntos anteriores |

Un parámetro que se omita deja esa parte de la selección intacta, que es cómo Audacity también los interpreta.

### Comandos sin parámetros

| Grupo | Comandos |
| --- | --- |
| Selección | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Edición | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Pistas | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Etiquetas | `AddLabel` |
| Análisis | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Lo que está deliberadamente ausente

`Undo` y `Redo` están ausentes porque una ejecución ya es una entrada del historial y un paso que recorriera el historial alcanzaría más allá de la ejecución hasta las propias ediciones. Los comandos de transporte y grabación están ausentes porque un programa no tiene nada que esperar y no puede deshacerse de una grabación. Abrir, guardar, cerrar, importar, exportar y preferencias están ausentes porque el alcance de un programa es el único proyecto que estaba abierto cuando comenzó. Los comandos que solo abren un diálogo o cambian la vista están ausentes porque no cambian nada en el proyecto.

## Compartir programas {#sharing-programs}

**Exportar programa** escribe el programa seleccionado como un archivo `.soundscapemacro`, y **Importar programa** lee uno. El archivo es JSON en lugar de un archivo `.js` simple, por lo que nada en la computadora receptora lo confundirá con algo para ejecutar fuera del editor:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Importación almacena el texto y nada más. Un programa importado no tiene el botón **Ejecutar
programa**; en su lugar, el panel muestra el programa, el archivo del que proviene,
una nota sobre lo que un programa puede hacer al proyecto abierto y una casilla de verificación que dice *He leído este programa y quiero ejecutarlo.* Marcarla habilita **Habilitar este
programa**, y solo entonces se puede ejecutar el programa.

Ese permiso es para el texto exacto que leíste. Si el programa cambia
después, ya sea que lo edites o importes una copia más nueva sobre él, la revisión
aparece de nuevo hasta que habilites el nuevo texto. Los programas que escribas tú mismo en el gestor
no necesitan revisión.

## Ejemplos

Desvanecer cada clip en la primera pista que tenga alguno. Haz clic en la cabecera de esa pista
antes de ejecutar, para que el efecto se aplique a la pista que el programa está leyendo:

```js
let target = null;
let clips = [];
for (const track of await sound.project.tracks()) {
  clips = await sound.project.clips(track.id);
  if (clips.length) {
    target = track;
    break;
  }
}
sound.assert(target, 'There are no clips to fade.');
for (const clip of clips) {
  await sound.select.frames(clip.startFrame, clip.startFrame + clip.durationFrames, {
    trackIds: [target.id],
  });
  await sound.effect('audacity-fade-in');
  sound.log.info(`Faded in ${clip.name} on ${target.name}`);
}
```

Informe del proyecto sin modificarlo:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Ejecutar una macro de lista de pasos guardada solo cuando la selección sea lo suficientemente larga:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Acerca de esta página

Cada programa de esta página, desde los fragmentos de una línea hasta los ejemplos desarrollados,
se ejecuta contra cada compilación de Soundscaper mediante la suite del navegador
(`tests/browser/handbook-macro-program-examples.spec.js`), que lee los
programas del propio texto de esta página. Un programa que deja de completarse, o deja de
producir lo que esta página indica que produce, hace fallar la compilación hasta que se corrija la página o el
editor.
