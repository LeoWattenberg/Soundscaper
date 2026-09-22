---
title: "Como o Soundscaper se compara"
description: "Compare o Soundscaper com o Audacity 4 e o Adobe Audition em gravação, edição, mixagem, entrega e intercâmbio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"pt-BR"} -->

O Soundscaper reimplementa o Audacity 4 na web e adiciona uma camada de produção
acima dele. O Adobe Audition é a ferramenta comercial de pós-produção com a qual
os dois normalmente são comparados. Esta página compara os três para que você
possa identificar qual deles já realiza a tarefa de que precisa.

## Como ler esta página

Cada célula contém **Sim**, **Parcial** ou **Não**, seguido do detalhe que
qualifica a resposta.

**Parcial** abrange três situações diferentes, e a observação indica qual se
aplica: a capacidade existe, mas é mais limitada do que em outros lugares; existe,
mas depende de algo que você precisa fornecer; ou só pode ser acessada contornando
uma ausência.

As linhas descrevem capacidades, não comandos de menu. Para o inventário exato de
comandos, consulte [Comandos e atalhos](/reference/generated/commands/), e para
saber o que cada produto habilita, consulte
[Capacidades do produto](/reference/generated/product-capabilities/).

### De onde vêm estas afirmações

- As linhas do **Soundscaper** vêm deste repositório: os perfis de capacidade do
  produto, o manifesto de ações de tempo de execução e o registro de formatos de
  exportação. Cargas úteis de destino nativas para desktop são geradas pela CI do
  repositório ou pelo empacotamento do destino. Um pacote habilita uma delas somente
  após preparar e verificar o resultado exato correspondente; essas linhas indicam
  quando uma carga útil ainda é necessária.
- As linhas do **Audacity 4** vêm do inventário upstream fixado neste repositório,
  `4.0.0` no commit `4c177d43`. Uma capacidade que o upstream registra, mas deixa
  desativada ou comenta fora do menu, é registrada como tal, e uma capacidade sem
  registro na compilação fixada é relatada como ausente nessa compilação, não como
  permanentemente ausente.
- As linhas do **Audition** vêm da documentação publicada pela Adobe para a versão
  atual. Elas não são verificadas em uma compilação em execução.

## Plataforma e termos

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licença | Sim — AGPL-3.0-only | Sim — GPL, código aberto | Não — proprietário e fechado |
| Custo | Sim — gratuito | Sim — gratuito | Não — assinatura Creative Cloud |
| Executa em um navegador | Sim — Chromium, Firefox e WebKit | Não — somente desktop | Não — somente desktop |
| Compilações para desktop | Sim — Windows e Linux em x64 e ARM64, macOS em ARM64 | Sim — Windows, macOS, Linux | Parcial — Windows e macOS, sem Linux |
| Funciona sem conta | Sim — não existe conta | Sim — login somente para audio.com | Não — é necessária uma assinatura com login |
| Armazenamento de projetos na nuvem | Não — excluído pelo design local-first | Sim — salvar e compartilhar pelo audio.com | Parcial — arquivos do Creative Cloud, sessões não sincronizam |
| Requisitos do sistema | Sim — executa onde quer que um navegador atual execute | Parcial — aumentou substancialmente em relação ao Audacity 3 | Parcial — classe de estação de trabalho profissional |

## Modelo de projeto e sessão

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Formato de projeto nativo | Sim — `.sscape`, um arquivo portátil sem perdas | Sim — `.aup4` | Sim — `.sesx` |
| Abre projetos do Audacity | Sim — importação e exportação AUP4 | Sim — nativo | Não |
| Linha do tempo de clipes não destrutiva | Sim | Sim | Sim — editor multifaixas |
| Editor dedicado de arquivo único | Parcial — a edição de amostras ocorre na linha do tempo | Parcial — as edições são aplicadas no local na linha do tempo | Sim — editor de forma de onda |
| Conteúdo mono e estéreo em uma faixa | Sim — uma faixa contém um ou outro | Não — uma faixa é mono ou estéreo | Não — o formato de canal é fixo por faixa |
| Pastas de faixas aninhadas | Sim — qualquer profundidade, com desfazer e roteamento | Não | Parcial — somente barramentos de submixagem, sem faixas de pasta |
| Caixa do projeto | Sim — organiza arquivos e também funciona como área de transferência | Não | Parcial — o painel Arquivos lista os arquivos abertos |
| Salvamento automático e recuperação de falhas | Sim — salvamento automático, bloqueios e envelopes de recuperação | Sim | Sim |
| Marcadores e regiões nomeadas | Sim — de primeira classe, com navegação e comportamento ripple | Parcial — faixas de rótulos | Sim — marcadores e intervalos |
| Mapas de andamento e fórmula de compasso | Sim — mapas ordenados resolvidos com precisão de amostra | Parcial — um andamento e fórmula por projeto | Parcial — um andamento por sessão |

## Gravação

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Gravação multifaixas | Sim — várias fontes ao mesmo tempo | Parcial — um dispositivo de entrada por vez | Sim — interfaces com várias entradas e multicanais |
| Áudio de microfone e desktop juntos | Sim — integrado | Não | Parcial — requer um dispositivo de loopback do sistema operacional |
| Gravação programada | Sim | Sim | Não |
| Gravação ativada por som | Sim — com limite configurável | Sim — com limite configurável | Não |
| Contagem antes da tomada | Sim — ciente do mapa de andamento, lida com métrica composta | Parcial — gravação de introdução | Parcial — pré-rolagem como parte do punch and roll |
| Gravação punch | Sim — uma transação, captura padrão e roteada | Não | Sim — punch and roll |
| Gravação em loop em tomadas | Sim — uma faixa por passagem, adicionada ao mesmo grupo | Não | Parcial — tomadas em um clipe, escolhidas de uma lista |
| Comping de tomadas | Sim — audição, promoção, edição de regiões de comp e achatamento como uma edição única com desfazer | Não | Não — sem editor de comp |
| Monitoramento e medição de entrada | Sim | Sim | Sim |

## Edição da linha do tempo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Variantes de edição ripple | Sim — por clipe, por faixa e todas as faixas, ao cortar e excluir | Sim — as mesmas três, ao cortar e excluir | Parcial — exclusão ripple em uma seleção ou lacuna |
| Dividir, unir e dividir nos silêncios | Sim | Sim | Parcial — dividir e aparar, sem união de clipes |
| Grupos de clipes | Sim | Sim | Sim |
| Ganho do clipe | Sim | Sim | Sim |
| Tom e velocidade por clipe | Sim — ajustar, renderizar ou redefinir | Sim — ajustar, renderizar ou redefinir | Parcial — o estiramento continua editável, o tom é um efeito |
| Seguir mudanças de andamento | Sim — os clipes se esticam quando o mapa se move | Sim | Não |
| Quantização e groove conscientes das batidas | Sim — mapas de warp com intensidade de groove ajustável | Não | Não |
| Ajuste aos cruzamentos por zero | Sim | Sim | Sim |
| Desenho no nível de amostra | Sim | Parcial — nenhuma ação de desenho registrada na compilação fixada | Sim — no editor de forma de onda |
| Edição somente pelo teclado | Sim — cada primitiva de edição tem uma ação de navegação | Sim — cada primitiva de edição tem uma ação de navegação | Parcial — atalhos extensos, alguns painéis precisam do mouse |

## Trabalho espectral e restauração

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Visualização de espectrograma | Sim — com configurações por faixa | Sim — com configurações por faixa | Sim — exibições de frequência e tom |
| Seleção limitada por frequência | Sim | Sim | Sim — seleção retangular e laço |
| Pincel espectral | Sim | Sim | Sim — pincel de pintura e reparo pontual |
| Excluir ou amplificar uma região espectral | Sim — ambos como ações diretas | Sim — ambos como ações diretas | Parcial — aplicar um efeito à seleção |
| Reparar danos curtos | Sim — Reparar | Sim — Reparar | Sim — Auto Heal e Spot Healing Brush |
| Redução de ruído de banda larga | Sim — com um perfil capturado | Sim — com um perfil capturado | Sim — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Remoção de reverb | Não | Não | Sim — DeReverb |
| Ferramentas para cliques, zumbido e sibilância | Parcial — somente Remoção de Cliques | Parcial — somente Remoção de Cliques | Sim — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Painel de diagnóstico | Parcial — Encontrar Clipping como analisador | Parcial — Encontrar Clipping como analisador | Sim — diagnóstico com reparo por problema |

## Efeitos e plug-ins

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suíte de efeitos integrada | Sim — os 30 efeitos do Audacity, plug-ins Nyquist incluídos e efeitos próprios sem equivalente upstream, como o bitcrusher | Sim — a mesma coleção integrada de 30 efeitos | Sim — cerca de cinquenta, incluindo dinâmica multibanda |
| Rack de efeitos em tempo real por faixa | Sim — um conjunto em tempo real mais amplo que o upstream | Sim | Sim — dezesseis slots por clipe, faixa e master |
| EQ paramétrico | Sim — um novo EQ paramétrico com bandas automatizáveis | Parcial — Filter Curve e Graphic EQ | Sim — filtros paramétricos, gráficos e FFT |
| Predefinições de efeitos | Sim — aplicar, salvar, importar e exportar | Sim — aplicar, salvar, importar e exportar | Sim |
| Macros e cadeias em lote | Sim — biblioteca de macros salvas com modelos | Não — a compilação fixada comenta o menu Macros | Sim — Favorites e Batch Process |
| Formatos de plug-ins de terceiros | Parcial — VST3, CLAP, AU, LV2, efeitos Linux LADSPA e analisadores Vamp no desktop, com consentimento e contenção; nenhum no navegador | Sim — VST3, AU, LV2 e Nyquist, com gerenciador de plug-ins | Parcial — VST3 e AU no macOS, sem CLAP ou LV2 |
| Scripting Nyquist | Sim — plug-ins incluídos e o prompt Nyquist | Sim — plug-ins incluídos e o prompt Nyquist | Não |
| Pacotes de efeitos em sandbox | Parcial — pacotes WebAssembly revisados, um é distribuído e os externos são isolados | Não | Não |
| Instrumentos virtuais | Não — depois da versão 1.0 | Não | Não |

## Mixagem, roteamento e automação

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixer com canais | Sim | Parcial — controles de faixa e uma faixa master | Sim |
| Barramentos e submixagens | Sim — aninhados, com validação de ciclos | Não | Sim — faixas de barramento |
| Envios | Sim — pré e pós-fader, múltiplas atribuições | Não | Sim — pré e pós-fader |
| Grupos VCA | Sim | Não | Não |
| Entrada sidechain | Sim | Não | Sim — por meio de envios |
| Mixagens de cue e sala de controle | Sim | Não | Não |
| Compensação de atraso de plug-ins | Sim — reprodução, monitoramento, barramentos, sidechains, renderização e congelamento | Parcial — não exposta nas fontes fixadas | Sim |
| Faixas de automação | Sim — ganho, panorama, mudo, envios, barramentos e parâmetros de plug-ins | Não — sem faixas e sem ferramenta de envelope na compilação fixada | Sim — volume, panorama e parâmetros de efeitos |
| Modos de automação | Sim — leitura, ajuste, toque, retenção e escrita | Não | Parcial — leitura, escrita, retenção e toque, sem ajuste |
| Formas de curva | Sim — linha, retenção e curva | Não | Sim — linear e spline |
| Congelamento de faixa | Sim — congelar, descongelar e confirmar sem perder o estado | Não | Parcial — renderizar em uma nova faixa |

## Medição e análise

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Medidor de intensidade | Sim — no estilo EBU R 128, com histórico | Não — um efeito de Normalização de intensidade, mas sem medidor | Sim — Loudness Radar conforme ITU-R BS.1770 |
| Medidor de fase e correlação | Sim | Não | Sim — medidor de fase e análise |
| Medição de surround | Sim | Não | Parcial — até 5.1 |
| Gráfico de espectro | Sim — Plot Spectrum | Parcial — registrado, mas a compilação fixada o comenta fora do menu Analisar | Sim — Frequency Analysis |
| Clipping e RMS na forma de onda | Sim — ambos, alternados por projeto | Sim — ambos, alternados por projeto | Parcial — indicadores de clipping, RMS em Amplitude Statistics |
| Contraste de inteligibilidade da fala | Sim — analisador de Contraste | Parcial — registrado, mas a compilação fixada o comenta fora do menu Analisar | Não |

## Canais e áudio imersivo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canais por arquivo | Sim — até 32 para formatos PCM | Parcial — faixas mono e estéreo | Sim — até 32 no editor de forma de onda |
| Mixagem de surround | Sim — beds até 7.1.4 | Não | Parcial — até 5.1 |
| Áudio baseado em objetos | Sim — objetos ao lado dos beds | Não | Não |
| Autoria e passagem de ADM | Sim — BW64/ADM com verificações de conformidade | Não | Não |
| Renderização binaural | Sim — um modelo binaural nomeado | Não | Parcial — binauraliser para ambisonics |
| Ambisonics | Não | Não | Sim — primeira ordem, com um panner VR |

## Exportação e entrega

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Saída sem perdas | Sim — WAV, AIFF, BWF e BW64 escritos nativamente | Sim — WAV, AIFF e FLAC | Sim — WAV, AIFF, FLAC e mais |
| Saída com perdas | Parcial — MP3, AAC, Opus, Vorbis, MP2, FLAC e WavPack, todos pelo runtime FFmpeg | Parcial — MP3 integrado, o restante por uma instalação opcional do FFmpeg | Sim — integrado |
| Configurações personalizadas de codificador | Sim — um destino FFmpeg personalizado | Sim — um destino FFmpeg personalizado | Sim — opções por formato |
| Fila de exportação | Sim — pausar, cancelar, tentar novamente e reordenar | Não — uma exportação por vez | Parcial — Batch Process sem controle da fila |
| Stems e alternativos em uma passada | Sim — enfileirados junto com a mixagem | Não | Parcial — uma mixagem por stem |
| Entrega região por região | Sim — sequências de masterização com metadados por região, lacunas e desvanecimentos | Parcial — exportar rótulos, sem exportação de vários arquivos na compilação fixada | Sim — exportar marcadores para arquivos separados |
| Normalização de intensidade na exportação | Sim — parte do plano de entrega | Parcial — executar o efeito primeiro | Sim — Match Loudness |
| Dither e mapeamento de canais | Sim — controles explícitos | Parcial — dither nas preferências | Sim — controles explícitos |
| Relatório de entrega | Sim — detalhado por tarefa | Não | Não |
| Fila de renderização sobrevive a uma reinicialização | Sim — no desktop, reiniciando do byte zero com um diário de falhas | Não | Não |

## Intercâmbio com outras ferramentas

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Projetos do Audacity | Sim — entrada e saída em AUP4, com um relatório de omissões | Sim — nativo | Não |
| EDL | Parcial — exportação de classe CMX3600, sem importação | Não | Não |
| OpenTimelineIO | Parcial — somente exportação | Não | Não |
| FCPXML | Parcial — somente exportação | Não | Sim — importação e exportação |
| DAWproject | Sim — importação e exportação, com um relatório de intercâmbio | Não | Não |
| OMF | Não | Não | Parcial — importação e exportação |
| Ida e volta com um editor de vídeo | Parcial — entrega o mesmo projeto ao Framescaper sem copiar a mídia | Não | Sim — Dynamic Link com o Premiere Pro |
| Intercâmbio de rótulos e marcadores | Sim — importação e exportação | Sim — importação e exportação | Sim — listas de marcadores |

## Vídeo

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Importar vídeo para referência | Sim — na linha do tempo, com áudio vinculado | Não | Parcial — uma faixa de vídeo, somente pré-visualização |
| Edição da linha do tempo de vídeo | Parcial — edição básica; a superfície completa é o Framescaper | Não | Não |
| Exportação de vídeo | Sim — MP4 e WebM pelo runtime FFmpeg | Não | Não — somente áudio |
| Composição, correção de cor e efeitos | Parcial — no Framescaper, no mesmo projeto | Não | Não |

## Assistência por máquina

| Capacidade | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Aprimoramento de fala | Parcial — somente desktop, depois que a carga útil do modelo é instalada | Não | Sim — Enhance Speech |
| Transcrição e diarização | Parcial — somente desktop, modelos opcionais | Não | Não — as transcrições ficam no Premiere Pro |
| Separação de fontes em stems | Parcial — somente desktop, modelos opcionais | Não | Não |
| Ducking automático | Sim — efeito Auto Duck | Sim — efeito Auto Duck | Sim — ducking do Essential Sound |
| Detecção de batidas e planos | Parcial — somente desktop, modelos opcionais | Não | Parcial — Remix altera automaticamente o tempo da música |
| Executa inteiramente na sua máquina | Sim — a inferência é somente no desktop e offline após a instalação | Sim — sem inferência | Parcial — alguns recursos processam na nuvem da Adobe |
| Modelos são opcionais e removíveis | Sim — baixados separadamente, fixados por digest e removíveis | Sim — nada para instalar | Não — incluídos no aplicativo |

## O que as diferenças somam

O Audacity 4 é um editor de passagem única. Ele não tem barramentos, envios,
faixas de automação nem macros na compilação fixada. O Soundscaper mantém esse
modelo de edição e acrescenta a camada de mixagem, automação e entrega, além de
gravação, vídeo e intercâmbio que o Audacity não tenta oferecer.

O Audition ainda lidera em profundidade de restauração, em intercâmbios com o
Premiere Pro e em ambisonics. O Soundscaper lidera na entrega imersiva, no manejo
de projetos e no fato de rodar em um navegador em hardware que nenhum dos outros
suporta.

Se você já trabalha no Audacity, consulte
[arquivos de projeto e intercâmbio com o Audacity](/projects-and-data/project-files/) para
saber como mover um projeto.
