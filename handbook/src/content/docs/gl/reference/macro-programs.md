---
title: "Programas de macros"
description: "A API de JavaScript contra a que se executa un programa de macros, os límites baixo os que se executa e o ficheiro no que viaxa."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"gl"} -->

Un programa de macro é unha macro escrita en JavaScript en lugar dunha lista de pasos.
Exécutase dentro do editor contra unha pequena API chamada `sound`, que lle permite ler
o proxecto aberto, mover a selección e aplicar os mesmos efectos e comandos que unha
macro de lista de pasos pode aplicar. Todo o resto, desde ficheiros e a rede ata os
tus outros proxectos, está fóra do seu alcance.

Os programas son unha función de Soundscaper. Framescaper non ten xestor de macros.

## Onde están os programas

Escolle **Ferramentas → Xestor de macros**. O diálogo lista as macros de lista de pasos e, baixo
**Programas**, os programas que gardaches. **Novo programa** crea un, e o
panel de detalles amosa o seu **Nome do programa**, o texto do **Programa** e un botón **Executar
programa**. O texto gárdase mentres escribes; non hai un paso de gardado separado.

Un programa gárdase cos axustes do editor, non dentro dun proxecto, polo que está
dispoñible en cada proxecto que abras neste editor. Usa **Exportar programa** e
**Importar programa** para mover un a outra máquina ou outra persoa; consulta
[Compartir programas](#sharing-programs) para saber o que implica.

A guía [Aplicar a mesma cadea de efectos cada vez](/guides/effects/apply-the-same-effects-every-time/)
cobre o lado da lista de pasos do mesmo diálogo.

## Escribir un programa

Un programa é o corpo dunha función `async`, executado en modo estrito. Isto significa que
podes `await` no nivel superior, declarar variables e funcións e usar cada
función ordinaria da lingua. O obxecto `sound` é a única conexión do programa co
editor, e cada chamada nel devolve unha promesa.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

A pestana insire dous espazos no campo do programa. Prema Escape e despois Tab para saír
do campo.

### O que un programa pode usar

A biblioteca estándar habitual de JavaScript está presente: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, os arrays tipados, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` e `queueMicrotask`. `console`
tamén está presente, e todo o que se escriba nel vai ao rexistro do programa.

### O que un programa non pode usar

Un programa execútase nun traballador ao que se lle quitaron as súas capacidades antes de que
se execute a primeira liña. Ningunha das seguintes cousas existe dentro dun programa: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` e `setInterval`. Ler calquera delas dá `undefined`.

Un programa non pode `import` un módulo; un `import` estático é un erro de sintaxe na
liña que o contén. Todo o que o programa necesite ten que estar no programa.

A fronteira de seguridade non son os globais que faltan, senón o propio editor: só
responde ás chamadas listadas nesta páxina e rexeita todo o resto polo nome,
sexa calquera cousa que un programa logre enviarlle.

## Executar un programa

Prema **Executar programa**. Toda a execución é unha entrada no historial do proxecto, polo que
un **Deshacer** revirte todo o que o programa fixo, cantoas cambios faga.
Se o programa lanza unha excepción, ou é cancelado, ou executa máis alá do seu prazo, o proxecto
restaurase exactamente como estaba antes de que comezase a execución.

**Cancelar execución** detén un programa de inmediato. Un programa que leva dous
minutos a executar detense da mesma maneira, coa mensaxe *A macro executouse durante máis de
120 segundos.*

Despois da execución, o panel amosa o rexistro do programa, seguido de *Programa aplicado.*
cando a execución se completou. Unha execución fallida amosa *O programa fallou na liña N:* e
a mensaxe do erro, onde o número de liña é a liña do teu programa que
lanxou a excepción.

### Que audio toca un efecto

Un efecto aplicado por un programa execútase sobre a selección de tempo actual na
pista enfocada, que é a pista cuxa cabeceira preches por última vez ou cuxo clipe
seleccionaches por última vez. Cando non hai selección de tempo pero hai un clipe seleccionado, o
efecto cobre ese clipe. As chamadas de selección dun programa cambian o rango de tempo e
o conxunto de pistas seleccionadas, pero non cal pista ten o enfoque, polo que unha execución procesa
unha pista. Se nada está enfocado ou a selección está baleira, a execución falla coa
mesma mensaxe que dá o menú Efecto.

## A API `sound`

Cada método seguinte devolve unha promesa a menos que se diga o contrario. Agarda cada chamada
antes de facer a seguinte; un programa que comeza máis de oito chamadas sen
agardalas ten a novena rexeitada.

### `sound.env`

Un obxecto simple que describe a execución.

| Campo | Significado |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | A lingua da interface do editor, como `"en"` ou `"de"`. |
| `seed` | A semente da que proceden os números aleatorios da execución. Nova para cada execución. |
| `startedAt` | A hora real na que comezou a execución, como unha cadea ISO 8601. |
| `dryRun` | Sempre `false` de momento. Reservado. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` e `sound.log.debug(...values)` escriben unha liña
cada un no rexistro da execución. `console.log`, `console.info`, `console.warn`,
`console.error` e `console.debug` fan o mesmo. Os valores que non son cadeas escríbense
como JSON. Estes métodos non devolven nada e non necesitan ser agardados.

Un rexistro contén como máximo 1.000 liñas ou 256 KiB, o que ocorra primeiro, e cada liña
córtese a 4.096 caracteres. As liñas que excedan ese límite descártanse e contanse; a contaxe
informase como un aviso final.

### `sound.project`

Ler o proxecto nunca o modifica e non conta contra o orzamento de cambios da execución.

`sound.project.snapshot()` devolve `{ sampleRate, tracks, selection }`, con
`tracks` e `selection` tal e como as devolven as dúas chamadas seguintes. `sampleRate` é a
taxa de mostraxe do proxecto en hertz, que é a unidade na que se mide cada contaxe de fotogramas nesta páxina.

`sound.project.tracks()` devolve un array de pistas en orde de liña temporal:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` devolve os clips dunha pista, ou de todas as pistas
cando se omite `trackId`:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` devolve a selección actual:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Cada chamada de selección conta como un cambio e devolve a selección que produciu,
na forma que devolve `sound.project.selection()`.

`sound.select.time(start, end, options)` establece o intervalo de tempo en segundos. É o
comando `SelectTime` de Audacity, e `options.relativeTo` elixe desde onde se mide cada
borde. Ambos os bordes poden ser tan baixos como -100 segundos.

| `relativeTo` | Bordo inicial | Bordo final |
| --- | --- | --- |
| `'project-start'` (predeterminado) | `start` segundos desde o inicio do proxecto | `end` segundos desde o inicio do proxecto |
| `'project'` | `start` segundos desde o inicio do proxecto | `end` segundos despois do final do proxecto |
| `'project-end'` | `start` segundos antes do final do proxecto | `end` segundos antes do final do proxecto |
| `'selection-start'` | `start` segundos despois do inicio da selección | `end` segundos despois do inicio da selección |
| `'selection'` | `start` segundos despois do inicio da selección | `end` segundos despois do final da selección |
| `'selection-end'` | `start` segundos antes do final da selección | `end` segundos antes do final da selección |

O final do proxecto é o último fotograma ao que chega calquera clip. As pistas seleccionadas
mántense como estaban.

`sound.select.frames(startFrame, endFrame, options)` establece o intervalo de tempo en
fotogramas á taxa de mostraxe do proxecto. `options.trackIds` nomea as pistas a
seleccionar; cando se omite, as pistas que xa están seleccionadas permanecen seleccionadas.
O intervalo acómpase á liña temporal e os bordes intercámbianse se están invertidos.

`sound.select.tracks(options)` é o comando `SelectTracks` de Audacity. Selecciona
as pistas cuxo índice (contado desde 0) está no intervalo desde `options.track`
(predeterminado 0) abrangendo `options.trackCount` pistas (predeterminado 1). `options.mode` é
`'set'` para substituír a selección de pistas, `'add'` para ampliala, ou `'remove'` para
retirar esas pistas dela. O intervalo de tempo mantense como estaba.

`sound.select.frequencies(options)` é o comando `SelectFrequencies` de Audacity.
Establece a selección espectral a `options.low` e `options.high` en hertz;
un bordo que se omite mantén o seu valor actual.

`sound.select.all()` selecciona todo o proxecto en todas as pistas.
`sound.select.none()` limpa a selección.

### `sound.effect(type, params)`

Aplica un efecto sobre a selección actual, na pista enfocada. `type` é
un ID de efecto de [Efectos que un programa pode aplicar](#effects-a-program-can-apply),
e `params` é un obxecto dos parámetros dese efecto. Os parámetros que se omitan adoptan
os valores predeterminados do efecto; os valores compróbanse contra os intervalos da
[referencia de efectos de audio](/reference/generated/audio-effects/). Resólvese a
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Aplica unha cadea de efectos sobre a selección actual nunha pasada, exactamente como
o faría unha macro de lista de pasos con eses pasos. Cada paso é `{ type, params }`, e a
cadea necesita polo menos un paso. Resólvese a `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Executa un dos comandos de macro de Audacity listados baixo
[Comandos que un programa pode executar](#commands-a-program-can-run). Os catro comandos de
selección aceptan os parámetros descritos alí; os demais non aceptan ningunha. Resólvese a
a selección despois.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Executa unha macro de lista de pasos gardada no mesmo xestor de macros, polo seu nome exacto,
incluíndo calquera comando de selección que conteña. Unha macro gardada non pode ser ela mesma un
programa, polo que os programas non se anidan. Resólvese a `null`; un nome descoñecido rexeitase.

### Tempo e aleatoriedade

Unha execución é reproducible: dúas execucións do mesmo programa sobre o mesmo proxecto leen
o mesmo, porque o reloxo e os números aleatorios non son da máquina.

`Date.now()` e `new Date()` sen argumentos devolven un reloxo virtual que
comeza en 0 e avanza un por cada chamada respondida ao editor, e por
`ms` por cada `sound.wait(ms)`. `sound.wait` resólvese inmediatamente; non hai
forma de que un programa se deteña para tempo real, e non é necesario, porque cada chamada
ao editor complétase antes de que a súa promesa se resolva.

`Math.random()` e `sound.random()` son o mesmo xerador, semillado desde
`sound.env.seed`. Rexistra a semente se necesitas saber cal secuencia usou unha execución.

### Comprobando as túas suposicións

`sound.assert(condition, message)` lanza `message` cando `condition` é falso.
`sound.assertEqual(actual, expected, message)` compara os dous valores como JSON
e lanza unha excepción cando difiren, cunha mensaxe que nomea ambos os valores se non
se especifica ningunha. Como un erro lanzado finaliza a execución e revirte todo o que houbo antes, unha
aserción fallida deixa o proxecto intacto. Ningun dos dous métodos devolve unha promesa.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Valores que cruzan ao editor

Cada argumento que un programa pasa e cada valor que recibe son datos simples:
`null`, booleanos, números finitos, cadeas de caracteres e matrices e obxectos simples de
deses. `NaN`, `Infinity`, funcións, instancias de clase, matrices tipadas e obxectos `Date`
réchanse cun erro, igual que calquera valor maior de 1 MiB, anidado a máis de
12 niveis de profundidade ou que conteña máis de 4.096 entradas nunha matriz ou obxecto.
Descártanse as propiedades `undefined`.

## Límites

| Límite | Valor |
| --- | --- |
| Lonxitude do programa | 256 KiB |
| Chamadas ao editor por execución | 4.096 |
| Cambios no proxecto por execución (chamadas de selección, efectos, comandos) | 256 |
| Chamadas agardando unha resposta á vez | 8 |
| Tempo de execución | 120 segundos |
| Un valor que cruza ao ou desde o editor | 1 MiB, 12 niveis de profundidade, 4.096 entradas por matriz ou obxecto |
| Rexistro | 1.000 liñas ou 256 KiB; 4.096 caracteres por liña |
| Programas na biblioteca | 128 |
| Nome do programa | 256 caracteres |
| Ficheiro de programa importado | 1 MiB |

Un bucle que selecciona cada clip e aplica un efecto gasta dous cambios por
clip, polo que pode cubrir 128 clips antes de que se esgote o presuposto.

## Erros

Unha chamada que o editor rexeita rexeita a súa promesa cun `Error` cuxo `message`
dice por que: un comando fóra do vocabulario, un efecto sobre unha selección baleira,
un parámetro fóra de rango. O erro tamén leva un `code`, que é
`MACRO_CALL_FAILED` a menos que o editor proporcione un máis específico. Un programa
pode capturalos e continuar:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Ese programa completa, e o seu rexistro di *rexeitado: Comando de macro non admitido:
ExportWav.*

Un erro que o programa non captura finaliza a execución, revirte o proxecto e móstrase
no panel coa liña de onde viña. Un programa que non compila infórmase da mesma maneira antes de que se execute nada.

## Efectos que un programa pode aplicar {#effects-a-program-can-apply}

Estes son os IDs de efecto que `sound.effect` e `sound.effects` aceptan, cos
teclados de parámetros que cada un acepta e os seus valores predeterminados. Os rangos e unidades están na
[referencia de efectos de audio](/reference/generated/audio-effects/). Os complementos Nyquist
non se poden aplicar desde un programa.

| Efecto | ID do efecto | Parámetros e valores predeterminados |
| --- | --- | --- |
| Amplificar | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Auto Duck | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Graves e Agudos | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Cambiar ton | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Cambiar velocidade e ton | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Cambiar tempo | `audacity-change-tempo` | `tempoPercent: 0` |
| Filtros clásicos | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Eliminación de clics | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compresor | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Compresor (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Retardo | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distorción | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Eco | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Fundido de entrada | `audacity-fade-in` | ningún |
| Fundido de saída | `audacity-fade-out` | ningún |
| EQ de curva de filtro | `audacity-filter-curve-eq` | `points`: unha matriz de `{ frequency, gain }`, predeterminado dous puntos planos a 20 Hz e 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| EQ paramétrico de catro bandas | `eq` | `outputGain: 0`; `bands`: catro obxectos `{ id, enabled, type, frequency, gain, q, slope }`, con picos a 100, 500, 2000 e 8000 Hz con `gain: 0`, `q: 1`, `slope: 12` |
| Porta | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| EQ gráfico | `audacity-graphic-eq` | `gains`: ganancias de 31 bandas en dB, todas 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Filtro de paso alto | `highpass` | `frequency: 80`, `q: 0.707` |
| Invertir | `audacity-invert` | ningún |
| Compresor legado | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limitador | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limitador (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalización de sonoridade | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Filtro de paso baixo | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Redución de ruído | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalizar | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Eliminar desprazamento CC | `audacity-remove-dc-offset` | ningún |
| Reparar | `audacity-repair` | ningún |
| Repetir | `audacity-repeat` | `count: 1` |
| Reverberación | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverberación (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Invertir | `audacity-reverse` | ningún |
| Estiramento deslizante | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncar silencio | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Ganancia de utilidade (Revisado) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Dous efectos necesitan algo que un programa non pode proporcionar. A Redución de ruído necesita un perfil de ruído capturado no propio diálogo do efecto, e o Auto Duck necesita unha pista de control por debaixo da enfocada.

## Comandos que un programa pode executar {#commands-a-program-can-run}

`sound.command` acepta os seguintes nomes de comandos de macro de Audacity. Son os mesmos nomes que pode conter unha macro de lista de pasos, polo que un programa e unha lista de pasos teñen exactamente o mesmo alcance. Cada comando executa a acción do editor que a
[referencia de comandos](/reference/generated/commands/) describe.

### Comandos de selección con parámetros

| Comando | Parámetros |
| --- | --- |
| `SelectTime` | `start`, `end` en segundos; `relativeTo` como para `sound.select.time` |
| `SelectFrequencies` | `low`, `high` en hercios |
| `SelectTracks` | `track`, `trackCount` (0 a 100); `mode` de `'set'`, `'add'` ou `'remove'` |
| `Select` | Calquera combinación dos tres conxuntos anteriores |

Un parámetro que deixe sen especificar deixa esa parte da selección intacta, que é como Audacity os interpreta tamén.

### Comandos sen parámetros

| Grupo | Comandos |
| --- | --- |
| Selección | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Edición | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Pistas | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Etiquetas | `AddLabel` |
| Análise | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### O que falta deliberadamente

`Undo` e `Redo` están ausentes porque unha execución xa é unha entrada no historial e un paso que percorrese o historial chegaría máis alá da execución ata as túas propias edicións.
Os comandos de transporte e gravación están ausentes porque un programa non ten nada que agardar e non se pode desfacer dunha gravación. Abrir, gardar, pechar, importar, exportar e preferencias están ausentes porque o alcance dun programa é o único proxecto que estaba aberto cando comezou. Os comandos que só abren un diálogo ou cambian a vista están ausentes porque non cambian nada no proxecto.

## Compartir programas {#sharing-programs}

**Exportar programa** escribe o programa seleccionado como un ficheiro `.soundscapemacro`, e
**Importar programa** le un. O ficheiro é JSON e non un ficheiro `.js` simple, polo que
nada no ordenador receptor o confundirá con algo para executar fóra
do editor:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Importar garda o texto e nada máis. Un programa importado non ten botón **Executar
programa**; no seu lugar, o panel mostra o programa, o ficheiro do que provén,
unha nota sobre o que un programa pode facer ao proxecto aberto, e unha casilla de verificación que di *Leín este programa e quero executalo.* Marcala activa **Activar este
programa**, e só entón se pode executar o programa.

Esa permisión é para o texto exacto que leches. Se o programa cambia
depois, sexa porque o editas ou importas unha copia máis nova por riba, a revisión
aparece de novo ata que actives o novo texto. Os programas que escribes ti mesmo no xestor
non necesitan revisión.

## Exemplos

Fundido de entrada en cada clip da primeira pista que os teña. Fai clic na cabeceira deseha pista
antes de executar, para que o efecto caia na pista que o programa está a ler:

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

Informar sobre o proxecto sen cambialo:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Executar unha macro de lista de pasos gardada só cando a selección sexa suficientemente longa:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Sobre esta páxina

Cada programa desta páxina, desde os fragmentos dunha liña ata os exemplos traballados,
execútase contra cada compilación de Soundscaper pola suite do navegador
(`tests/browser/handbook-macro-program-examples.spec.js`), que le os
programas do propio texto desta páxina. Un programa que deixa de completarse, ou deixa
de producir o que esta páxina di que produce, falla a compilación ata que se corrixa a páxina ou o
editor.
