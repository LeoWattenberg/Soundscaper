---
title: "Programas de macro"
description: "A API JavaScript na qual um programa de macro é executado, os limites que o restringem e o arquivo em que ele é transportado."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"pt-BR"} -->

Um programa de macro é uma macro escrita em JavaScript, e não como uma lista de etapas.
Ele é executado dentro do editor usando uma pequena API chamada `sound`, que permite ler
o projeto aberto, mover a seleção e aplicar os mesmos efeitos e comandos que uma macro
de lista de etapas pode aplicar. Todo o restante, de arquivos e rede a seus
outros projetos, está fora do seu alcance.

Os programas são um recurso do Soundscaper. O Framescaper não tem gerenciador de macros.

## Onde os programas ficam

Escolha **Ferramentas → Gerenciador de macros**. A caixa de diálogo lista as macros de lista de etapas e, em
**Programas**, os programas que você salvou. Pressione **+ (Novo programa)** no cabeçalho
Programas para criar um. A mesma barra de ações oferece **Importar programa**,
**Exportar programa** e **Excluir programa** para o programa selecionado. O painel
de detalhes mostra o **Nome do programa**, o texto do **Programa** e um botão **Executar
programa**. O texto é salvo enquanto você digita; não há uma etapa de salvamento separada.

Um programa é armazenado com as configurações do editor, não dentro de um projeto, portanto fica
disponível em todos os projetos que você abrir neste editor. Use **Exportar programa** e
**Importar programa** para levá-lo a outra máquina ou a outra pessoa; consulte
[Compartilhar programas](#sharing-programs) para saber o que isso envolve.

O guia [Aplicar a mesma cadeia de efeitos todas as vezes](/guides/effects/apply-the-same-effects-every-time/)
cobre a parte de lista de etapas da mesma caixa de diálogo.

## Escrever um programa

Um programa é o corpo de uma função `async`, executada no modo estrito. Isso significa que você
pode usar `await` no nível superior, declarar variáveis e funções e usar todos os
recursos normais da linguagem. O objeto `sound` é a única conexão do programa com
o editor, e cada chamada feita nele retorna uma promessa.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab insere dois espaços no campo do programa. Pressione Escape e depois Tab para sair
do campo.

### O que um programa pode usar

A biblioteca padrão usual do JavaScript está presente: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, os arrays tipados, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` e `queueMicrotask`. `console`
também está presente, e tudo que for escrito nele aparece no log do programa.

### O que um programa não pode usar

Um programa é executado em um worker que teve seus recursos removidos antes de a
primeira linha ser executada. Nenhum dos seguintes existe dentro de um programa: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` e `setInterval`. Ler qualquer um deles retorna `undefined`.

Um programa não pode fazer `import` de um módulo; um `import` estático é um erro de sintaxe na
linha que o contém. Tudo de que o programa precisa deve estar no próprio programa.

A fronteira de segurança não são os globais ausentes, mas o próprio editor: ele
responde somente às chamadas listadas nesta página e recusa todo o restante pelo nome,
independentemente do que um programa consiga enviar a ele.

## Executar um programa

Pressione **Executar programa**. A execução inteira é uma única entrada no histórico do projeto, então
um **Desfazer** reverte tudo que o programa fez, independentemente de quantas alterações ele tenha feito.
Se o programa lançar uma exceção, for cancelado ou ultrapassar seu prazo, o projeto é
restaurado exatamente ao estado em que estava antes do início da execução.

**Cancelar execução** interrompe um programa imediatamente. Um programa que esteja em execução há dois
minutos é interrompido da mesma forma, com a mensagem *A macro foi executada por mais de
120 segundos.*

Depois da execução, o painel mostra o log do programa, seguido de *Programa aplicado.*
quando a execução é concluída. Uma execução com falha mostra *O programa falhou na linha N:* e
a mensagem do erro, em que o número da linha é o da linha do seu programa que
lançou a exceção.

### Qual áudio um efeito afeta

Um efeito aplicado por um programa é executado sobre a seleção de tempo atual na
faixa em foco, isto é, a faixa cujo cabeçalho você clicou por último ou cujo clipe
selecionou por último. Quando não há seleção de tempo, mas há um clipe selecionado, o
efeito abrange esse clipe. As chamadas de seleção de um programa alteram o intervalo de tempo e
o conjunto de faixas selecionadas, mas não a faixa em foco, então uma execução processa
uma faixa. Se nada estiver em foco ou a seleção estiver vazia, a execução falha com
a mesma mensagem exibida pelo menu Efeito.

## A API `sound`

Todos os métodos abaixo retornam uma promessa, salvo indicação em contrário. Aguarde cada chamada
antes de fazer a próxima; um programa que inicie mais de oito chamadas sem
aguardá-las terá a nona recusada.

### `sound.env`

Um objeto simples que descreve a execução.

| Campo | Significado |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | O idioma da interface do editor, como `"en"` ou `"de"`. |
| `seed` | A semente de onde vêm os números aleatórios da execução. Nova a cada execução. |
| `startedAt` | O horário de relógio em que a execução começou, como uma string ISO 8601. |
| `dryRun` | Sempre `false` no momento. Reservado. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` e `sound.log.debug(...values)` escrevem uma linha
cada no log da execução. `console.log`, `console.info`, `console.warn`,
`console.error` e `console.debug` fazem o mesmo. Valores que não são strings são
escritos como JSON. Esses métodos não retornam nada e não precisam ser aguardados.

Um log armazena no máximo 1.000 linhas ou 256 KiB, o que ocorrer primeiro, e cada linha
é cortada em 4.096 caracteres. As linhas além desse limite são descartadas e contadas; a contagem
é informada em um aviso final.

### `sound.project`

Ler o projeto nunca o altera e não conta para o orçamento de alterações da
execução.

`sound.project.snapshot()` retorna `{ sampleRate, tracks, selection }`, com
`tracks` e `selection` retornados pelas duas chamadas abaixo. `sampleRate` é
a taxa de amostragem do projeto em hertz, que é a unidade de todas as contagens de quadros
nesta página.

`sound.project.tracks()` retorna um array de faixas na ordem da linha do tempo:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` retorna os clipes de uma faixa ou de todas as faixas
quando `trackId` é omitido:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` retorna a seleção atual:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Cada chamada de seleção conta como uma alteração e retorna a seleção que produziu,
no formato retornado por `sound.project.selection()`.

`sound.select.time(start, end, options)` define o intervalo de tempo em segundos. É
o comando `SelectTime` do Audacity, e `options.relativeTo` escolhe de onde cada
limite é medido. Ambos os limites podem ser tão baixos quanto -100 segundos.

| `relativeTo` | Limite inicial | Limite final |
| --- | --- | --- |
| `'project-start'` (padrão) | `start` segundos a partir do início do projeto | `end` segundos a partir do início do projeto |
| `'project'` | `start` segundos a partir do início do projeto | `end` segundos após o fim do projeto |
| `'project-end'` | `start` segundos antes do fim do projeto | `end` segundos antes do fim do projeto |
| `'selection-start'` | `start` segundos após o início da seleção | `end` segundos após o início da seleção |
| `'selection'` | `start` segundos após o início da seleção | `end` segundos após o fim da seleção |
| `'selection-end'` | `start` segundos antes do fim da seleção | `end` segundos antes do fim da seleção |

O fim do projeto é o último quadro alcançado por qualquer clipe. As faixas selecionadas permanecem
como estavam.

`sound.select.frames(startFrame, endFrame, options)` define o intervalo de tempo em
quadros na taxa de amostragem do projeto. `options.trackIds` nomeia as faixas a
selecionar; quando é omitido, as faixas já selecionadas continuam selecionadas.
O intervalo é limitado à linha do tempo e os limites são trocados se estiverem invertidos.

`sound.select.tracks(options)` é o comando `SelectTracks` do Audacity. Ele seleciona
as faixas cujo índice, contado a partir de 0, está no intervalo a partir de `options.track`
(padrão 0), abrangendo `options.trackCount` faixas (padrão 1). `options.mode` é
`'set'` para substituir a seleção de faixas, `'add'` para ampliá-la ou `'remove'` para
retirar essas faixas dela. O intervalo de tempo permanece como estava.

`sound.select.frequencies(options)` é o comando `SelectFrequencies` do Audacity.
Ele define a seleção espectral como `options.low` e `options.high` em hertz;
um limite omitido mantém seu valor atual.

`sound.select.all()` seleciona todo o projeto em todas as faixas.
`sound.select.none()` limpa a seleção.

### `sound.effect(type, params)`

Aplica um efeito à seleção atual, na faixa em foco. `type` é
um ID de efeito de [Efeitos que um programa pode aplicar](#effects-a-program-can-apply),
e `params` é um objeto com os parâmetros desse efeito. Os parâmetros omitidos recebem
os valores padrão do efeito; os valores são verificados em relação aos intervalos na
[referência de efeitos de áudio](/reference/generated/audio-effects/). Resolve para
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Aplica uma cadeia de efeitos à seleção atual em uma única passagem, exatamente como faria
uma macro de lista de etapas com essas etapas. Cada etapa é `{ type, params }`, e a
cadeia precisa de pelo menos uma etapa. Resolve para `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Executa um dos comandos de macro do Audacity listados em
[Comandos que um programa pode executar](#commands-a-program-can-run). Os quatro comandos de seleção
recebem os parâmetros descritos ali; os demais não recebem nenhum. Resolve para
a seleção resultante.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Executa uma macro de lista de etapas salva no mesmo gerenciador de macros, pelo nome exato,
incluindo quaisquer comandos de seleção que ela contenha. Uma macro salva não pode ser um
programa, portanto programas não podem ser aninhados. Resolve para `null`; um nome desconhecido é rejeitado.

### Tempo e aleatoriedade

Uma execução é reproduzível: duas execuções do mesmo programa sobre o mesmo projeto leem
os mesmos dados, porque o relógio e os números aleatórios não são os da máquina.

`Date.now()` e `new Date()` sem argumentos retornam um relógio virtual que
começa em 0 e avança uma unidade a cada chamada respondida pelo editor e em
`ms` a cada `sound.wait(ms)`. `sound.wait` resolve imediatamente; não há
como um programa pausar em tempo real, e isso não é necessário, pois cada chamada
ao editor termina antes de sua promessa ser resolvida.

`Math.random()` e `sound.random()` usam o mesmo gerador, inicializado a partir de
`sound.env.seed`. Registre a semente se precisar saber qual sequência uma execução usou.

### Verificar suas suposições

`sound.assert(condition, message)` lança `message` quando `condition` é falso.
`sound.assertEqual(actual, expected, message)` compara os dois valores como JSON
e lança uma exceção quando diferem, com uma mensagem que nomeia ambos se você não fornecer
nenhuma. Como uma exceção encerra a execução e desfaz tudo antes dela, uma asserção
falha deixa o projeto intacto. Nenhum dos métodos retorna uma promessa.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Valores que atravessam o editor

Todo argumento que um programa passa e todo valor que recebe é um dado simples:
`null`, booleanos, números finitos, strings, arrays e objetos simples desses tipos.
`NaN`, `Infinity`, funções, instâncias de classe, arrays tipados e objetos `Date`
são recusados com um erro, assim como qualquer valor maior que 1 MiB, aninhado em mais
de 12 níveis ou contendo mais de 4.096 entradas em um array ou objeto.
Propriedades `undefined` são descartadas.

## Limites

| Limite | Valor |
| --- | --- |
| Comprimento do programa | 256 KiB |
| Chamadas ao editor por execução | 4.096 |
| Alterações no projeto por execução (chamadas de seleção, efeitos, comandos) | 256 |
| Chamadas aguardando resposta ao mesmo tempo | 8 |
| Tempo de execução | 120 segundos |
| Um valor atravessando o editor em qualquer direção | 1 MiB, 12 níveis de profundidade, 4.096 entradas por array ou objeto |
| Log | 1.000 linhas ou 256 KiB; 4.096 caracteres por linha |
| Programas na biblioteca | 128 |
| Nome do programa | 256 caracteres |
| Arquivo de programa importado | 1 MiB |

Um loop que seleciona cada clipe e aplica um efeito gasta duas alterações por
clipe, então pode abranger 128 clipes antes de o orçamento se esgotar.

## Erros

Uma chamada recusada pelo editor rejeita sua promessa com um `Error` cuja `message`
explica o motivo: um comando fora do vocabulário, um efeito sobre uma seleção vazia
ou um parâmetro fora do intervalo. O erro também traz um `code`, que é
`MACRO_CALL_FAILED`, a menos que o editor forneça um código mais específico. Um programa
pode capturar esses erros e continuar:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Esse programa termina, e seu log contém *refused: Unsupported macro command:
ExportWav.*

Um erro que o programa não captura encerra a execução, restaura o projeto e é
exibido no painel com a linha de onde veio. Um programa que não compila é
relatado da mesma forma antes de qualquer execução.

## Efeitos que um programa pode aplicar {#effects-a-program-can-apply}

Estes são os IDs de efeito aceitos por `sound.effect` e `sound.effects`, com as
chaves de parâmetros aceitas por cada um e seus valores padrão. Os intervalos e as unidades estão na
[referência de efeitos de áudio](/reference/generated/audio-effects/). Plug-ins Nyquist
não podem ser aplicados por um programa.

| Efeito | ID do efeito | Parâmetros e valores padrão |
| --- | --- | --- |
| Amplificar | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Abaixamento automático | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Baixos e agudos | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Alterar tom | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Alterar velocidade e tom | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Alterar andamento | `audacity-change-tempo` | `tempoPercent: 0` |
| Filtros clássicos | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Remoção de cliques | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compressor | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Atraso | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distorção | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Eco | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Desvanecimento de entrada | `audacity-fade-in` | nenhum |
| Desvanecimento de saída | `audacity-fade-out` | nenhum |
| EQ de curva de filtro | `audacity-filter-curve-eq` | `points`: um array de `{ frequency, gain }`, com dois pontos planos padrão em 20 Hz e 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| EQ paramétrico de quatro bandas | `eq` | `outputGain: 0`; `bands`: quatro objetos `{ id, enabled, type, frequency, gain, q, slope }`, com picos em 100, 500, 2000 e 8000 Hz e `gain: 0`, `q: 1`, `slope: 12` |
| Gate | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| EQ gráfico | `audacity-graphic-eq` | `gains`: 31 ganhos de banda em dB, todos 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Filtro passa-alta | `highpass` | `frequency: 80`, `q: 0.707` |
| Inverter | `audacity-invert` | nenhum |
| Compressor legado | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limitador | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalização de intensidade | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Filtro passa-baixa | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Redução de ruído | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalizar | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Remover deslocamento DC | `audacity-remove-dc-offset` | nenhum |
| Reparo | `audacity-repair` | nenhum |
| Repetir | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverter | `audacity-reverse` | nenhum |
| Estiramento deslizante | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncar silêncio | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Ganho utilitário (revisado) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Dois efeitos precisam de algo que um programa não pode fornecer. A Redução de ruído precisa de um
perfil de ruído capturado na própria caixa de diálogo do efeito, e o Abaixamento automático precisa de uma
faixa de controle abaixo da faixa em foco.

## Comandos que um programa pode executar {#commands-a-program-can-run}

`sound.command` aceita os nomes de comandos de macro do Audacity abaixo. São os
mesmos nomes que uma macro de lista de etapas pode conter, então um programa e uma lista de etapas têm exatamente
o mesmo alcance. Cada comando executa a ação do editor descrita na
[referência de comandos](/reference/generated/commands/).

### Comandos de seleção com parâmetros

| Comando | Parâmetros |
| --- | --- |
| `SelectTime` | `start`, `end` em segundos; `relativeTo` como em `sound.select.time` |
| `SelectFrequencies` | `low`, `high` em hertz |
| `SelectTracks` | `track`, `trackCount` (0 a 100); `mode` com `'set'`, `'add'` ou `'remove'` |
| `Select` | Qualquer combinação dos três conjuntos acima |

Um parâmetro omitido deixa essa parte da seleção inalterada, que é também a forma como
o Audacity os interpreta.

### Comandos sem parâmetros

| Grupo | Comandos |
| --- | --- |
| Seleção | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Edição | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Faixas | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Rótulos | `AddLabel` |
| Análise | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### O que está deliberadamente ausente

`Undo` e `Redo` estão ausentes porque uma execução já é uma entrada no histórico e uma
etapa que percorresse o histórico sairia da execução e alcançaria suas próprias edições.
Os comandos de transporte e gravação estão ausentes porque um programa não tem o que
aguardar e não pode desfazer uma gravação. Abrir, salvar, fechar, importar, exportar e as
preferências estão ausentes porque o alcance de um programa é o único projeto aberto quando
ele começa. Comandos que apenas abrem uma caixa de diálogo ou alteram a visualização estão
ausentes porque não mudam nada no projeto.

## Compartilhar programas {#sharing-programs}

**Exportar programa** grava o programa selecionado como um arquivo `.soundscapemacro`, e
**Importar programa** lê um. O arquivo é JSON, e não um arquivo `.js` simples, para que
nada no computador receptor o confunda com algo a ser executado fora do
editor:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

Importar armazena o texto e nada mais. Um programa importado não tem o botão **Executar
programa**; no lugar dele, o painel mostra o programa, o arquivo de origem, uma
observação sobre o que um programa pode fazer no projeto aberto e uma caixa de seleção com o texto
*Li este programa e quero executá-lo.* Marcá-la habilita **Ativar este programa**,
e somente então o programa pode ser executado.

Essa permissão vale para o texto exato que você leu. Se o programa mudar depois,
seja porque você o editou ou importou uma cópia mais nova por cima, a revisão aparece
novamente até que você habilite o novo texto. Programas que você mesmo escreve no gerenciador
não precisam de revisão.

## Exemplos

Faça um desvanecimento de entrada em cada clipe da primeira faixa que tiver algum. Clique no cabeçalho
dessa faixa antes de executar, para que o efeito seja aplicado à faixa que o programa está lendo:

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

Relate o projeto sem alterá-lo:

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Execute uma macro de lista de etapas salva somente quando a seleção for longa o suficiente:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Sobre esta página

Cada programa desta página, dos trechos de uma linha aos exemplos completos,
é executado em cada compilação do Soundscaper pelo conjunto de navegadores
(`tests/browser/handbook-macro-program-examples.spec.js`), que lê os
programas do próprio texto desta página. Se um programa deixar de terminar ou de
produzir o que esta página diz que produz, a compilação falha até que a página ou o
editor seja corrigido.
