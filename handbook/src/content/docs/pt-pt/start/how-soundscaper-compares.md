---
title: "Comparação do Soundscaper"
description: "Compare o Soundscaper Web e Desktop com o Audacity 4 e o Adobe Audition em gravação, edição, mistura, entrega e intercâmbio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"pt-PT"} -->

O Soundscaper reimplementa o Audacity 4 para a Web e acrescenta-lhe uma camada de produção. O Adobe Audition é a ferramenta comercial de pós-produção com a qual ambos são habitualmente comparados. Esta página compara o Soundscaper Web, o Soundscaper Desktop, o Audacity 4 e o Audition para ajudar a perceber qual das edições já responde às suas necessidades.

## Como ler esta página

Cada célula começa com um símbolo colorido, seguido dos pormenores que o qualificam:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — suportado ou aplicável
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — âmbito limitado, depende da plataforma ou exige uma solução alternativa
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — indisponível ou não aplicável

Leia as notas juntamente com os símbolos. A instalação opcional de um plug-in, modelo ou codec não torna, por si só, limitada uma capacidade suportada no Desktop; a nota indica o que é necessário instalar. Web e Desktop têm colunas distintas, pelo que uma limitação do navegador não reduz a avaliação do Desktop.

As linhas descrevem capacidades, não comandos de menu. Para o inventário exato de comandos, consulte [Comandos e atalhos](/reference/generated/commands/), e para o que cada produto permite, consulte
[Capacidades do produto](/reference/generated/product-capabilities/).

### De onde vêm estas afirmações

- As linhas do **Soundscaper** se baseiam neste repositório: nos perfis de recursos dos produtos, no manifesto de ações do runtime, no registo de formatos de exportação e nas verificações de codecs do navegador e do desktop.
  Os payloads nativos de destino para desktop são gerados pelo CI do repositório ou pelo empacotamento do destino. Um pacote habilita um recurso somente após preparar e verificar o resultado correspondente exato; essas linhas indicam quando ainda é necessário um payload.
- As linhas do **Audacity 4** partem do inventário upstream fixado neste repositório, `4.0.0` no commit `4c177d43`, e incluem mudanças visíveis para o utilizador até o lançamento oficial [`4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt), no commit `d82386ce`. Um recurso registado no upstream, mas desativado ou comentado para fora do menu, é identificado dessa forma. Um recurso sem registo no inventário auditado nem nas notas de lançamento é descrito como ausente nesse material, e não como permanentemente ausente. O desenho de amostras, os envelopes de ganho de clip e a importação de projetos antigos também estão documentados no [registo de alterações oficial 4.0](https://www.audacityteam.org/changelog/) e no [manual de ganho de clip](https://www.audacityteam.org/manual/clips/clip-gain/).
- As linhas do **Audition** provêm da documentação publicada pela Adobe para a versão atual. Não são verificadas contra uma compilação em execução.

## Plataforma e termos

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licença | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, código aberto | / — proprietário e fechado |
| Custo | + — gratuito | + — gratuito | + — gratuito | / — assinatura Creative Cloud |
| Funciona num navegador | + — Chromium, Firefox e WebKit | / — aplicação empacotada | / — apenas desktop | / — apenas desktop |
| Compilações para desktop | / — utilize a edição para navegador | + — Windows e Linux em x64 e ARM64, macOS em ARM64 | + — Windows (instalador ou portátil), macOS, Linux | ~ — Windows e macOS, sem Linux |
| Funciona sem conta | + — não existe conta | + — não existe conta | + — início de sessão apenas para audio.com | / — requer assinatura iniciada sessão |
| Armazenamento de projetos na cloud | / — excluído pelo design local-first | / — excluído pelo design local-first | + — guardar e partilhar através de audio.com | ~ — ficheiros Creative Cloud, as sessões não sincronizam |
| Requisitos do sistema | + — funciona onde quer que um navegador atual funcione | + — Windows, Linux ou macOS nas arquitecturas de desktop suportadas | ~ — aumentou substancialmente em relação ao Audacity 3 | ~ — classe de estação de trabalho profissional |

## Modelo de projeto e sessão

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Formato de projeto nativo | + — `.sscape`, um ficheiro portátil sem perdas | + — `.sscape`, um ficheiro portátil sem perdas | + — `.aup4` | + — `.sesx` |
| Abre projetos do Audacity | + — importação de AUP, AUP3 e AUP4; exportação de AUP3 e AUP4 | + — importação de AUP, AUP3 e AUP4; exportação de AUP3 e AUP4 | + — importação de AUP, AUP3 e AUP4; exportação de AUP4, sem exportação de AUP3 | / |
| Linha temporal de clipes não destrutiva | + | + | + | + — editor multicanal |
| Editor de ficheiro único dedicado | + — editor de forma de onda da origem nas propriedades do clip | + — editor de forma de onda da origem nas propriedades do clip | ~ — as edições são aplicadas no local na linha temporal | + — editor de forma de onda |
| Conteúdo mono e estéreo num único canal | + — um canal contém um ou outro | + — um canal contém um ou outro | / — um canal é mono ou estéreo | / — o formato de canal é fixo por canal |
| Pastas de canais aninhadas | + — qualquer profundidade, com desfazer e roteamento | + — qualquer profundidade, com desfazer e roteamento | / | ~ — apenas barramentos de submixagem, sem canais de pasta |
| Caixa de projeto | + — organiza ficheiros e funciona como área de transferência | + — organiza ficheiros e funciona como área de transferência | / | ~ — o painel Ficheiros lista os ficheiros abertos |
| Gravação automática e recuperação de falhas | + — gravação automática, bloqueios e envelopes de recuperação | + — gravação automática, bloqueios e envelopes de recuperação | + | + |
| Marcadores e regiões nomeadas | + — de primeira classe, com navegação e comportamento de ondulação | + — de primeira classe, com navegação e comportamento de ondulação | ~ — canais de etiquetas | + — marcadores e intervalos |
| Mapas de andamento e assinatura de compasso | + — mapas ordenados resolvidos com precisão de amostra | + — mapas ordenados resolvidos com precisão de amostra | ~ — um andamento e assinatura por projeto | ~ — um andamento por sessão |

## Gravação

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Gravação multicanal | + — várias fontes ao mesmo tempo | + — várias fontes ao mesmo tempo | ~ — um dispositivo de entrada de cada vez | + — interfaces multi-entrada e multicanal |
| Áudio de microfone e de desktop em conjunto | ~ — integrado quando o navegador e o sistema operativo disponibilizam o áudio do ecrã | + — microfone e captura do áudio do desktop no Windows; outros sistemas usam uma entrada de loopback | / | ~ — requer um dispositivo de loopback do sistema operativo |
| Gravação temporizada | + | + | + | / |
| Gravação ativada por som | + — com limiar ajustável | + — com limiar ajustável | + — com limiar ajustável | / |
| Contagem antes da gravação | + — consciente do mapa de andamento, lida com compasso composto | + — consciente do mapa de andamento, lida com compasso composto | ~ — gravação de introdução | ~ — pré-rolagem como parte da gravação por impacto |
| Gravação por impacto | + — uma transação, captura predefinida e roteada | + — uma transação, captura predefinida e roteada | / | + — gravação por impacto e rolagem |
| Gravação em loop para gravações | + — uma faixa por passagem, acrescentada ao mesmo grupo | + — uma faixa por passagem, acrescentada ao mesmo grupo | / | ~ — gravações num único clipe, escolhidas de uma lista |
| Comping de gravações | + — audição, promoção, edição de regiões de comping, aplanamento como uma única edição com desfazer | + — audição, promoção, edição de regiões de comping, aplanamento como uma única edição com desfazer | / | / — sem editor de comping |
| Monitorização e medição de entrada | + | + | + | + |

## Edição da linha temporal

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Variantes de edição ripple | + — por clipe, por faixa e todas as faixas, em corte e eliminação | + — por clipe, por faixa e todas as faixas, em corte e eliminação | + — as mesmas três, em corte e eliminação | ~ — eliminação ripple numa seleção ou intervalo |
| Dividir, juntar e dividir em silêncios | + | + | + | ~ — dividir e aparar, sem junção de clipes |
| Grupos de clipes | + | + | + | + |
| Ganho de clipe | + | + | + | + |
| Afinação e velocidade por clipe | + — ajustar, renderizar ou repor | + — ajustar, renderizar ou repor | + — ajustar, renderizar ou repor | ~ — o alongamento mantém-se editável, a afinação é um efeito |
| Seguir alterações de andamento | + — os clipes alongam-se quando o mapa se move | + — os clipes alongam-se quando o mapa se move | + | / |
| Quantização e groove conscientes do ritmo | + — mapas de warp com intensidade de groove ajustável | + — mapas de warp com intensidade de groove ajustável | / | / |
| Ajuste a zeros cruzados | + | + | + | + |
| Desenho a nível de amostra | + | + | + — disponível ao ampliar até amostras individuais | + — no editor de forma de onda |
| Edição apenas por teclado | + — cada primitiva de edição tem uma ação de navegação | + — cada primitiva de edição tem uma ação de navegação | + — ações de edição, linha temporal e réguas verticais das faixas são navegáveis pelo teclado | ~ — atalhos extensos, alguns painéis precisam do rato |

## Trabalho espectral e restauro

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Vista de espectrograma | + — com definições por faixa | + — com definições por faixa | + — com definições por faixa | + — visualizações de frequência e afinação |
| Seleção limitada por frequência | + | + | + | + — retângulo e laço |
| Pincel espectral | + | + | + | + — pincel e reparação pontual |
| Eliminar ou amplificar uma região espectral | + — ambos como ações diretas | + — ambos como ações diretas | + — ambos como ações diretas | ~ — aplicar um efeito à seleção |
| Reparar danos curtos | + — Reparação | + — Reparação | + — Reparação | + — Reparação Automática e Pincel de Reparação Pontual |
| Redução de ruído de banda larga | + — com um perfil capturado | + — com um perfil capturado | + — com um perfil capturado | + — Redução de Ruído, Redução Adaptativa de Ruído, DeNoise |
| Desreverberação | / — assistência somente no Desktop | + — Reduce Reverb, com modelo e motor opcionais instalados | / | + — DeReverb |
| Ferramentas de cliques, zumbidos e sibilância | ~ — Click Removal e De-esser; sem ferramenta dedicada para remover zumbido | ~ — Click Removal e De-esser; sem ferramenta dedicada para remover zumbido | ~ — apenas Remoção de Cliques | + — DeClicker, DeHummer, DeEsser, Eliminador de Cliques/Pop |
| Painel de diagnósticos | ~ — Detetar Clipping como analisador | ~ — Detetar Clipping como analisador | ~ — Detetar Clipping como analisador | + — diagnósticos com reparação por problema |

## Efeitos e extensões

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Suite de efeitos integrada | + — efeitos derivados do Audacity, plug-ins Nyquist incluídos e efeitos próprios, como Bitcrusher e De-esser | + — efeitos derivados do Audacity, plug-ins Nyquist incluídos e efeitos próprios, como Bitcrusher e De-esser | + — 30 efeitos integrados na versão fixada | + — cerca de cinquenta, incluindo dinâmica multibanda |
| Rack de efeitos em tempo real por faixa | + — um conjunto em tempo real mais amplo do que a montante | + — um conjunto em tempo real mais amplo do que a montante | + | + — dezasseis slots por clipe, faixa e master |
| EQ paramétrico | + — um novo EQ paramétrico com bandas automatizáveis | + — um novo EQ paramétrico com bandas automatizáveis | ~ — Filter Curve e Graphic EQ | + — filtros paramétricos, gráficos e FFT |
| Predefinições de efeitos | + — aplicar, guardar, importar, exportar | + — aplicar, guardar, importar, exportar | + — aplicar, guardar, importar, exportar | + |
| Macros e cadeias em lote | + — biblioteca de macros guardada com modelos | + — biblioteca de macros guardada com modelos | / — a compilação fixada comenta o menu Macros | + — Favoritos e Batch Process |
| Formatos de plug-ins de terceiros | / — plug-ins nativos exigem o Desktop | + — VST3, CLAP, AU, LV2, Linux LADSPA e Vamp; varia por plataforma, com consentimento e isolamento | + — VST3, AU, LV2 e Nyquist, com um gestor de plug-ins | ~ — VST3 e AU no macOS, sem CLAP ou LV2 |
| Scripting Nyquist | + — plug-ins incluídos e o prompt Nyquist | + — plug-ins incluídos e o prompt Nyquist | + — plug-ins incluídos e o prompt Nyquist | / |
| Pacotes de efeitos em sandbox | ~ — pacotes WebAssembly revistos, um é incluído e os externos estão isolados | ~ — pacotes WebAssembly revistos, um é incluído e os externos estão isolados | / | / |
| Instrumentos virtuais | / | / | / | / |

## Mistura, roteamento e automação

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Misturador com faixas de canais | + | + | ~ — controlos de faixa e uma faixa master | + |
| Barras e submisturas | + — aninhadas, com validação de ciclo | + — aninhadas, com validação de ciclo | / | + — faixas de barra |
| Enviações (Sends) | + — pré e pós-fader, múltiplas atribuições | + — pré e pós-fader, múltiplas atribuições | / | + — pré e pós-fader |
| Grupos VCA | + | + | / | / |
| Entrada de sidechain | + | + | / | + — através de enviações |
| Misturas de cue e sala de controlo | + | + | / | / |
| Compensação de atraso de plug-ins | + — reprodução, monitorização, barras, sidechains, renderização e congelação | + — reprodução, monitorização, barras, sidechains, renderização e congelação | ~ — não exposto nas fontes fixadas | + |
| Faixas de automação | + — ganho, panorâmica, mudo, enviações, barras e parâmetros de plug-ins | + — ganho, panorâmica, mudo, enviações, barras e parâmetros de plug-ins | ~ — envelopes de ganho do clip; sem trilhas de automação de faixa ou efeito | + — volume, panorâmica e parâmetros de efeitos |
| Modos de automação | + — leitura, ajuste, toque, retenção e escrita | + — leitura, ajuste, toque, retenção e escrita | / | ~ — leitura, escrita, retenção e toque, sem ajuste |
| Formas de curva | + — linha, retenção e curva | + — linha, retenção e curva | ~ — somente envelopes de ganho do clip | + — linear e spline |
| Congelação de faixa | + — congelar, descongelar e confirmar sem perder o estado | + — congelar, descongelar e confirmar sem perder o estado | / | ~ — bounce para uma nova faixa |

## Medição e análise

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Medidor de sonoridade | + — estilo EBU R 128, com histórico | + — estilo EBU R 128, com histórico | / — um efeito de Normalização de Sonoridade, mas sem medidor | + — Loudness Radar em conformidade com ITU-R BS.1770 |
| Medidor de fase e correlação | + | + | / | + — medidor de fase e análise |
| Medição de surround | + | + | / | ~ — até 5.1 |
| Gráfico de espetro | + — Plot Spectrum | + — Plot Spectrum | ~ — registado, mas a compilação fixada comenta-o fora do menu Analisar | + — Frequency Analysis |
| Clipping e RMS na forma de onda | + — configuração do projeto com ajustes de RMS por faixa | + — configuração do projeto com ajustes de RMS por faixa | + — ambos, alternados por projeto | ~ — indicadores de clipping, RMS em Amplitude Statistics |
| Contraste de inteligibilidade da fala | + — analisador de contraste | + — analisador de contraste | ~ — registado, mas a compilação fixada comenta-o fora do menu Analisar | / |

No Soundscaper, abra o menu **Track visualization** de uma faixa para ativar ou desativar **Half-wave** ou **Show RMS in waveform**. A visualização padrão, as frequências de crossover de 3 bandas e as configurações do espectrograma ficam em **Edit → Preferences → Track display**.

## Canais e áudio imersivo

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Canais por ficheiro | + — até 32 para formatos PCM | + — até 32 para formatos PCM | ~ — faixas mono e estéreo | + — até 32 no editor de forma de onda |
| Mistura surround | + — leitos até 7.1.4 | + — leitos até 7.1.4 | / | ~ — até 5.1 |
| Áudio baseado em objetos | + — objetos junto com leitos | + — objetos junto com leitos | / | / |
| Criação e passagem de ADM | + — BW64/ADM com verificações de conformidade | + — BW64/ADM com verificações de conformidade | / | / |
| Renderização binaural | + — um modelo binaural nomeado | + — um modelo binaural nomeado | / | ~ — binauralizador para ambisonics |
| Ambisonics | / | / | / | + — primeira ordem, com um panner VR |

## Exportação e entrega

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Saída sem perdas | + — gravação nativa em WAV, AIFF, BWF e BW64; FLAC e WavPack por codecs dedicados | + — gravação nativa em WAV, AIFF, BWF e BW64; FLAC e WavPack por codecs dedicados | + — WAV, AIFF e FLAC | + — WAV, AIFF, FLAC e mais |
| Saída com perdas | ~ — MP3, MP2, Opus e Ogg Vorbis; AAC depende do navegador | + — MP3, MP2, Opus, Ogg Vorbis e AAC por fornecedores de codecs suportados, incluindo FFmpeg configurado | + — MP3, Opus e Ogg Vorbis; formatos adicionais via FFmpeg opcional | ~ — MP2, MP3 e Ogg Vorbis; outros via Adobe Media Encoder, sem destino geral do FFmpeg |
| Definições personalizadas de codificador | ~ — controles por formato; argumentos personalizados do FFmpeg indisponíveis | ~ — controles por formato; argumentos personalizados do FFmpeg indisponíveis | + — um destino FFmpeg personalizado | + — opções por formato |
| Fila de exportação | + — pausar, cancelar, repetir e reordenar | + — pausar, cancelar, repetir e reordenar | / — Export Multiple é uma operação sequencial, não uma fila de tarefas | ~ — Batch Process sem controlo de fila |
| Stems e alternativos numa única passagem | + — enfileirados juntos com a mistura | + — enfileirados juntos com a mistura | ~ — Export Multiple grava cada faixa separadamente, mas não coloca a mistura e as renderizações alternativas juntas na fila | ~ — um mixdown por stem |
| Entrega por região | + — sequências de masterização com metadados por região, lacunas e fades | + — sequências de masterização com metadados por região, lacunas e fades | + — Export Multiple grava cada região rotulada em um ficheiro próprio | + — exportar marcadores para ficheiros separados |
| Normalização de sonoridade na exportação | + — parte do plano de entrega | + — parte do plano de entrega | ~ — executar o efeito primeiro | + — Match Loudness |
| Dither e mapeamento de canais | + — controlos explícitos | + — controlos explícitos | ~ — dither nas preferências | + — controlos explícitos |
| Relatório de entrega | + — detalhado por trabalho | + — detalhado por trabalho | / | / |
| A fila de renderização sobrevive a uma reinicialização | / — a recuperação persistente da renderização exige o Desktop | + — reinicia desde o byte zero com um registo de falhas | / | / |

O Soundscaper Desktop pode usar o FFmpeg configurado para os formatos de exportação suportados; o editor atual não expõe argumentos arbitrários do FFmpeg nem todos os codificadores do FFmpeg. Consulte [Formatos de exportação](/reference/generated/formats/) para ver os destinos registados. O [fluxo de exportação do Audacity](https://www.audacityteam.org/manual/getting-started/export-your-audio/) adiciona formatos por meio de uma instalação opcional do FFmpeg. O Audition oferece um conjunto fixo de gravadores de ficheiro e uma [transferência para o Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Intercâmbio com outras ferramentas

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Projetos Audacity | + — AUP, AUP3 e AUP4 na entrada; AUP3 e AUP4 na saída com relatório de compatibilidade | + — AUP, AUP3 e AUP4 na entrada; AUP3 e AUP4 na saída com relatório de compatibilidade | + — importação de AUP, AUP3 e AUP4; exportação de AUP4, sem exportação de AUP3 | / |
| Sessões do Audition | / — a importação de SESX exige o Desktop | ~ — importação de áudio de `.sesx` com relatório de elementos omitidos; sem exportação | / — sem importação de SESX na versão fixada | + — nativo |
| EDL | ~ — exportação de classe CMX3600, sem importação | ~ — exportação de classe CMX3600, sem importação | / | / |
| OpenTimelineIO | ~ — apenas exportação | ~ — apenas exportação | / | / |
| FCPXML | ~ — apenas exportação | ~ — apenas exportação | / | + — importação e exportação |
| DAWproject | + — importação e exportação, com um relatório de intercâmbio | + — importação e exportação, com um relatório de intercâmbio | / | / |
| OMF | / | / | / | ~ — importação e exportação |
| Ida e volta com um editor de vídeo | ~ — entrega o mesmo projeto ao Framescaper sem copiar os meios | ~ — entrega o mesmo projeto ao Framescaper sem copiar os meios | / | + — Dynamic Link com o Premiere Pro |
| Intercâmbio de etiquetas e marcadores | + — importação e exportação | + — importação e exportação | + — importação e exportação | + — listas de marcadores |

Para importar no Soundscaper um ficheiro `.sesx` criado no Audition, consulte [Ficheiros de projeto](/projects-and-data/project-files/) para saber quais as definições de áudio transferidas e o que o relatório assinala como omitido.

## Vídeo

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Importação de vídeo para referência | + — na linha temporal, com áudio vinculado | + — na linha temporal, com áudio vinculado | / | ~ — uma faixa de vídeo, apenas pré-visualização |
| Edição de linha temporal de vídeo | ~ — edição básica, a superfície completa é o Framescaper | ~ — edição básica, a superfície completa é o Framescaper | / | / |
| Exportação de vídeo | ~ — MP4 e WebM quando o WebCodecs do navegador oferece suporte aos codecs necessários | + — MP4 e WebM com um fornecedor de codecs verificado no Desktop | / | / — apenas áudio |
| Composição, correção de cor e efeitos | ~ — no Framescaper, no mesmo projeto | ~ — no Framescaper, no mesmo projeto | / | / |

## Assistência por máquina

A assistência no Desktop é suportado após a instalação de pesos de modelo opcionais e de um mecanismo nativo correspondente; esses fluxos de trabalho não estão disponíveis na Web. O Model Manager instala ambos. Consulte [Assistência local](/reference/generated/local-assistance/) para ver os fluxos de trabalho e modelos disponíveis.

| Capacidade | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Melhoria da fala | / — assistência somente no Desktop | + — com modelo e motor opcionais instalados | / | + — Enhance Speech |
| Transcrição e diarização | / — assistência somente no Desktop | + — com modelos e motores opcionais instalados | / | / — as transcrições estão no Premiere Pro |
| Separação de fonte em stems | / — assistência somente no Desktop | + — com modelo e motor opcionais instalados | / | / |
| Atenuação automática | + — efeito Auto Duck | + — efeito Auto Duck | + — efeito Auto Duck | + — atenuação do Essential Sound |
| Detecção de batida e de plano | / — a deteção de batidas exige o Desktop; a deteção de planos fica no Framescaper | ~ — deteção de batidas com modelo opcional; deteção de planos no Framescaper | / | ~ — o Remix retemporiza a música automaticamente |
| Executa inteiramente na sua máquina | + — processamento local no navegador; sem inferência de modelo | + — processamento local e inferência offline após instalar o modelo | + — sem inferência | ~ — algumas funcionalidades processam na nuvem da Adobe |
| Os modelos são opcionais e removíveis | / — sem instalação de modelo na Web | + — descarregados separadamente, fixados por resumo, elimináveis | + — nada a instalar | / — incluídos com a aplicação |

## O que as diferenças representam

O Audacity 4 é um editor de passagem única. Na versão fixada, não há barramentos, envios, trilhas de automação de faixa ou efeito nem macros. Seus envelopes de ganho de clip permitem automatizar o volume dentro de um clip. O Soundscaper mantém esse modelo de edição e acrescenta automação de faixa e efeitos, mistura e entrega, além de gravação, vídeo e intercâmbio que o Audacity não oferece.

O Audition ainda lidera em profundidade de restauro, em idas e voltas com o Premiere Pro e em ambisonics. Onde o Soundscaper lidera é na entrega imersiva, no tratamento de projetos e no facto de funcionar num navegador em hardware que nenhum dos outros suporta.

Se já trabalha no Audacity, veja
[arquivos de projeto e intercâmbio com o Audacity](/projects-and-data/project-files/) para
saber como mover um projeto.
