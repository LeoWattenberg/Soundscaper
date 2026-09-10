---
title: "Programas de macro"
description: "A API JavaScript contra a qual um programa de macro é executado, os limites sob os quais ele é executado e o arquivo no qual ele viaja."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"pt-PT"} -->

Um programa macro é uma macro escrita em JavaScript em vez de uma lista de passos. 
Ele executa-se dentro do editor contra uma pequena API chamada `sound`, que permite-lhe ler 
o projeto aberto, mover a seleção e aplicar os mesmos efeitos e comandos que uma macro de lista de passos pode aplicar. Tudo o resto, desde arquivos e rede até os seus 
outros projetos, está fora do seu alcance.

Programas são uma característica do Soundscaper. O Framescaper não tem um gestor de macros.

## Onde os programas vivem

Escolha **Ferramentas → Gestor de Macros**. O diálogo lista macros de lista de passos e, sob 
**Programas**, os programas que você salvou. **Novo Programa** cria um, e o painel de detalhes mostra o seu **Nome do Programa**, o **Programa** texto e um botão **Executar Programa**. O texto é salvo à medida que você digita; não há um passo de salvamento separado.

Um programa é armazenado com as configurações do editor, não dentro de um projeto, então está 
disponível em todos os projetos que você abrir neste editor. Use **Exportar Programa** e 
**Importar Programa** para mover um para outra máquina ou outra pessoa; veja 
[Compartilhando programas](#sharing-programs) para o que isso envolve.

O guia [Aplicar a mesma cadeia de efeitos todas as vezes](/guides/effects/apply-the-same-effects-every-time/) 
cobre o lado da lista de passos do mesmo diálogo.

## Escrevendo um programa

Um programa é o corpo de uma função `async`, executada em modo estrito. Isso significa que você 
pode `await` no nível superior, declarar variáveis e funções e usar todos os 
recursos comuns da linguagem. O objeto `sound` é a única conexão do programa com 
o editor, e cada chamada nele retorna uma promessa.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

A tecla Tab insere dois espaços no campo do programa. Pressione Escape e depois Tab para sair
do campo.

### O que um programa pode usar

A biblioteca padrão JavaScript usual está presente: `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, os arrays digitados, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` e `queueMicrotask`. `console`
também está presente, e tudo escrito nele aparece no log do programa.

### O que um programa não pode usar

Um programa é executado em um worker que teve suas capacidades removidas antes da
primeira linha ser executada. Nenhum dos seguintes existe dentro de um programa: `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` e `setInterval`. Ler qualquer um deles retorna `undefined`.

Um programa não pode `import` um módulo; um `import` estático é um erro de sintaxe na
linha que o contém. Tudo o que o programa precisa deve estar dentro do próprio programa.

A fronteira de segurança não são os globais ausentes, mas o próprio editor: ele
responde apenas às chamadas listadas nesta página e rejeita tudo mais pelo nome, independentemente do que o programa consegue enviar.

## Executando um programa

Pressione **Executar programa**. Toda a execução é uma única entrada no histórico do projeto, então
um **Desfazer** reverte tudo o que o programa fez, independentemente de quantas alterações ele realizou.
Se o programa lançar uma exceção, for cancelado ou exceder o prazo, o projeto é
redefinido exatamente como estava antes do início da execução.

**Cancelar execução** interrompe o programa imediatamente. Um programa que está em execução há dois
minutos é interrompido da mesma forma, com a mensagem *A macro excedeu o tempo limite de 120 segundos.*

Após a execução, o painel mostra o log do programa, seguido por *Programa aplicado.*
quando a execução for concluída. Uma execução falha mostra *O programa falhou na linha N:* e
a mensagem do erro, onde o número da linha é a linha do seu programa que
lançou a exceção.

### Qual áudio um efeito afeta

Um efeito aplicado por um programa é executado sobre a seleção de tempo atual na
trilha focada, que é a trilha cujo cabeçalho você clicou por último ou cujo clipe
você selecionou por último. Quando não há seleção de tempo, mas um clipe está selecionado, o
efeito cobre esse clipe. As chamadas de seleção de um programa mudam o intervalo de tempo e
o conjunto de trilhas selecionadas, mas não qual trilha tem foco, então uma única execução processa
uma única trilha. Se nada estiver focado ou a seleção estiver vazia, a execução falha com
a mesma mensagem que o menu Efeito fornece.

## A API `sound`

Todo método abaixo retorna uma promessa, a menos que seja especificado o contrário. Aguarde cada chamada
antes de fazer a próxima; um programa que inicia mais de oito chamadas sem
aguardá-las terá a nona rejeitada.

### `sound.env`

Um objeto simples que descreve a execução.

| Campo | Significado |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | A linguagem de interface do editor, como `"en"` ou `"de"`. |
| `seed` | A semente dos números aleatórios da execução. Nova para cada execução. |
| `startedAt` | O tempo de relógio da parede em que a execução começou, como uma string ISO 8601. |
| `dryRun` | Sempre `false` no momento. Reservado. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` e `sound.log.debug(...values)` escrevem uma linha
cada um no log da execução. `console.log`, `console.info`, `console.warn`,
`console.error` e `console.debug` fazem o mesmo. Valores que não são strings são
escritos como JSON. Estes métodos não retornam nada e não precisam ser aguardados.

Um log armazena no máximo 1.000 linhas ou 256 KiB, o que vier primeiro, e cada linha
è cortada em 4.096 caracteres. Linhas além disso são descartadas e contadas; a contagem
è relatada como um aviso final.

### `sound.project`

Ler o projeto nunca o altera e não conta contra o orçamento de alterações da execução.

`sound.project.snapshot()` retorna `{ sampleRate, tracks, selection }`, com
`tracks` e `selection` retornados pelas duas chamadas abaixo. `sampleRate` é
a taxa de amostragem do projeto em hertz, que é o que todas as contagens de quadros nesta página são
medidas.

`sound.project.tracks()` retorna um array de trilhas em ordem cronológica:

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` devolve os clipes numa única faixa, ou em todas as faixas
quando `trackId` é omitido:

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` devolve a seleção atual:

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Cada chamada de seleção conta como uma alteração e devolve a seleção que produziu,
no formato `sound.project.selection()` devolve.

`sound.select.time(start, end, options)` define o intervalo de tempo em segundos. É
o comando `SelectTime` do Audacity, e `options.relativeTo` escolhe onde cada
limite é medido a partir. Ambos os limites podem ser tão baixos quanto -100 segundos.

| `relativeTo` | Limite inicial | Limite final |
| --- | --- | --- |
| `'project-start'` (padrão) | `start` segundos a partir do início do projeto | `end` segundos a partir do início do projeto |
| `'project'` | `start` segundos a partir do início do projeto | `end` segundos após o fim do projeto |
| `'project-end'` | `start` segundos antes do fim do projeto | `end` segundos antes do fim do projeto |
| `'selection-start'` | `start` segundos após o início da seleção | `end` segundos após o início da seleção |
| `'selection'` | `start` segundos após o início da seleção | `end` segundos após o fim da seleção |
| `'selection-end'` | `start` segundos antes do fim da seleção | `end` segundos antes do fim da seleção |

O fim do projeto é o último quadro que qualquer clipe atinge. As faixas selecionadas são deixadas
até como estavam.

`sound.select.frames(startFrame, endFrame, options)` define o intervalo de tempo em
quadros à taxa de amostragem do projeto. `options.trackIds` nomeia as faixas a
selecionar; quando é omitido, as faixas já selecionadas permanecem selecionadas. O intervalo é limitado à linha do tempo e as bordas são trocadas se invertidas.

`sound.select.tracks(options)` é o comando `SelectTracks` do Audacity. Seleciona
as faixas cujo índice (contado a partir de 0) está no intervalo de `options.track`
(padrão 0) abrangendo `options.trackCount` faixas (padrão 1). `options.mode` é
`'set'` para substituir a seleção de faixas, `'add'` para ampliá-la, ou `'remove'` para
excluir essas faixas dela. O intervalo de tempo permanece como estava.

`sound.select.frequencies(options)` é o comando `SelectFrequencies` do Audacity. Define a seleção espectral para `options.low` e `options.high` em hertz;
um limite que você omite mantém o seu valor atual.

`sound.select.all()` seleciona todo o projeto em cada faixa.
`sound.select.none()` limpa a seleção.

### `sound.effect(type, params)`

Aplica um efeito sobre a seleção atual, na faixa focada. `type` é
um ID de efeito de [Efeitos que um programa pode aplicar](#effects-a-program-can-apply),
e `params` é um objeto dos parâmetros desse efeito. Os parâmetros que você omite assumem
os valores padrão do efeito; os valores são verificados em relação aos intervalos no
[referência de efeitos de áudio](/reference/generated/audio-effects/). Resolve para
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Aplica uma cadeia de efeitos sobre a seleção atual em uma única passagem, exatamente como um macro de lista de etapas com essas etapas. Cada etapa é `{ type, params }`, e a cadeia precisa de pelo menos uma etapa. Resolve para `null`.

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
tomam os parâmetros descritos lá; os outros não tomam nenhum. Resolve-se na seleção posterior.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Executa uma macro de lista de passos salva no mesmo gerenciador de macros, pelo seu nome exato,
incluindo quaisquer comandos de seleção que contenha. Uma macro salva não pode ser ela própria um
programa, portanto, os programas não se aninham. Resolve para `null`; um nome desconhecido é rejeitado.

### Tempo e aleatoriedade

Uma execução é reprodutível: duas execuções do mesmo programa sobre o mesmo projeto leem
o mesmo, porque o relógio e os números aleatórios não são os da máquina.

`Date.now()` e `new Date()` sem argumentos retornam um relógio virtual que
começa em 0 e avança um para cada chamada respondida para o editor, e por
`ms` para cada `sound.wait(ms)`. `sound.wait` resolve imediatamente; não há
forma de um programa pausar para tempo real, e não é necessário, porque cada chamada
para o editor é concluída antes de sua promessa ser resolvida.

`Math.random()` e `sound.random()` são o mesmo gerador, inicializado a partir de
`sound.env.seed`. Registe a semente se precisar de saber qual sequência uma execução usou.

### Verificando suas suposições

`sound.assert(condition, message)` lança `message` quando `condition` é falso.
`sound.assertEqual(actual, expected, message)` compara os dois valores como JSON
e lança quando diferem, com uma mensagem que nomeia ambos os valores se não fornecer nenhum.
Como um erro lançado encerra a execução e reverte tudo antes dela, uma afirmação falhada deixa o
projeto intocado. Nenhum dos métodos retorna uma promessa.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Valores que cruzam para o editor

Cada argumento que um programa passa e cada valor que recebe é dado simples:
`null`, booleanos, números finitos, strings, e arrays e objetos simples
de aqueles. `NaN`, `Infinity`, funções, instâncias de classe, arrays tipados e `Date`
objetos são recusados com um erro, assim como qualquer valor maior que 1 MiB, aninhado mais
do que 12 níveis de profundidade, ou contendo mais de 4.096 entradas em um array ou objeto.
`undefined` propriedades são descartadas.

## Limites

| Limite | Valor |
| --- | --- |
| Comprimento do programa | 256 KiB |
| Chamadas ao editor por execução | 4.096 |
| Alterações no projeto por execução (chamadas de seleção, efeitos, comandos) | 256 |
| Chamadas aguardando uma resposta de uma vez | 8 |
| Tempo de execução | 120 segundos |
| Um valor que cruza para ou a partir do editor | 1 MiB, 12 níveis de profundidade, 4.096 entradas por array ou objeto |
| Log | 1.000 linhas ou 256 KiB; 4.096 caracteres por linha |
| Programas na biblioteca | 128 |
| Nome do programa | 256 caracteres |
| Arquivo de programa importado | 1 MiB |

Um loop que seleciona cada clipe e aplica um efeito gasta duas alterações por
clipe, então pode cobrir 128 clipes antes que o orçamento se esgote.

## Erros

Uma chamada que o editor recusa rejeita sua promessa com um `Error` cujo `message`
diz porquê: um comando fora do vocabulário, um efeito sobre uma seleção vazia,
um parâmetro fora do intervalo. O erro também carrega um `code`, que é
`MACRO_CALL_FAILED` a menos que o editor forneça um mais específico. Um programa
pode pegar estes e continuar:

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Esse programa é concluído e o seu registo indica *recusado: Comando de macro não suportado:
ExportWav.*

Um erro que o programa não captura termina a execução, reverte o projeto e é
mostrado no painel com a linha de onde veio. Um programa que não compila é
reportado da mesma forma antes de qualquer coisa ser executada.

## Efeitos que um programa pode aplicar {#effects-a-program-can-apply}

Estes são os IDs de efeitos `sound.effect` e `sound.effects` aceitam, com as
chaves de parâmetros que cada um aceita e os seus valores predefinidos. Intervalos e unidades estão na
[referência de efeitos de áudio](/reference/generated/audio-effects/). Os plug-ins Nyquist não podem ser aplicados a partir de um programa.

| Efeito | ID do Efeito | Parâmetros e valores predefinidos |
| --- | --- | --- |
| Amplificar | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Pato Automático | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Graves e Agudos | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Triturador de Bits | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Alterar Tom | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Alterar Velocidade e Tom | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Alterar Tempo | `audacity-change-tempo` | `tempoPercent: 0` |
| Filtros Clássicos | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Remoção de Clics | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compressor | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Compressor (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Delay | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distorção | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Eco | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Desvanecer Entrada | `audacity-fade-in` | nenhum |
| Desvanecer Saída | `audacity-fade-out` | nenhum |
| Curva de Filtro EQ | `audacity-filter-curve-eq` | `points`: um array de `{ frequency, gain }`, predefinido com dois pontos planos a 20 Hz e 20 kHz; `linearFrequencyScale: false`; `filterLength: 8191` |
| EQ Paramétrico de Quatro Bandas | `eq` | `outputGain: 0`; `bands`: quatro `{ id, enabled, type, frequency, gain, q, slope }` objetos, com pico a 100, 500, 2000 e 8000 Hz com `gain: 0`, `q: 1`, `slope: 12` |
| Porta | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| EQ Gráfico | `audacity-graphic-eq` | `gains`: 31 ganhos de banda em dB, todos 0; `interpolation: 'bspline'`; `filterLength: 8191` |
| Filtro de Passa-Alta | `highpass` | `frequency: 80`, `q: 0.707` |
| Inverter | `audacity-invert` | nenhum |
| Compressor Legado | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limitador | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limitador (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalização de Volume | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Filtro de Passa-Baixa | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Redução de Ruído | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normalizar | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Faser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Remover Desvio DC | `audacity-remove-dc-offset` | nenhum |
| Reparação | `audacity-repair` | nenhum |
| Repetir | `audacity-repeat` | `count: 1` |
| Reverb | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Reverb (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Reverso | `audacity-reverse` | nenhum |
| Estiramento Deslizante | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Truncamento de Silêncio | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Ganho Utilitário (Revisto) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Dois efeitos necessitam de algo que um programa não pode fornecer. A Redução de Ruído necessita de um
perfil de ruído capturado no diálogo do efeito, e o Auto Duck necessita de uma faixa de controlo
abaixo da faixa focada.

## Comandos que um programa pode executar {#commands-a-program-can-run}

`sound.command` aceita os nomes de comandos de macro Audacity abaixo. São os
mesmos nomes que uma lista de passos pode conter, portanto, um programa e uma lista de passos têm exatamente
a mesma abrangência. Cada comando executa a ação do editor que a
[referência de comandos](/reference/generated/commands/) descreve.

### Comandos de seleção com parâmetros

| Comando | Parâmetros |
| --- | --- |
| `SelectTime` | `start`, `end` em segundos; `relativeTo` como em `sound.select.time` |
| `SelectFrequencies` | `low`, `high` em hertz |
| `SelectTracks` | `track`, `trackCount` (0 a 100); `mode` de `'set'`, `'add'` ou `'remove'` |
| `Select` | Qualquer combinação dos três conjuntos acima |

Um parâmetro que você omite deixa essa parte da seleção inalterada, o que é como
o Audacity também os lê.

### Comandos sem parâmetros

| Grupo | Comandos |
| --- | --- |
| Seleção | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Edição | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Faixas | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Etiquetas | `AddLabel` |
| Análise | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### O que está deliberadamente ausente

`Undo` e `Redo` estão ausentes porque uma execução já é uma entrada de histórico e
um passo que percorre o histórico ultrapassaria a execução nas suas próprias edições.
Comandos de transporte e gravação estão ausentes porque um programa não tem nada
para esperar e não pode ser revertido de uma gravação. Abrir, salvar, fechar,
importar, exportar e preferências estão ausentes porque a abrangência de um programa é o
projeto único que estava aberto quando começou. Comandos que apenas abrem um diálogo ou
alteram a visualização estão ausentes porque não alteram nada no projeto.

## Partilhar programas {#sharing-programs}

**Exportar programa** escreve o programa selecionado como um ficheiro `.soundscapemacro`, e
**Importar programa** lê um. O ficheiro é JSON em vez de um ficheiro `.js` simples, para que
nada no computador de destino o confunda com algo a ser executado fora do editor:

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
programa**; em seu lugar, o painel mostra o programa, o arquivo de onde veio,
a nota sobre o que um programa pode fazer ao projeto aberto e uma caixa de verificação lendo *Eu
li este programa e quero executá-lo.* Marcá-la permite **Habilitar este
programa**, e só então o programa pode ser executado.

Essa permissão é para o texto exato que você leu. Se o programa mudar
depois, seja por editá-lo ou importar uma cópia mais nova sobre ele, a revisão
aparece novamente até você habilitar o novo texto. Programas que você escreve no próprio
gerenciador não precisam de revisão.

## Exemplos

Desvanecer em todos os clipes na primeira faixa que tem algum. Clique no cabeçalho dessa faixa
ante de executar, para que o efeito caia na faixa que o programa está lendo:

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

Executar uma macro de lista de passos guardada apenas quando a seleção for suficientemente longa:

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## Sobre esta página

Cada programa nesta página, desde os fragmentos de uma linha até aos exemplos trabalhados,
 é executado contra cada construção do Soundscaper pelo conjunto de navegadores
(`tests/browser/handbook-macro-program-examples.spec.js`), que lê
os programas do próprio texto desta página. Um programa que deixa de completar ou de
produzir o que esta página diz que produz, falha a construção até que a página ou o
editor seja corrigido.
