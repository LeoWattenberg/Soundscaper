---
title: "Editar, mixar e exportar"
description: "Organize clipes, equilibre faixas, aplique efeitos e crie um arquivo de entrega."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"pt-BR"} -->

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

## Montar a mixagem

Use os controles de ganho, panorama, mudo e solo das faixas para equilibrar o projeto. O painel
Mixer
expõe o mesmo estado do projeto em um layout voltado para mixagem. Os efeitos em tempo real continuam
ajustáveis; operações destrutivas ou renderizadas criam alterações no projeto que podem ser desfeitas
enquanto o histórico estiver disponível.

Use o medidor de reprodução e a análise de intensidade para inspecionar o resultado. Evite tratar uma meta
do medidor
como substituta de ouvir a exportação completa.

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

Os formatos compactados usam o runtime FFmpeg. Os formatos exatos e a disponibilidade condicional estão listados
na [referência de formatos gerada](/reference/).

Reproduza o arquivo exportado em outro aplicativo antes de entregá-lo ou excluir o material de origem.

Para trabalhos com imagem — composição de uma sequência, efeitos de vídeo e uma entrega em MP4 ou WebM —
encaminhe o projeto ao [Framescaper](/framescaper/) e consulte
[exportar vídeo](/framescaper/video-export/).
