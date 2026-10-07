---
title: "Editar, mixar e exportar"
description: "Organize clipes, equilibre faixas, aplique efeitos e crie um arquivo de entrega."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"pt-BR"} -->

## Organizar clipes

Selecione clipes ou um intervalo de tempo antes de escolher um comando de edição. Dividir cria um
limite de edição na posição de reprodução. As variantes que preservam lacunas e as variantes
ripple
determinam se o material posterior permanece no lugar ou se move para fechar a região removida.

Use pastas de faixas, grupos de clipes e a Caixa do projeto para manter projetos
maiores organizados.

### Ajustar desvanecimentos de clipes {#clip-fades}

Selecione um clipe de áudio para revelar pequenas alças triangulares ao longo do topo da forma de onda,
logo abaixo do cabeçalho do clipe.
Arraste o triângulo esquerdo para dentro para criar um desvanecimento de entrada, ou o triângulo direito para dentro
para
criar um desvanecimento de saída. A forma de onda muda enquanto você arrasta, e a área acima da curva de
desvanecimento fica mais escura. Os triângulos acompanham os limites do desvanecimento; arrastar um deles
de volta ao canto remove esse desvanecimento. Somente o clipe que você arrasta é alterado, mesmo quando
vários clipes estão selecionados.

As alças desaparecem quando você desmarca o clipe, mas a forma de onda desvanecida e o sombreamento
permanecem.
Esses desvanecimentos preservam o áudio original e continuam ajustáveis depois que você salva e reabre o projeto.
Solte para confirmar um desvanecimento ou pressione **Escape** enquanto arrasta para cancelar. **Desfazer** reverte
um arrasto completo. A reprodução e a exportação usam as configurações de desvanecimento confirmadas.

Com um clipe selecionado e em foco, pressione **Tab** para alcançar suas alças de desvanecimento. As teclas
de seta
ajustam a duração em 10 milissegundos, ou em 100 milissegundos com **Shift**. **Home** remove o desvanecimento;
**End** o estende por todo o clipe. Para inserir um valor numérico, escolha **Editar → Clipes de áudio → Propriedades
do clipe** e use **Desvanecimento**.

### Editar a origem de um clipe {#clip-source-properties}

Escolha **Editar → Clipes de áudio → Propriedades do clipe** para abrir o editor de origem. A gravação completa aparece atrás do clipe. Arraste as bordas para alterar o início na origem e a duração, mantendo o início do clipe na linha do tempo do projeto. O painel **Normalizar** contém o ganho do clipe e as ações de pico e loudness.

Abra **Tom e tempo** e marque **Vincular tom e tempo** para alterar velocidade e tom juntos. Uma proporção de velocidade de `1` e uma mudança de tom de `0%` mantêm o som inalterado. A proporção `2` reproduz com o dobro da velocidade e uma oitava acima; `0.5` reproduz com metade da velocidade e uma oitava abaixo. Alterar um controle vinculado atualiza o outro. Desmarcar o vínculo restaura o ajuste independente de tom e mantém a proporção de velocidade atual.

Use **Ctrl+clique** na forma de onda para adicionar um marcador de alongamento vinculado àquela amostra de origem. Arrastá-lo altera o tempo nos dois lados; a sobreposição mostra as duas velocidades de reprodução. Os controles continuam específicos de cada clipe. Selecionar o áudio de origem e aplicar um efeito atualiza todos os clipes que usam essa origem.

### Editar clipes em uma planilha {#clip-spreadsheet}

Escolha **Exibir → Painéis → Planilha de clipes** para ver todos os clipes do projeto. O painel abre abaixo da linha do tempo. Use o menu para movê-lo para outra área acoplada, deixá-lo flutuante ou fechá-lo. O tamanho e a posição são salvos com o espaço de trabalho. Cada linha mostra faixa, posição na linha do tempo, arquivo de origem, deslocamento na origem, duração, tom, velocidade, ganho, fades e opções de reprodução. Os tempos estão em segundos, o tom em semitons e a velocidade é uma proporção: `1` é a velocidade normal e `2` é o dobro.

Clique duas vezes em uma célula ou selecione-a e pressione **Enter** para editar o valor. Pressione **Enter** para aplicar ou **Escape** para cancelar. As células de faixa e origem mostram os IDs reais. Altere o ID da faixa para mover um clipe para uma faixa de áudio existente. Altere o ID da origem ou digite um caminho de arquivo local para substituir o áudio, mantendo posição na linha do tempo, duração, velocidade e deslocamento da origem em segundos. O novo arquivo precisa conter esse intervalo da origem. **Invertido** e **Invertido de ordem** são caixas de seleção; selecione uma célula e pressione **Espaço** para alterná-la. Clipes em faixas bloqueadas e clipes de vídeo são somente leitura.

Alterar a duração corta ou estende o intervalo da origem a partir do deslocamento atual. Alterar a velocidade mantém o intervalo, a menos que você também cole uma duração. Desagrupe ou desvincule os clipes antes de alterar o tempo aqui; ajuste o tempo dos clipes esticados no editor de origem.

Selecione uma célula, arraste por um intervalo ou use **Shift+clique** em outra célula para ampliar a seleção. Clique em um número de linha ou cabeçalho de coluna para selecionar toda a linha ou coluna. Use **Ctrl+C** e **Ctrl+V** (**Cmd+C** e **Cmd+V** no macOS) para trocar a seleção com uma planilha. As colunas são separadas por tabulações e as linhas por quebras de linha. Colar começa na célula selecionada e atualiza os clipes existentes. Colagens que ultrapassam as linhas existentes são recusadas. Com uma seleção, pressione **Escape** ou clique no espaço vazio abaixo da tabela para limpá-la. Sem seleção, colar insere novas linhas, inclusive em um projeto vazio. As opções de reprodução são copiadas como `true` ou `false` e aceitam esses valores ao colar. Novas linhas seguem a ordem das colunas da tabela e precisam de um nome de arquivo ou ID de origem. Um nome de faixa existente e exclusivo coloca o clipe nela; um nome novo cria uma faixa de áudio. Nomes de faixa vazios usam o nome da origem. Células numéricas vazias usam os padrões: posição e deslocamento `0`, velocidade `1`, tom e ganho `0`, sem fades. Duração vazia usa o restante do áudio na velocidade solicitada.

O painel procura primeiro a origem no projeto, inclusive na lixeira do projeto. Se ela não estiver lá, escolha **Carregar arquivos referenciados** e selecione os arquivos de áudio listados no diálogo. Caminhos de disco também exigem essa seleção: colar um caminho não concede acesso ao arquivo. Os arquivos selecionados devem corresponder sem ambiguidade aos nomes referenciados. O painel importa o áudio, valida os limites da origem e as propriedades dos clipes e posiciona os novos clipes conforme especificado. **Ctrl+Z** (**Cmd+Z** no macOS) desfaz uma colagem inteira em uma etapa; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) refaz. Se a colagem contiver um valor inválido, os clipes não mudam.

## Montar a mixagem

Use os controles de ganho, panorama, mudo e solo das faixas para equilibrar o projeto. O painel
Mixer
expõe o mesmo estado do projeto em um layout voltado para mixagem. Os efeitos em tempo real continuam
ajustáveis; operações destrutivas ou renderizadas criam alterações no projeto que podem ser desfeitas
enquanto o histórico estiver disponível.

Use o medidor de reprodução e a análise de intensidade para inspecionar o resultado. Evite tratar uma meta
do medidor
como substituta de ouvir a exportação completa.

### Ouvir frequências selecionadas {#listen-to-selected-frequencies}

Selecione o trecho que deseja ouvir. No menu da faixa, escolha **Visualização da faixa → Espectrograma** e abra **Opções do espectrograma → Selecionar intervalo de frequência espectral**. Digite as frequências mínima e máxima e escolha **Selecionar intervalo**, ou ajuste as alças no espectrograma.

Escolha **Opções de reprodução → Reproduzir frequências selecionadas** ou **Selecionar → Espectral → Reproduzir frequências selecionadas**. O intervalo de tempo selecionado toca uma vez na velocidade normal, mesmo se outra velocidade ou reprodução em loop tiver sido escolhida. O filtro de audição se aplica à mixagem atual, incluindo mudo, solo, ganho e efeitos. Um retângulo espectral identifica a banda de frequência e o intervalo de tempo, mas não coloca a faixa em solo. Se a reprodução já estiver em andamento, o comando a pausa; escolha-o novamente para iniciar a audição filtrada.

Os filtros de frequência em tempo real têm bordas suaves. Frequências fora da banda ficam mais baixas, assim como frequências próximas aos limites. **Pausar** ou **Parar** remove o filtro, então a próxima reprodução normal usa toda a faixa de frequências. O áudio, as seleções, o histórico de desfazer e os arquivos exportados não mudam.

### Reduzir sibilância {#reduce-sibilance}

Escolha **Efeito → Remoção e reparo de ruído → Redutor de sibilância**. Defina **Frequência**
perto
da parte áspera da voz, depois reduza **Limite** até as sibilantes suavizarem.
**Redução máxima** limita o corte; comece em torno de 6–9 dB. Um **Ataque** mais curto captura o início
de uma consoante, enquanto **Liberação** controla a rapidez com que as frequências altas se recuperam.
Somente a banda superior é reduzida.

### Comprimir bandas de frequência separadas {#multiband-compression}

Escolha **Efeito → Volume e compressão → Compressor multibanda**. Os dois cruzamentos dividem
o sinal em
bandas baixa, média e alta. Cada banda tem seu próprio limite, relação e ganho de saída. Uma relação de 1
deixa a dinâmica dessa banda inalterada. O ataque e a liberação se aplicam às três bandas. Os cruzamentos
têm inclinações suaves e sobrepostas de 6 dB/octave; com todas as relações em 1 e os ganhos das bandas em
0 dB, o sinal original passa sem alterações.

Ambos os efeitos vinculam seus canais para preservar o equilíbrio estéreo e também estão disponíveis nos racks
de efeitos da faixa e do master. As configurações do rack são salvas com o projeto e podem ser ajustadas durante
a reprodução. **Aplicar à seleção** renderiza o efeito no áudio selecionado e permite **Desfazer**. A automação
da linha do tempo não está disponível para esses dois efeitos.

### Usar efeitos LADSPA e analisadores Vamp {#native-audio-plugins}

O aplicativo para desktop pode procurar plug-ins de terceiros somente depois que você permitir um formato
e
uma de suas pastas em **Efeito → Gerenciador de plug-ins**. A procura nunca é automática. Permita cada
instalação encontrada antes de usá-la e instale somente plug-ins em que confia: os plug-ins nativos executam
código, embora o Soundscaper os hospede em processos auxiliares supervisionados.

Os efeitos LADSPA estão disponíveis no Linux. Abra um em **Efeito → Plug-ins de áudio** depois de ativá-lo no
gerenciador. O Soundscaper cria os controles a partir das portas LADSPA porque esse formato não tem uma interface
do fornecedor. Esses valores de controle e o estado ativado ou ignorado do efeito são salvos com o projeto.

Os plug-ins Vamp analisam o áudio em vez de alterá-lo. Depois de ativar uma instalação Vamp, selecione uma faixa
de áudio para analisá-la ou não selecione nenhuma faixa de áudio para analisar a mixagem master. Uma seleção de
tempo limita a análise; caso contrário, o Soundscaper usa o projeto completo. Escolha **Analisar → Plug-ins
Vamp**, selecione a saída do analisador e suas configurações e execute-o. O Soundscaper adiciona os carimbos de
tempo retornados como uma nova faixa de rótulos somente depois que a análise completa é bem-sucedida, para que
cancelar ou alterar o projeto não deixe rótulos parciais.

## Exportar

Escolha **Arquivo → Exportar áudio** para uma entrega mixada ou **Exportar áudio selecionado** quando
somente
uma seleção deve ser renderizada. O Soundscaper também pode exportar stems e rótulos.

### Exportar clipes como arquivos separados {#export-clips}

Escolha **Arquivo → Exportar áudio** e defina **Saída** como **Clipes individuais (dividir por clipes)**. Escolha um formato de áudio e pressione **Exportar** para baixar um arquivo compactado com um arquivo para cada clipe de áudio nas trilhas de áudio do projeto. Cada arquivo começa no início audível do clipe e termina no fim audível, sem preenchimento até a linha do tempo do projeto nem cauda de efeito adicional. Cortes, ganho do clipe, fades e alterações de velocidade e tom são incluídos. Clipes sobrepostos continuam separados.

Os arquivos usam os nomes dos clipes com prefixos numéricos. Caracteres de nome de arquivo não compatíveis são substituídos, e os números distinguem nomes repetidos. Efeitos das trilhas são incluídos; efeitos master, mudo e solo não afetam esta exportação. Descongele primeiro as trilhas congeladas para exportar separadamente os clipes editáveis.

Os formatos compactados usam o runtime FFmpeg. Os formatos exatos e a disponibilidade condicional estão listados
na [referência de formatos gerada](/reference/).

### Incorporar marcadores de capítulo {#embedded-chapters}

No editor do navegador, escolha **Arquivo → Exportar áudio**, selecione **MP3** ou **AAC / M4A** e ative **Incorporar rótulos como capítulos** em **Opções de áudio**. A opção começa desativada e inclui títulos e tempos dos rótulos em um único arquivo mixado. Adicione rótulos antes de exportar; stems, divisões por capítulo e sequências de masterização não oferecem essa opção.

Somente rótulos que cruzam o intervalo entregue são incluídos. Ao exportar uma seleção, os tempos dos capítulos são deslocados para o início do arquivo gerado. MP3 preserva os tempos finais de rótulos de região; um rótulo pontual termina no próximo capítulo ou no fim do arquivo. M4A guarda os inícios dos capítulos, e cada capítulo continua até o próximo início ou o fim do arquivo. M4A aceita até 255 capítulos e 255 bytes UTF-8 por título. A exibição dos capítulos incorporados depende do reprodutor.

Reproduza o arquivo exportado em outro aplicativo antes de entregá-lo ou excluir o material de origem.
