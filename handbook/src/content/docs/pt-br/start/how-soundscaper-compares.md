---
title: "Como o Soundscaper se compara"
description: "Compare o Soundscaper com o Audacity 4 e o Adobe Audition em gravação, edição, mixagem, entrega e intercâmbio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"703e76cffbe1464f1283f6c8f45cee52c0d37faae852b7efc163879710a2ddb2","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"703e76cffbe1464f1283f6c8f45cee52c0d37faae852b7efc163879710a2ddb2","targetLocale":"pt-BR"} -->

Soundscaper reimplementa o Audacity 4 na web e adiciona uma camada de produção por cima dele. O Adobe Audition é a ferramenta comercial de pós-produção contra a qual ambos geralmente são medidos. Esta página compara os três para que você possa identificar qual deles já realiza a tarefa que você tem.

## Como ler esta página

Cada célula contém **Sim**, **Parcial** ou **Não**, seguido pelo detalhe que a qualifica.

**Parcial** cobre três situações diferentes, e a nota indica qual se aplica: a capacidade existe, mas é mais restrita do que em outros lugares; ela existe, mas depende de algo que você precisa fornecer; ou ela só é acessível contornando uma ausência.

As linhas descrevem capacidades, não comandos de menu. Para o inventário exato de comandos, consulte [Comandos e atalhos](/reference/generated/commands/), e para o que cada produto habilita, consulte
[Capacidades do produto](/reference/generated/product-capabilities/).

### De onde vêm essas afirmações

- As linhas de **Soundscaper** vêm deste repositório: os perfis de capacidade do produto, o manifesto de ações de tempo de execução e o registro de formatos de exportação. Cargas úteis de destino nativas para desktop são geradas pela CI do repositório ou pelo empacotamento do destino. Um pacote habilita uma apenas após a preparação e verificação do resultado exato correspondente; essas linhas indicam quando uma carga útil ainda é necessária.
- As linhas de **Audacity 4** vêm do inventário upstream fixado neste repositório, `4.0.0` no commit `4c177d43`. Uma capacidade que o upstream registra, mas deixa desabilitada ou comenta fora do menu, é registrada como tal, e uma capacidade sem registro na build fixada é relatada como ausente naquela build, em vez de ausente permanentemente.
- As linhas de **Audition** vêm da documentação publicada pela Adobe para a versão atual. Elas não são verificadas contra uma build em execução.

## Plataforma e termos

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licença | Sim — AGPL-3.0-only | Sim — GPL, código aberto | Não — proprietário e fechado |
| Custo | Sim — gratuito | Sim — gratuito | Não — assinatura Creative Cloud |
| Executa em um navegador | Sim — Chromium, Firefox e WebKit | Não — apenas desktop | Não — apenas desktop |
| Builds para desktop | Sim — Windows e Linux em x64 e ARM64, macOS em ARM64 | Sim — Windows, macOS, Linux | Parcial — Windows e macOS, sem Linux |
| Funciona sem conta | Sim — não existe conta | Sim — login apenas para audio.com | Não — assinatura com login necessária |
| Armazenamento de projetos na nuvem | Não — excluído pelo design local-first | Sim — salvar e compartilhar através de audio.com | Parcial — arquivos Creative Cloud, sessões não sincronizam |
| Requisitos do sistema | Sim — executa em qualquer lugar onde um navegador atual execute | Parcial — aumentou substancialmente em relação ao Audacity 3 | Parcial — classe de estação de trabalho profissional |

## Modelo de projeto e sessão

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Formato de projeto nativo | Sim — `.sscape`, um arquivo portátil sem perdas | Sim — `.aup4` | Sim — `.sesx` |
| Abre projetos do Audacity | Sim — importação e exportação AUP4 | Sim — nativo | Não |
| Linha do tempo de clipes não destrutiva | Sim | Sim | Sim — editor multitrack |
| Editor de arquivo único dedicado | Parcial — a edição de amostras ocorre na linha do tempo | Parcial — as edições são aplicadas no local na linha do tempo | Sim — editor de forma de onda |
| Conteúdo mono e estéreo em uma única faixa | Sim — uma faixa contém um ou outro | Não — uma faixa é mono ou estéreo | Não — o formato de canal é fixo por faixa |
| Pastas de faixas aninhadas | Sim — qualquer profundidade, com desfazer e roteamento | Não | Parcial — apenas barramentos de submix, sem faixas de pasta |
| Caixa de projeto | Sim — organiza arquivos e funciona como área de transferência | Não | Parcial — o painel Arquivos lista os arquivos abertos |
| Salvamento automático e recuperação de falhas | Sim — salvamento automático, bloqueios e envelopes de recuperação | Sim | Sim |
| Marcadores e regiões nomeadas | Sim — de primeira classe, com navegação e comportamento de ripple | Parcial — faixas de rótulo | Sim — marcadores e intervalos |
| Mapas de andamento e assinatura de compasso | Sim — mapas ordenados resolvidos com precisão de amostra | Parcial — um andamento e assinatura por projeto | Parcial — um andamento por sessão |

## Gravação

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Gravação multitrack | Sim — várias fontes ao mesmo tempo | Parcial — um dispositivo de entrada por vez | Sim — interfaces multi-entrada e multicanal |
| Áudio de microfone e de desktop juntos | Sim — integrado | Não | Parcial — requer um dispositivo de loopback do sistema operacional |
| Gravação cronometrada | Sim | Sim | Não |
| Gravação ativada por som | Sim — com limiar configurável | Sim — com limiar configurável | Não |
| Contagem antes da tomada | Sim — ciente do mapa de andamento, lida com compasso composto | Parcial — gravação de introdução | Parcial — pré-rolagem como parte do punch and roll |
| Gravação punch | Sim — uma transação, captura padrão e roteada | Não | Sim — punch and roll |
| Gravação em loop em tomadas | Sim — uma faixa por passagem, adicionada ao mesmo grupo | Não | Parcial — tomadas em um clipe, escolhidas de uma lista |
| Comping de tomadas | Sim — audição, promoção, edição de regiões de comp, achatamento como uma edição única com desfazer | Não | Não — sem editor de comp |
| Monitoramento e medição de entrada | Sim | Sim | Sim |

## Edição da linha do tempo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Variantes de edição ripple | Sim — por clipe, por faixa e todas as faixas, em corte e exclusão | Sim — as mesmas três, em corte e exclusão | Parcial — exclusão ripple em uma seleção ou lacuna |
| Dividir, unir e dividir em silêncios | Sim | Sim | Parcial — dividir e aparar, sem união de clipes |
| Grupos de clipes | Sim | Sim | Sim |
| Ganho de clipe | Sim | Sim | Sim |
| Tom e velocidade por clipe | Sim — ajustar, renderizar ou redefinir | Sim — ajustar, renderizar ou redefinir | Parcial — o esticamento permanece editável, o tom é um efeito |
| Seguir mudanças de andamento | Sim — os clipes se esticam quando o mapa se move | Sim | Não |
| Quantização e groove conscientes de batidas | Sim — mapas de warp com intensidade de groove ajustável | Não | Não |
| Alinhar a zeros cruzados | Sim | Sim | Sim |
| Desenho em nível de amostra | Sim | Parcial — nenhuma ação de desenho registrada na versão fixada | Sim — no editor de forma de onda |
| Edição apenas por teclado | Sim — cada primitiva de edição tem uma ação de navegação | Sim — cada primitiva de edição tem uma ação de navegação | Parcial — atalhos extensos, alguns painéis precisam do mouse |

## Trabalho espectral e restauração

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Visualização de espectrograma | Sim — com configurações por faixa | Sim — com configurações por faixa | Sim — exibições de frequência e tom |
| Seleção limitada por frequência | Sim | Sim | Sim — seleção por contorno e laço |
| Pincel espectral | Sim | Sim | Sim — pincel de pintura e reparo pontual |
| Excluir ou amplificar uma região espectral | Sim — ambos como ações diretas | Sim — ambos como ações diretas | Parcial — aplicar um efeito à seleção |
| Reparar danos curtos | Sim — Reparar | Sim — Reparar | Sim — Reparo Automático e Pincel de Reparo Pontual |
| Redução de ruído de banda larga | Sim — com um perfil capturado | Sim — com um perfil capturado | Sim — Redução de Ruído, Redução Adaptativa de Ruído, DeNoise |
| Desreverberação | Não | Não | Sim — DeReverb |
| Ferramentas de cliques, zumbidos e sibilância | Parcial — apenas Remoção de Cliques | Parcial — apenas Remoção de Cliques | Sim — DeClicker, DeHummer, DeEsser, Eliminador de Cliques/Estalos |
| Painel de diagnóstico | Parcial — Encontrar Clipping como analisador | Parcial — Encontrar Clipping como analisador | Sim — diagnóstico com reparo por problema |

## Efeitos e plug-ins

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suíte de efeitos integrada | Sim — os 30 efeitos do Audacity, plug-ins Nyquist incluídos e efeitos de primeira parte sem equivalente upstream, como o bitcrusher | Sim — a mesma coleção integrada de 30 efeitos | Sim — cerca de cinquenta, incluindo dinâmica multibanda |
| Rack de efeitos em tempo real por faixa | Sim — um conjunto em tempo real mais amplo que o upstream | Sim | Sim — dezesseis slots por clipe, faixa e master |
| EQ paramétrico | Sim — um novo EQ paramétrico com bandas automatizáveis | Parcial — Filter Curve e Graphic EQ | Sim — filtros paramétricos, gráficos e FFT |
| Presets de efeitos | Sim — aplicar, salvar, importar, exportar | Sim — aplicar, salvar, importar, exportar | Sim |
| Macros e cadeias em lote | Sim — biblioteca de macros salvas com modelos | Não — a build fixada comenta o menu Macros | Sim — Favoritos e Batch Process |
| Formatos de plug-ins de terceiros | Parcial — VST3, CLAP, AU e LV2 no desktop com consentimento e contenção, nenhum no navegador | Sim — VST3, AU, LV2 e Nyquist, com um gerenciador de plug-ins | Parcial — VST3 e AU no macOS, sem CLAP ou LV2 |
| Scripting Nyquist | Sim — plug-ins incluídos e o prompt Nyquist | Sim — plug-ins incluídos e o prompt Nyquist | Não |
| Pacotes de efeitos sandboxed | Parcial — pacotes WebAssembly revisados, um é distribuído e os externos são isolados | Não | Não |
| Instrumentos virtuais | Não — após a 1.0 | Não | Não |

## Mixagem, roteamento e automação

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixer com channel strips | Sim | Parcial — controles de faixa e uma faixa master | Sim |
| Buses e submixes | Sim — aninhados, com validação de ciclo | Não | Sim — faixas de bus |
| Sends | Sim — pré e pós-fader, múltiplas atribuições | Não | Sim — pré e pós-fader |
| Grupos VCA | Sim | Não | Não |
| Entrada sidechain | Sim | Não | Sim — através de sends |
| Mixes de cue e control room | Sim | Não | Não |
| Compensação de atraso de plug-ins | Sim — reprodução, monitoramento, buses, sidechains, render e freeze | Parcial — não exposto nas fontes fixadas | Sim |
| Faixas de automação | Sim — ganho, pan, mute, sends, buses e parâmetros de plug-ins | Não — sem faixas e sem ferramenta de envelope na build fixada | Sim — volume, pan e parâmetros de efeitos |
| Modos de automação | Sim — read, trim, touch, latch e write | Não | Parcial — read, write, latch e touch, sem trim |
| Formas de curva | Sim — linha, hold e curva | Não | Sim — linear e spline |
| Freeze de faixa | Sim — freeze, unfreeze e commit sem perder estado | Não | Parcial — bounce para uma nova faixa |

## Medição e análise

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Medidor de loudness | Sim — estilo EBU R 128, com histórico | Não — um efeito de Normalização de Loudness, mas sem medidor | Sim — Loudness Radar conforme ITU-R BS.1770 |
| Medidor de fase e correlação | Sim | Não | Sim — medidor de fase e análise |
| Medição de surround | Sim | Não | Parcial — até 5.1 |
| Gráfico de espectro | Sim — Plot Spectrum | Parcial — registrado, mas a build fixada o comenta fora do menu Analisar | Sim — Análise de Frequência |
| Clipping e RMS na forma de onda | Sim — ambos, alternados por projeto | Sim — ambos, alternados por projeto | Parcial — indicadores de clipping, RMS em Estatísticas de Amplitude |
| Contraste de inteligibilidade da fala | Sim — analisador de Contraste | Parcial — registrado, mas a build fixada o comenta fora do menu Analisar | Não |

## Canais e áudio imersivo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canais por arquivo | Sim — até 32 para formatos PCM | Parcial — faixas mono e estéreo | Sim — até 32 no editor de forma de onda |
| Mixagem de surround | Sim — beds até 7.1.4 | Não | Parcial — até 5.1 |
| Áudio baseado em objetos | Sim — objetos ao lado dos beds | Não | Não |
| Autoria e passagem de ADM | Sim — BW64/ADM com verificações de conformidade | Não | Não |
| Renderização binaural | Sim — um modelo binaural nomeado | Não | Parcial — binauralizador para ambisonics |
| Ambisonics | Não | Não | Sim — primeira ordem, com um panner VR |

## Exportação e entrega

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Saída sem perdas | Sim — WAV, AIFF, BWF e BW64 escritos nativamente | Sim — WAV, AIFF e FLAC | Sim — WAV, AIFF, FLAC e mais |
| Saída com perdas | Parcial — MP3, AAC, Opus, Vorbis, MP2, FLAC e WavPack, todos através do runtime FFmpeg | Parcial — MP3 embutido, o resto através de uma instalação opcional do FFmpeg | Sim — embutido |
| Configurações personalizadas de codificador | Sim — um destino FFmpeg personalizado | Sim — um destino FFmpeg personalizado | Sim — opções por formato |
| Fila de exportação | Sim — pausar, cancelar, repetir e reordenar | Não — uma exportação por vez | Parcial — Batch Process sem controle de fila |
| Stems e alternativos em uma passada | Sim — enfileirados junto com a mixagem | Não | Parcial — um mixdown por stem |
| Entrega por região | Sim — sequências de masterização com metadados por região, lacunas e fades | Parcial — exportar rótulos, sem exportação de múltiplos arquivos na build fixada | Sim — exportar marcadores para arquivos separados |
| Normalização de loudness na exportação | Sim — parte do plano de entrega | Parcial — executar o efeito primeiro | Sim — Match Loudness |
| Dither e mapeamento de canais | Sim — controles explícitos | Parcial — dither nas preferências | Sim — controles explícitos |
| Relatório de entrega | Sim — itemizado por trabalho | Não | Não |
| Fila de renderização sobrevive a uma reinicialização | Sim — no desktop, reiniciando do byte zero com um diário de crash | Não | Não |

## Intercâmbio com outras ferramentas

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Projetos do Audacity | Sim — entrada e saída em AUP4, com um relatório de omissões | Sim — nativo | Não |
| EDL | Parcial — exportação de classe CMX3600, sem importação | Não | Não |
| OpenTimelineIO | Parcial — apenas exportação | Não | Não |
| FCPXML | Parcial — apenas exportação | Não | Sim — importação e exportação |
| DAWproject | Sim — importação e exportação, com um relatório de troca | Não | Não |
| OMF | Não | Não | Parcial — importação e exportação |
| Ida e volta com um editor de vídeo | Parcial — entrega o mesmo projeto ao Framescaper sem copiar mídia | Não | Sim — Dynamic Link com o Premiere Pro |
| Troca de rótulos e marcadores | Sim — importação e exportação | Sim — importação e exportação | Sim — listas de marcadores |

## Vídeo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Importar vídeo para referência | Sim — na linha do tempo, com áudio vinculado | Não | Parcial — uma faixa de vídeo, apenas pré-visualização |
| Edição de linha do tempo de vídeo | Parcial — edição básica, a superfície completa é o Framescaper | Não | Não |
| Exportação de vídeo | Sim — MP4 e WebM por meio do runtime FFmpeg | Não | Não — apenas áudio |
| Composição, colorização e efeitos | Parcial — no Framescaper, no mesmo projeto | Não | Não |

## Assistência por máquina

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Aprimoramento de fala | Parcial — apenas desktop, após a instalação do payload do modelo | Não | Sim — Enhance Speech |
| Transcrição e diarização | Parcial — apenas desktop, modelos opcionais | Não | Não — transcrições ficam no Premiere Pro |
| Separação de fonte em stems | Parcial — apenas desktop, modelos opcionais | Não | Não |
| Ducking automático | Sim — efeito Auto Duck | Sim — efeito Auto Duck | Sim — ducking do Essential Sound |
| Detecção de batida e corte | Parcial — apenas desktop, modelos opcionais | Não | Parcial — Remix retemporiza música automaticamente |
| Executa inteiramente na sua máquina | Sim — a inferência é apenas desktop e offline após a instalação | Sim — nenhuma inferência | Parcial — alguns recursos processam na nuvem da Adobe |
| Modelos são opcionais e removíveis | Sim — baixados separadamente, fixados por digest, removíveis | Sim — nada a instalar | Não — incluídos com o aplicativo |

## O que as diferenças somam

O Audacity 4 é um editor de passagem única. Ele não possui barramentos, envios, faixas de automação nem macros na versão fixada. O Soundscaper mantém esse modelo de edição e adiciona a camada de mixagem, automação e entrega por cima dele, além de gravação, vídeo e trabalho de intercâmbio que o Audacity não tenta.

O Audition ainda lidera em profundidade de restauração, em idas e voltas com o Premiere Pro e em ambisonics. Onde o Soundscaper lidera é na entrega imersiva, no tratamento de projetos e no fato de que ele roda em um navegador em hardware que nenhum dos outros suporta.

Se você já trabalha no Audacity, veja
[arquivos de projeto e intercâmbio com o Audacity](/projects-and-data/project-files/) para
saber como mover um projeto.
