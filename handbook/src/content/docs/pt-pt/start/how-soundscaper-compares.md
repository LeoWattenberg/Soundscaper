---
title: "Como o Soundscaper se compara"
description: "Compare o Soundscaper com o Audacity 4 e o Adobe Audition em gravação, edição, mistura, entrega e intercâmbio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"703e76cffbe1464f1283f6c8f45cee52c0d37faae852b7efc163879710a2ddb2","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"703e76cffbe1464f1283f6c8f45cee52c0d37faae852b7efc163879710a2ddb2","targetLocale":"pt-PT"} -->

O Soundscaper reimplementa o Audacity 4 na web e adiciona uma camada de produção por cima dele. O Adobe Audition é a ferramenta comercial de pós-produção contra a qual ambos são geralmente medidos. Esta página compara os três para que possa determinar qual deles já executa a tarefa que tem.

## Como ler esta página

Cada célula lê **Sim**, **Parcial** ou **Não**, seguida pelo detalhe que a qualifica.

**Parcial** abrange três situações diferentes, e a nota indica qual se aplica: a capacidade existe, mas é mais estreita do que noutras; existe, mas depende de algo que tem de fornecer; ou só é acessível contornando uma ausência.

As linhas descrevem capacidades, não comandos de menu. Para o inventário exato de comandos, consulte [Comandos e atalhos](/reference/generated/commands/), e para o que cada produto permite, consulte
[Capacidades do produto](/reference/generated/product-capabilities/).

### De onde vêm estas afirmações

- As linhas do **Soundscaper** provêm deste repositório: os perfis de capacidade do produto, o manifesto de ações de tempo de execução e o registo de formatos de exportação. As cargas úteis de destino nativas para desktop são geradas pela CI do repositório ou pela embalagem do destino. Um pacote só permite uma após a preparação e verificação do resultado de correspondência exato; essas linhas indicam quando uma carga útil ainda é necessária.
- As linhas do **Audacity 4** provêm do inventário de montante fixado neste repositório, `4.0.0` no commit `4c177d43`. Uma capacidade que o montante regista, mas deixa desativada ou comenta fora do menu, é registada como tal, e uma capacidade sem registo na compilação fixada é reportada como não presente nessa compilação, em vez de permanentemente ausente.
- As linhas do **Audition** provêm da documentação publicada pela Adobe para a versão atual. Não são verificadas contra uma compilação em execução.

## Plataforma e termos

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licença | Sim — AGPL-3.0-only | Sim — GPL, código aberto | Não — proprietário e fechado |
| Custo | Sim — gratuito | Sim — gratuito | Não — assinatura Creative Cloud |
| Funciona num navegador | Sim — Chromium, Firefox e WebKit | Não — apenas desktop | Não — apenas desktop |
| Compilações para desktop | Sim — Windows e Linux em x64 e ARM64, macOS em ARM64 | Sim — Windows, macOS, Linux | Parcial — Windows e macOS, sem Linux |
| Funciona sem conta | Sim — não existe conta | Sim — início de sessão apenas para audio.com | Não — requer assinatura iniciada sessão |
| Armazenamento de projetos na cloud | Não — excluído pelo design local-first | Sim — guardar e partilhar através de audio.com | Parcial — ficheiros Creative Cloud, as sessões não sincronizam |
| Requisitos do sistema | Sim — funciona onde quer que um navegador atual funcione | Parcial — aumentou substancialmente em relação ao Audacity 3 | Parcial — classe de estação de trabalho profissional |

## Modelo de projeto e sessão

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Formato de projeto nativo | Sim — `.sscape`, um arquivo portátil sem perdas | Sim — `.aup4` | Sim — `.sesx` |
| Abre projetos do Audacity | Sim — importação e exportação AUP4 | Sim — nativo | Não |
| Linha temporal de clipes não destrutiva | Sim | Sim | Sim — editor multicanal |
| Editor de ficheiro único dedicado | Parcial — a edição de amostras ocorre na linha temporal | Parcial — as edições são aplicadas no local na linha temporal | Sim — editor de forma de onda |
| Conteúdo mono e estéreo num único canal | Sim — um canal contém um ou outro | Não — um canal é mono ou estéreo | Não — o formato de canal é fixo por canal |
| Pastas de canais aninhadas | Sim — qualquer profundidade, com desfazer e roteamento | Não | Parcial — apenas barramentos de submixagem, sem canais de pasta |
| Caixa de projeto | Sim — organiza ficheiros e funciona como área de transferência | Não | Parcial — o painel Ficheiros lista os ficheiros abertos |
| Gravação automática e recuperação de falhas | Sim — gravação automática, bloqueios e envelopes de recuperação | Sim | Sim |
| Marcadores e regiões nomeadas | Sim — de primeira classe, com navegação e comportamento de ondulação | Parcial — canais de etiquetas | Sim — marcadores e intervalos |
| Mapas de andamento e assinatura de compasso | Sim — mapas ordenados resolvidos com precisão de amostra | Parcial — um andamento e assinatura por projeto | Parcial — um andamento por sessão |

## Gravação

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Gravação multicanal | Sim — várias fontes ao mesmo tempo | Parcial — um dispositivo de entrada de cada vez | Sim — interfaces multi-entrada e multicanal |
| Áudio de microfone e de desktop em conjunto | Sim — integrado | Não | Parcial — requer um dispositivo de loopback do sistema operativo |
| Gravação temporizada | Sim | Sim | Não |
| Gravação ativada por som | Sim — com limiar ajustável | Sim — com limiar ajustável | Não |
| Contagem antes da gravação | Sim — consciente do mapa de andamento, lida com compasso composto | Parcial — gravação de introdução | Parcial — pré-rolagem como parte da gravação por impacto |
| Gravação por impacto | Sim — uma transação, captura predefinida e roteada | Não | Sim — gravação por impacto e rolagem |
| Gravação em loop para gravações | Sim — uma faixa por passagem, acrescentada ao mesmo grupo | Não | Parcial — gravações num único clipe, escolhidas de uma lista |
| Comping de gravações | Sim — audição, promoção, edição de regiões de comping, aplanamento como uma única edição com desfazer | Não | Não — sem editor de comping |
| Monitorização e medição de entrada | Sim | Sim | Sim |

## Edição da linha temporal

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Variantes de edição ripple | Sim — por clipe, por faixa e todas as faixas, em corte e eliminação | Sim — as mesmas três, em corte e eliminação | Parcial — eliminação ripple numa seleção ou intervalo |
| Dividir, juntar e dividir em silêncios | Sim | Sim | Parcial — dividir e aparar, sem junção de clipes |
| Grupos de clipes | Sim | Sim | Sim |
| Ganho de clipe | Sim | Sim | Sim |
| Afinação e velocidade por clipe | Sim — ajustar, renderizar ou repor | Sim — ajustar, renderizar ou repor | Parcial — o alongamento mantém-se editável, a afinação é um efeito |
| Seguir alterações de andamento | Sim — os clipes alongam-se quando o mapa se move | Sim | Não |
| Quantização e groove conscientes do ritmo | Sim — mapas de warp com intensidade de groove ajustável | Não | Não |
| Ajuste a zeros cruzados | Sim | Sim | Sim |
| Desenho a nível de amostra | Sim | Parcial — nenhuma ação de desenho registada na versão fixada | Sim — no editor de forma de onda |
| Edição apenas por teclado | Sim — cada primitiva de edição tem uma ação de navegação | Sim — cada primitiva de edição tem uma ação de navegação | Parcial — atalhos extensos, alguns painéis precisam do rato |

## Trabalho espectral e restauro

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vista de espectrograma | Sim — com definições por faixa | Sim — com definições por faixa | Sim — visualizações de frequência e afinação |
| Seleção limitada por frequência | Sim | Sim | Sim — retângulo e laço |
| Pincel espectral | Sim | Sim | Sim — pincel e reparação pontual |
| Eliminar ou amplificar uma região espectral | Sim — ambos como ações diretas | Sim — ambos como ações diretas | Parcial — aplicar um efeito à seleção |
| Reparar danos curtos | Sim — Reparação | Sim — Reparação | Sim — Reparação Automática e Pincel de Reparação Pontual |
| Redução de ruído de banda larga | Sim — com um perfil capturado | Sim — com um perfil capturado | Sim — Redução de Ruído, Redução Adaptativa de Ruído, DeNoise |
| Desreverberação | Não | Não | Sim — DeReverb |
| Ferramentas de cliques, zumbidos e sibilância | Parcial — apenas Remoção de Cliques | Parcial — apenas Remoção de Cliques | Sim — DeClicker, DeHummer, DeEsser, Eliminador de Cliques/Pop |
| Painel de diagnósticos | Parcial — Detetar Clipping como analisador | Parcial — Detetar Clipping como analisador | Sim — diagnósticos com reparação por problema |

## Efeitos e extensões

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suite de efeitos integrada | Sim — os 30 efeitos do Audacity, os plug-ins Nyquist incluídos e efeitos de primeira parte sem equivalente a montante, como o bitcrusher | Sim — a mesma coleção integrada de 30 efeitos | Sim — cerca de cinquenta, incluindo dinâmica multibanda |
| Rack de efeitos em tempo real por faixa | Sim — um conjunto em tempo real mais amplo do que a montante | Sim | Sim — dezasseis slots por clipe, faixa e master |
| EQ paramétrico | Sim — um novo EQ paramétrico com bandas automatizáveis | Parcial — Filter Curve e Graphic EQ | Sim — filtros paramétricos, gráficos e FFT |
| Predefinições de efeitos | Sim — aplicar, guardar, importar, exportar | Sim — aplicar, guardar, importar, exportar | Sim |
| Macros e cadeias em lote | Sim — biblioteca de macros guardada com modelos | Não — a compilação fixada comenta o menu Macros | Sim — Favoritos e Batch Process |
| Formatos de plug-ins de terceiros | Parcial — VST3, CLAP, AU e LV2 no desktop, sujeitos a consentimento e contenção; nenhum no navegador | Sim — VST3, AU, LV2 e Nyquist, com um gestor de plug-ins | Parcial — VST3 e AU no macOS, sem CLAP ou LV2 |
| Scripting Nyquist | Sim — plug-ins incluídos e o prompt Nyquist | Sim — plug-ins incluídos e o prompt Nyquist | Não |
| Pacotes de efeitos em sandbox | Parcial — pacotes WebAssembly revistos, um é incluído e os externos estão isolados | Não | Não |
| Instrumentos virtuais | Não — após a 1.0 | Não | Não |

## Mistura, roteamento e automação

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Misturador com faixas de canais | Sim | Parcial — controlos de faixa e uma faixa master | Sim |
| Barras e submisturas | Sim — aninhadas, com validação de ciclo | Não | Sim — faixas de barra |
| Enviações (Sends) | Sim — pré e pós-fader, múltiplas atribuições | Não | Sim — pré e pós-fader |
| Grupos VCA | Sim | Não | Não |
| Entrada de sidechain | Sim | Não | Sim — através de enviações |
| Misturas de cue e sala de controlo | Sim | Não | Não |
| Compensação de atraso de plug-ins | Sim — reprodução, monitorização, barras, sidechains, renderização e congelação | Parcial — não exposto nas fontes fixadas | Sim |
| Faixas de automação | Sim — ganho, panorâmica, mudo, enviações, barras e parâmetros de plug-ins | Não — sem faixas e sem ferramenta de envolvente na compilação fixada | Sim — volume, panorâmica e parâmetros de efeitos |
| Modos de automação | Sim — leitura, ajuste, toque, retenção e escrita | Não | Parcial — leitura, escrita, retenção e toque, sem ajuste |
| Formas de curva | Sim — linha, retenção e curva | Não | Sim — linear e spline |
| Congelação de faixa | Sim — congelar, descongelar e confirmar sem perder o estado | Não | Parcial — bounce para uma nova faixa |

## Medição e análise

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Medidor de sonoridade | Sim — estilo EBU R 128, com histórico | Não — um efeito de Normalização de Sonoridade, mas sem medidor | Sim — Loudness Radar em conformidade com ITU-R BS.1770 |
| Medidor de fase e correlação | Sim | Não | Sim — medidor de fase e análise |
| Medição de surround | Sim | Não | Parcial — até 5.1 |
| Gráfico de espetro | Sim — Plot Spectrum | Parcial — registado, mas a compilação fixada comenta-o fora do menu Analisar | Sim — Frequency Analysis |
| Clipping e RMS na forma de onda | Sim — ambos, alternados por projeto | Sim — ambos, alternados por projeto | Parcial — indicadores de clipping, RMS em Amplitude Statistics |
| Contraste de inteligibilidade da fala | Sim — analisador de contraste | Parcial — registado, mas a compilação fixada comenta-o fora do menu Analisar | Não |

## Canais e áudio imersivo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canais por ficheiro | Sim — até 32 para formatos PCM | Parcial — faixas mono e estéreo | Sim — até 32 no editor de forma de onda |
| Mistura surround | Sim — leitos até 7.1.4 | Não | Parcial — até 5.1 |
| Áudio baseado em objetos | Sim — objetos junto com leitos | Não | Não |
| Criação e passagem de ADM | Sim — BW64/ADM com verificações de conformidade | Não | Não |
| Renderização binaural | Sim — um modelo binaural nomeado | Não | Parcial — binauralizador para ambisonics |
| Ambisonics | Não | Não | Sim — primeira ordem, com um panner VR |

## Exportação e entrega

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Saída sem perdas | Sim — WAV, AIFF, BWF e BW64 escritos nativamente | Sim — WAV, AIFF e FLAC | Sim — WAV, AIFF, FLAC e mais |
| Saída com perdas | Parcial — MP3, AAC, Opus, Vorbis, MP2, FLAC e WavPack, todos através do runtime FFmpeg | Parcial — MP3 integrado, o resto através de uma instalação opcional do FFmpeg | Sim — integrado |
| Definições personalizadas de codificador | Sim — um destino FFmpeg personalizado | Sim — um destino FFmpeg personalizado | Sim — opções por formato |
| Fila de exportação | Sim — pausar, cancelar, repetir e reordenar | Não — uma exportação de cada vez | Parcial — Batch Process sem controlo de fila |
| Stems e alternativos numa única passagem | Sim — enfileirados juntos com a mistura | Não | Parcial — um mixdown por stem |
| Entrega por região | Sim — sequências de masterização com metadados por região, lacunas e fades | Parcial — exportar etiquetas, sem exportação de múltiplos ficheiros na compilação fixada | Sim — exportar marcadores para ficheiros separados |
| Normalização de sonoridade na exportação | Sim — parte do plano de entrega | Parcial — executar o efeito primeiro | Sim — Match Loudness |
| Dither e mapeamento de canais | Sim — controlos explícitos | Parcial — dither nas preferências | Sim — controlos explícitos |
| Relatório de entrega | Sim — detalhado por trabalho | Não | Não |
| A fila de renderização sobrevive a uma reinicialização | Sim — no desktop, reiniciando do byte zero com um diário de falhas | Não | Não |

## Intercâmbio com outras ferramentas

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Projetos Audacity | Sim — entrada e saída AUP4, com um relatório de omissões | Sim — nativo | Não |
| EDL | Parcial — exportação de classe CMX3600, sem importação | Não | Não |
| OpenTimelineIO | Parcial — apenas exportação | Não | Não |
| FCPXML | Parcial — apenas exportação | Não | Sim — importação e exportação |
| DAWproject | Sim — importação e exportação, com um relatório de intercâmbio | Não | Não |
| OMF | Não | Não | Parcial — importação e exportação |
| Ida e volta com um editor de vídeo | Parcial — entrega o mesmo projeto ao Framescaper sem copiar os meios | Não | Sim — Dynamic Link com o Premiere Pro |
| Intercâmbio de etiquetas e marcadores | Sim — importação e exportação | Sim — importação e exportação | Sim — listas de marcadores |

## Vídeo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Importação de vídeo para referência | Sim — na linha temporal, com áudio vinculado | Não | Parcial — uma faixa de vídeo, apenas pré-visualização |
| Edição de linha temporal de vídeo | Parcial — edição básica, a superfície completa é o Framescaper | Não | Não |
| Exportação de vídeo | Sim — MP4 e WebM através do tempo de execução FFmpeg | Não | Não — apenas áudio |
| Composição, correção de cor e efeitos | Parcial — no Framescaper, no mesmo projeto | Não | Não |

## Assistência por máquina

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Melhoria da fala | Parcial — apenas em desktop, após a instalação da carga do modelo | Não | Sim — Enhance Speech |
| Transcrição e diarização | Parcial — apenas em desktop, modelos opcionais | Não | Não — as transcrições estão no Premiere Pro |
| Separação de fonte em stems | Parcial — apenas em desktop, modelos opcionais | Não | Não |
| Atenuação automática | Sim — efeito Auto Duck | Sim — efeito Auto Duck | Sim — atenuação do Essential Sound |
| Detecção de batida e de plano | Parcial — apenas em desktop, modelos opcionais | Não | Parcial — o Remix retemporiza a música automaticamente |
| Executa inteiramente na sua máquina | Sim — a inferência é apenas em desktop e offline após a instalação | Sim — sem inferência | Parcial — algumas funcionalidades processam na nuvem da Adobe |
| Os modelos são opcionais e removíveis | Sim — descarregados separadamente, fixados por resumo, elimináveis | Sim — nada a instalar | Não — incluídos com a aplicação |

## O que as diferenças representam

O Audacity 4 é um editor de passagem única. Não tem barramentos, não tem envios, não tem faixas de automação e não tem macros na versão fixada. O Soundscaper mantém esse modelo de edição e adiciona a camada de mistura, automação e entrega por cima dele, além de gravação, vídeo e trabalho de intercâmbio que o Audacity não tenta.

O Audition ainda lidera em profundidade de restauro, em idas e voltas com o Premiere Pro e em ambisonics. Onde o Soundscaper lidera é na entrega imersiva, no tratamento de projetos e no facto de funcionar num navegador em hardware que nenhum dos outros suporta.

Se já trabalha no Audacity, veja
[arquivos de projeto e intercâmbio com o Audacity](/projects-and-data/project-files/) para
saber como mover um projeto.
