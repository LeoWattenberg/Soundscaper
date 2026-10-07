---
title: "Como o Soundscaper se compara"
description: "Compare Soundscaper Web e Desktop com Audacity 4 e Adobe Audition para gravação, edição, mixagem, entrega e intercâmbio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"pt-BR"} -->

O Soundscaper reimplementa o Audacity 4 na web e acrescenta uma camada de produção. O Adobe Audition é a ferramenta comercial de pós-produção com a qual ambos costumam ser comparados. Esta página compara Soundscaper Web, Soundscaper Desktop, Audacity 4 e Audition para ajudar você a identificar qual edição já atende ao seu trabalho.

## Como ler esta página

Cada célula começa com um símbolo colorido, seguido dos detalhes que o qualificam:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — compatível ou aplicável
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — escopo limitado, depende da plataforma ou exige uma solução alternativa
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — indisponível ou não aplicável

Leia as observações junto com os símbolos. A instalação opcional de um plug-in, modelo ou codec não torna, por si só, limitada uma capacidade compatível no Desktop; a observação informa o que é necessário instalar. Web e Desktop têm colunas separadas, portanto uma restrição do navegador não reduz a avaliação do Desktop.

As linhas descrevem capacidades, não comandos de menu. Para o inventário exato de
comandos, consulte [Comandos e atalhos](/reference/generated/commands/), e para
saber o que cada produto habilita, consulte
[Capacidades do produto](/reference/generated/product-capabilities/).

### De onde vêm estas afirmações

- As linhas do **Soundscaper** se baseiam neste repositório: nos perfis de recursos dos produtos, no manifesto de ações do runtime, no registro de formatos de exportação e nas verificações de codecs do navegador e do desktop.
  Os payloads nativos de destino para desktop são gerados pelo CI do repositório ou pelo empacotamento do destino. Um pacote habilita um recurso somente após preparar e verificar o resultado correspondente exato; essas linhas indicam quando ainda é necessário um payload.
- As linhas do **Audacity 4** partem do inventário upstream fixado neste repositório, `4.0.0` no commit `4c177d43`, e incluem mudanças visíveis ao usuário até o lançamento oficial [`4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt), no commit `d82386ce`. Um recurso registrado no upstream, mas desativado ou comentado para fora do menu, é identificado dessa forma. Um recurso sem registro no inventário auditado nem nas notas de lançamento é descrito como ausente nesse material, e não como permanentemente ausente. O desenho de amostras, os envelopes de ganho de clipe e a importação de projetos antigos também estão documentados no [changelog oficial 4.0](https://www.audacityteam.org/changelog/) e no [manual de ganho de clipe](https://www.audacityteam.org/manual/clips/clip-gain/).
- As linhas do **Audition** vêm da documentação publicada pela Adobe para a versão
  atual. Elas não são verificadas em uma compilação em execução.

## Plataforma e termos

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licença | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, código aberto | / — proprietário e fechado |
| Custo | + — gratuito | + — gratuito | + — gratuito | / — assinatura Creative Cloud |
| Executa em um navegador | + — Chromium, Firefox e WebKit | / — aplicativo empacotado | / — somente desktop | / — somente desktop |
| Compilações para desktop | / — use a edição para navegador | + — Windows e Linux em x64 e ARM64, macOS em ARM64 | + — Windows (instalador ou portátil), macOS, Linux | ~ — Windows e macOS, sem Linux |
| Funciona sem conta | + — não existe conta | + — não existe conta | + — login somente para audio.com | / — é necessária uma assinatura com login |
| Armazenamento de projetos na nuvem | / — excluído pelo design local-first | / — excluído pelo design local-first | + — salvar e compartilhar pelo audio.com | ~ — arquivos do Creative Cloud, sessões não sincronizam |
| Requisitos do sistema | + — executa onde quer que um navegador atual execute | + — Windows, Linux ou macOS nas arquiteturas de desktop compatíveis | ~ — aumentou substancialmente em relação ao Audacity 3 | ~ — classe de estação de trabalho profissional |

## Modelo de projeto e sessão

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Formato de projeto nativo | + — `.sscape`, um arquivo portátil sem perdas | + — `.sscape`, um arquivo portátil sem perdas | + — `.aup4` | + — `.sesx` |
| Abre projetos do Audacity | + — importação de AUP, AUP3 e AUP4; exportação de AUP3 e AUP4 | + — importação de AUP, AUP3 e AUP4; exportação de AUP3 e AUP4 | + — importação de AUP, AUP3 e AUP4; exportação de AUP4, sem exportação de AUP3 | / |
| Linha do tempo de clipes não destrutiva | + | + | + | + — editor multifaixas |
| Editor dedicado de arquivo único | + — editor de forma de onda da origem nas propriedades do clipe | + — editor de forma de onda da origem nas propriedades do clipe | ~ — as edições são aplicadas no local na linha do tempo | + — editor de forma de onda |
| Conteúdo mono e estéreo em uma faixa | + — uma faixa contém um ou outro | + — uma faixa contém um ou outro | / — uma faixa é mono ou estéreo | / — o formato de canal é fixo por faixa |
| Pastas de faixas aninhadas | + — qualquer profundidade, com desfazer e roteamento | + — qualquer profundidade, com desfazer e roteamento | / | ~ — somente barramentos de submixagem, sem faixas de pasta |
| Caixa do projeto | + — organiza arquivos e também funciona como área de transferência | + — organiza arquivos e também funciona como área de transferência | / | ~ — o painel Arquivos lista os arquivos abertos |
| Salvamento automático e recuperação de falhas | + — salvamento automático, bloqueios e envelopes de recuperação | + — salvamento automático, bloqueios e envelopes de recuperação | + | + |
| Marcadores e regiões nomeadas | + — de primeira classe, com navegação e comportamento ripple | + — de primeira classe, com navegação e comportamento ripple | ~ — faixas de rótulos | + — marcadores e intervalos |
| Mapas de andamento e fórmula de compasso | + — mapas ordenados resolvidos com precisão de amostra | + — mapas ordenados resolvidos com precisão de amostra | ~ — um andamento e fórmula por projeto | ~ — um andamento por sessão |

## Gravação

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Gravação multifaixas | + — várias fontes ao mesmo tempo | + — várias fontes ao mesmo tempo | ~ — um dispositivo de entrada por vez | + — interfaces com várias entradas e multicanais |
| Áudio de microfone e desktop juntos | ~ — integrado quando o navegador e o sistema operacional disponibilizam o áudio da tela | + — microfone e captura do áudio do desktop no Windows; outros sistemas usam uma entrada de loopback | / | ~ — requer um dispositivo de loopback do sistema operacional |
| Gravação programada | + | + | + | / |
| Gravação ativada por som | + — com limite configurável | + — com limite configurável | + — com limite configurável | / |
| Contagem antes da tomada | + — ciente do mapa de andamento, lida com métrica composta | + — ciente do mapa de andamento, lida com métrica composta | ~ — gravação de introdução | ~ — pré-rolagem como parte do punch and roll |
| Gravação punch | + — uma transação, captura padrão e roteada | + — uma transação, captura padrão e roteada | / | + — punch and roll |
| Gravação em loop em tomadas | + — uma faixa por passagem, adicionada ao mesmo grupo | + — uma faixa por passagem, adicionada ao mesmo grupo | / | ~ — tomadas em um clipe, escolhidas de uma lista |
| Comping de tomadas | + — audição, promoção, edição de regiões de comp e achatamento como uma edição única com desfazer | + — audição, promoção, edição de regiões de comp e achatamento como uma edição única com desfazer | / | / — sem editor de comp |
| Monitoramento e medição de entrada | + | + | + | + |

## Edição da linha do tempo

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Variantes de edição ripple | + — por clipe, por faixa e todas as faixas, ao cortar e excluir | + — por clipe, por faixa e todas as faixas, ao cortar e excluir | + — as mesmas três, ao cortar e excluir | ~ — exclusão ripple em uma seleção ou lacuna |
| Dividir, unir e dividir nos silêncios | + | + | + | ~ — dividir e aparar, sem união de clipes |
| Grupos de clipes | + | + | + | + |
| Ganho do clipe | + | + | + | + |
| Tom e velocidade por clipe | + — ajustar, renderizar ou redefinir | + — ajustar, renderizar ou redefinir | + — ajustar, renderizar ou redefinir | ~ — o estiramento continua editável, o tom é um efeito |
| Seguir mudanças de andamento | + — os clipes se esticam quando o mapa se move | + — os clipes se esticam quando o mapa se move | + | / |
| Quantização e groove conscientes das batidas | + — mapas de warp com intensidade de groove ajustável | + — mapas de warp com intensidade de groove ajustável | / | / |
| Ajuste aos cruzamentos por zero | + | + | + | + |
| Desenho no nível de amostra | + | + | + — disponível ao ampliar até amostras individuais | + — no editor de forma de onda |
| Edição somente pelo teclado | + — cada primitiva de edição tem uma ação de navegação | + — cada primitiva de edição tem uma ação de navegação | + — ações de edição, linha do tempo e réguas verticais das faixas são navegáveis pelo teclado | ~ — atalhos extensos, alguns painéis precisam do mouse |

## Trabalho espectral e restauração

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Visualização de espectrograma | + — com configurações por faixa | + — com configurações por faixa | + — com configurações por faixa | + — exibições de frequência e tom |
| Seleção limitada por frequência | + | + | + | + — seleção retangular e laço |
| Pincel espectral | + | + | + | + — pincel de pintura e reparo pontual |
| Excluir ou amplificar uma região espectral | + — ambos como ações diretas | + — ambos como ações diretas | + — ambos como ações diretas | ~ — aplicar um efeito à seleção |
| Reparar danos curtos | + — Reparar | + — Reparar | + — Reparar | + — Auto Heal e Spot Healing Brush |
| Redução de ruído de banda larga | + — com um perfil capturado | + — com um perfil capturado | + — com um perfil capturado | + — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Remoção de reverb | / — assistência somente no Desktop | + — Reduce Reverb, com modelo e mecanismo opcionais instalados | / | + — DeReverb |
| Ferramentas para cliques, zumbido e sibilância | ~ — Click Removal e De-esser; sem ferramenta dedicada para remover zumbido | ~ — Click Removal e De-esser; sem ferramenta dedicada para remover zumbido | ~ — somente Remoção de Cliques | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Painel de diagnóstico | ~ — Encontrar Clipping como analisador | ~ — Encontrar Clipping como analisador | ~ — Encontrar Clipping como analisador | + — diagnóstico com reparo por problema |

## Efeitos e plug-ins

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Suíte de efeitos integrada | + — efeitos derivados do Audacity, plug-ins Nyquist incluídos e efeitos próprios, como Bitcrusher e De-esser | + — efeitos derivados do Audacity, plug-ins Nyquist incluídos e efeitos próprios, como Bitcrusher e De-esser | + — 30 efeitos integrados na versão fixada | + — cerca de cinquenta, incluindo dinâmica multibanda |
| Rack de efeitos em tempo real por faixa | + — um conjunto em tempo real mais amplo que o upstream | + — um conjunto em tempo real mais amplo que o upstream | + | + — dezesseis slots por clipe, faixa e master |
| EQ paramétrico | + — um novo EQ paramétrico com bandas automatizáveis | + — um novo EQ paramétrico com bandas automatizáveis | ~ — Filter Curve e Graphic EQ | + — filtros paramétricos, gráficos e FFT |
| Predefinições de efeitos | + — aplicar, salvar, importar e exportar | + — aplicar, salvar, importar e exportar | + — aplicar, salvar, importar e exportar | + |
| Macros e cadeias em lote | + — biblioteca de macros salvas com modelos | + — biblioteca de macros salvas com modelos | / — a compilação fixada comenta o menu Macros | + — Favorites e Batch Process |
| Formatos de plug-ins de terceiros | / — plug-ins nativos exigem o Desktop | + — VST3, CLAP, AU, LV2, Linux LADSPA e Vamp; varia por plataforma, com consentimento e isolamento | + — VST3, AU, LV2 e Nyquist, com gerenciador de plug-ins | ~ — VST3 e AU no macOS, sem CLAP ou LV2 |
| Scripting Nyquist | + — plug-ins incluídos e o prompt Nyquist | + — plug-ins incluídos e o prompt Nyquist | + — plug-ins incluídos e o prompt Nyquist | / |
| Pacotes de efeitos em sandbox | ~ — pacotes WebAssembly revisados, um é distribuído e os externos são isolados | ~ — pacotes WebAssembly revisados, um é distribuído e os externos são isolados | / | / |
| Instrumentos virtuais | / | / | / | / |

## Mixagem, roteamento e automação

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mixer com canais | + | + | ~ — controles de faixa e uma faixa master | + |
| Barramentos e submixagens | + — aninhados, com validação de ciclos | + — aninhados, com validação de ciclos | / | + — faixas de barramento |
| Envios | + — pré e pós-fader, múltiplas atribuições | + — pré e pós-fader, múltiplas atribuições | / | + — pré e pós-fader |
| Grupos VCA | + | + | / | / |
| Entrada sidechain | + | + | / | + — por meio de envios |
| Mixagens de cue e sala de controle | + | + | / | / |
| Compensação de atraso de plug-ins | + — reprodução, monitoramento, barramentos, sidechains, renderização e congelamento | + — reprodução, monitoramento, barramentos, sidechains, renderização e congelamento | ~ — não exposta nas fontes fixadas | + |
| Faixas de automação | + — ganho, panorama, mudo, envios, barramentos e parâmetros de plug-ins | + — ganho, panorama, mudo, envios, barramentos e parâmetros de plug-ins | ~ — envelopes de ganho do clipe; sem trilhas de automação de faixa ou efeito | + — volume, panorama e parâmetros de efeitos |
| Modos de automação | + — leitura, ajuste, toque, retenção e escrita | + — leitura, ajuste, toque, retenção e escrita | / | ~ — leitura, escrita, retenção e toque, sem ajuste |
| Formas de curva | + — linha, retenção e curva | + — linha, retenção e curva | ~ — somente envelopes de ganho do clipe | + — linear e spline |
| Congelamento de faixa | + — congelar, descongelar e confirmar sem perder o estado | + — congelar, descongelar e confirmar sem perder o estado | / | ~ — renderizar em uma nova faixa |

## Medição e análise

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Medidor de intensidade | + — no estilo EBU R 128, com histórico | + — no estilo EBU R 128, com histórico | / — um efeito de Normalização de intensidade, mas sem medidor | + — Loudness Radar conforme ITU-R BS.1770 |
| Medidor de fase e correlação | + | + | / | + — medidor de fase e análise |
| Medição de surround | + | + | / | ~ — até 5.1 |
| Gráfico de espectro | + — Plot Spectrum | + — Plot Spectrum | ~ — registrado, mas a compilação fixada o comenta fora do menu Analisar | + — Frequency Analysis |
| Clipping e RMS na forma de onda | + — configuração do projeto com ajustes de RMS por faixa | + — configuração do projeto com ajustes de RMS por faixa | + — ambos, alternados por projeto | ~ — indicadores de clipping, RMS em Amplitude Statistics |
| Contraste de inteligibilidade da fala | + — analisador de Contraste | + — analisador de Contraste | ~ — registrado, mas a compilação fixada o comenta fora do menu Analisar | / |

No Soundscaper, abra o menu **Track visualization** de uma faixa para ativar ou desativar **Half-wave** ou **Show RMS in waveform**. A visualização padrão, as frequências de crossover de 3 bandas e as configurações do espectrograma ficam em **Edit → Preferences → Track display**.

## Canais e áudio imersivo

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Canais por arquivo | + — até 32 para formatos PCM | + — até 32 para formatos PCM | ~ — faixas mono e estéreo | + — até 32 no editor de forma de onda |
| Mixagem de surround | + — beds até 7.1.4 | + — beds até 7.1.4 | / | ~ — até 5.1 |
| Áudio baseado em objetos | + — objetos ao lado dos beds | + — objetos ao lado dos beds | / | / |
| Autoria e passagem de ADM | + — BW64/ADM com verificações de conformidade | + — BW64/ADM com verificações de conformidade | / | / |
| Renderização binaural | + — um modelo binaural nomeado | + — um modelo binaural nomeado | / | ~ — binauraliser para ambisonics |
| Ambisonics | / | / | / | + — primeira ordem, com um panner VR |

## Exportação e entrega

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Saída sem perdas | + — gravação nativa em WAV, AIFF, BWF e BW64; FLAC e WavPack por codecs dedicados | + — gravação nativa em WAV, AIFF, BWF e BW64; FLAC e WavPack por codecs dedicados | + — WAV, AIFF e FLAC | + — WAV, AIFF, FLAC e mais |
| Saída com perdas | ~ — MP3, MP2, Opus e Ogg Vorbis; AAC depende do navegador | + — MP3, MP2, Opus, Ogg Vorbis e AAC por provedores de codec compatíveis, incluindo FFmpeg configurado | + — MP3, Opus e Ogg Vorbis; formatos adicionais via FFmpeg opcional | ~ — MP2, MP3 e Ogg Vorbis; outros via Adobe Media Encoder, sem destino geral do FFmpeg |
| Configurações personalizadas de codificador | ~ — controles por formato; argumentos personalizados do FFmpeg indisponíveis | ~ — controles por formato; argumentos personalizados do FFmpeg indisponíveis | + — um destino FFmpeg personalizado | + — opções por formato |
| Fila de exportação | + — pausar, cancelar, tentar novamente e reordenar | + — pausar, cancelar, tentar novamente e reordenar | / — Export Multiple é uma operação sequencial, não uma fila de tarefas | ~ — Batch Process sem controle da fila |
| Stems e alternativos em uma passada | + — enfileirados junto com a mixagem | + — enfileirados junto com a mixagem | ~ — Export Multiple grava cada faixa separadamente, mas não coloca a mixagem e as renderizações alternativas juntas na fila | ~ — uma mixagem por stem |
| Entrega região por região | + — sequências de masterização com metadados por região, lacunas e desvanecimentos | + — sequências de masterização com metadados por região, lacunas e desvanecimentos | + — Export Multiple grava cada região rotulada em um arquivo próprio | + — exportar marcadores para arquivos separados |
| Normalização de intensidade na exportação | + — parte do plano de entrega | + — parte do plano de entrega | ~ — executar o efeito primeiro | + — Match Loudness |
| Dither e mapeamento de canais | + — controles explícitos | + — controles explícitos | ~ — dither nas preferências | + — controles explícitos |
| Relatório de entrega | + — detalhado por tarefa | + — detalhado por tarefa | / | / |
| Fila de renderização sobrevive a uma reinicialização | / — a recuperação persistente da renderização exige o Desktop | + — reinicia desde o byte zero com um registro de falhas | / | / |

O Soundscaper Desktop pode usar o FFmpeg configurado para os formatos de exportação compatíveis; o editor atual não expõe argumentos arbitrários do FFmpeg nem todos os codificadores do FFmpeg. Consulte [Formatos de exportação](/reference/generated/formats/) para ver os destinos registrados. O [fluxo de exportação do Audacity](https://www.audacityteam.org/manual/getting-started/export-your-audio/) adiciona formatos por meio de uma instalação opcional do FFmpeg. O Audition oferece um conjunto fixo de gravadores de arquivo e uma [transferência para o Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Intercâmbio com outras ferramentas

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Projetos do Audacity | + — AUP, AUP3 e AUP4 na entrada; AUP3 e AUP4 na saída com relatório de compatibilidade | + — AUP, AUP3 e AUP4 na entrada; AUP3 e AUP4 na saída com relatório de compatibilidade | + — importação de AUP, AUP3 e AUP4; exportação de AUP4, sem exportação de AUP3 | / |
| Sessões do Audition | / — a importação de SESX exige o Desktop | ~ — importação de áudio de `.sesx` com relatório de itens omitidos; sem exportação | / — sem importação de SESX na versão fixada | + — nativo |
| EDL | ~ — exportação de classe CMX3600, sem importação | ~ — exportação de classe CMX3600, sem importação | / | / |
| OpenTimelineIO | ~ — somente exportação | ~ — somente exportação | / | / |
| FCPXML | ~ — somente exportação | ~ — somente exportação | / | + — importação e exportação |
| DAWproject | + — importação e exportação, com um relatório de intercâmbio | + — importação e exportação, com um relatório de intercâmbio | / | / |
| OMF | / | / | / | ~ — importação e exportação |
| Ida e volta com um editor de vídeo | ~ — entrega o mesmo projeto ao Framescaper sem copiar a mídia | ~ — entrega o mesmo projeto ao Framescaper sem copiar a mídia | / | + — Dynamic Link com o Premiere Pro |
| Intercâmbio de rótulos e marcadores | + — importação e exportação | + — importação e exportação | + — importação e exportação | + — listas de marcadores |

Para importar no Soundscaper um arquivo `.sesx` originado no Audition, consulte [Arquivos de projeto](/projects-and-data/project-files/) para saber quais configurações de áudio são transferidas e o que o relatório marca como omitido.

## Vídeo

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Importar vídeo para referência | + — na linha do tempo, com áudio vinculado | + — na linha do tempo, com áudio vinculado | / | ~ — uma faixa de vídeo, somente pré-visualização |
| Edição da linha do tempo de vídeo | ~ — edição básica; a superfície completa é o Framescaper | ~ — edição básica; a superfície completa é o Framescaper | / | / |
| Exportação de vídeo | ~ — MP4 e WebM quando o WebCodecs do navegador oferece suporte aos codecs necessários | + — MP4 e WebM com um provedor de codec verificado no Desktop | / | / — somente áudio |
| Composição, correção de cor e efeitos | ~ — no Framescaper, no mesmo projeto | ~ — no Framescaper, no mesmo projeto | / | / |

## Assistência por máquina

A assistência no Desktop é compatível após a instalação de pesos de modelo opcionais e de um mecanismo nativo correspondente; esses fluxos de trabalho não estão disponíveis no Web. O Model Manager instala ambos. Consulte [Assistência local](/reference/generated/local-assistance/) para ver os fluxos de trabalho e modelos disponíveis.

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Aprimoramento de fala | / — assistência somente no Desktop | + — com modelo e mecanismo opcionais instalados | / | + — Enhance Speech |
| Transcrição e diarização | / — assistência somente no Desktop | + — com modelos e mecanismos opcionais instalados | / | / — as transcrições ficam no Premiere Pro |
| Separação de fontes em stems | / — assistência somente no Desktop | + — com modelo e mecanismo opcionais instalados | / | / |
| Ducking automático | + — efeito Auto Duck | + — efeito Auto Duck | + — efeito Auto Duck | + — ducking do Essential Sound |
| Detecção de batidas e planos | / — a detecção de batidas exige o Desktop; a detecção de planos fica no Framescaper | ~ — detecção de batidas com modelo opcional; detecção de planos no Framescaper | / | ~ — Remix altera automaticamente o tempo da música |
| Executa inteiramente na sua máquina | + — processamento local no navegador; sem inferência de modelo | + — processamento local e inferência offline após instalar o modelo | + — sem inferência | ~ — alguns recursos processam na nuvem da Adobe |
| Modelos são opcionais e removíveis | / — sem instalação de modelo no Web | + — baixados separadamente, fixados por digest e removíveis | + — nada para instalar | / — incluídos no aplicativo |

## O que as diferenças somam

O Audacity 4 é um editor de passagem única. Na versão fixada, não há buses, envios, trilhas de automação de faixa ou efeito nem macros. Seus envelopes de ganho de clipe permitem automatizar o volume dentro de um clipe. O Soundscaper mantém esse modelo de edição e acrescenta automação de faixa e efeitos, mixagem e entrega, além de gravação, vídeo e intercâmbio que o Audacity não oferece.

O Audition ainda lidera em profundidade de restauração, em intercâmbios com o
Premiere Pro e em ambisonics. O Soundscaper lidera na entrega imersiva, no manejo
de projetos e no fato de rodar em um navegador em hardware que nenhum dos outros
suporta.

Se você já trabalha no Audacity, consulte
[arquivos de projeto e intercâmbio com o Audacity](/projects-and-data/project-files/) para
saber como mover um projeto.
