---
title: "Editar, misturar e exportar"
description: "Organize clipes, equilibre faixas, aplique efeitos e crie um ficheiro de entrega."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","targetLocale":"pt-PT"} -->

## Organizar clipes

Selecione clipes ou um intervalo de tempo antes de escolher um comando de edição. Dividir cria um limite de edição no ponto de reprodução. As variantes preservadoras de lacunas e de ondulação determinam se o material posterior permanece no local ou se move para fechar a região removida.

Utilize pastas de faixas, grupos de clipes e o Bin do Projeto para manter projetos maiores organizados.

### Ajustar desvanecimentos de clipe {#clip-fades}

Selecione um clipe de áudio para revelar pequenos controlos triangulares ao longo do topo da sua forma de onda, diretamente abaixo do cabeçalho do clipe.
Arraste o triângulo esquerdo para dentro para um desvanecimento, ou o triângulo direito para dentro para um desvanecimento. A forma de onda altera-se à medida que arrasta, e a área acima da curva de desvanecimento torna-se mais escura. Os triângulos seguem os limites de desvanecimento; arrastar um deles de volta ao seu canto remove esse desvanecimento. Apenas o clipe que arrasta é alterado, mesmo quando vários clipes estão selecionados.

Os controlos desaparecem quando desmarca o clipe, mas a forma de onda desvanecida e o sombreamento permanecem. Estes desvanecimentos preservam o áudio original e permanecem ajustáveis após a gravação e a reabertura do projeto. Libere para confirmar um desvanecimento, ou pressione **Escape** enquanto arrasta para cancelar. **Desfazer** reverte um arrastar completo.
A reprodução e a exportação utilizam as definições de desvanecimento confirmadas.
Com um clipe selecionado focado, pressione **Tab** para aceder aos seus controlos de desvanecimento. As teclas de seta ajustam a duração em 10 milissegundos, ou 100 milissegundos com **Shift**. **Home** remove o desvanecimento; **End** estende-o por todo o clipe.
Para introdução numérica, escolha **Editar → Clipes de áudio → Propriedades do clipe** e utilize **Desvanecimento**.

## Construir a mistura

Utilize os controlos de ganho, panorâmica, silenciar e solo da faixa para equilibrar o projeto. O painel Misturador expõe o mesmo estado do projeto num layout orientado para a mistura. Os efeitos em tempo real permanecem ajustáveis; as operações destrutivas ou renderizadas criam alterações no projeto que podem ser desfeitas enquanto o histórico estiver disponível.

Utilize o medidor de reprodução e a análise de volume para inspecionar o resultado. Evite tratar um alvo de medidor como um substituto para a audição da exportação completa.

### Reduzir a sibilância {#reduce-sibilance}

Escolha **Efeito → Remoção e reparação de ruído → De-esser**. Defina a **Frequência** perto da parte áspera da voz, depois reduza o **Limiar** até os sibilantes ficarem mais suaves.
**Redução máxima** limita o corte; comece em torno de 6–9 dB. Um **Ataque** mais curto apanha o início de uma consoante, enquanto o **Libertar** controla a rapidez com que as frequências altas recuperam. Apenas a banda superior é reduzida.

### Comprimir bandas de frequência separadas {#multiband-compression}

Escolha **Efeito → Volume e compressão → Compressor multibanda**. As duas cruzamentos dividem o sinal em bandas baixas, médias e altas. Cada banda tem o seu próprio limiar, rácio e ganho de saída. Um rácio de 1 deixa a dinâmica dessa banda inalterada. Ataque e libertação aplicam-se às três bandas. Os cruzamentos têm encostas suaves, sobrepostas de 6 dB/octava; com todos os rácios em 1 e os ganhos de banda em 0 dB, o sinal original passa inalterado.

Ambos os efeitos ligam os seus canais para preservar o equilíbrio estéreo e também estão disponíveis em racks de efeitos de faixa e master. As definições do rack são guardadas com o projeto e podem ser ajustadas durante a reprodução. **Aplicar à seleção** renderiza o efeito no áudio selecionado e suporta **Desfazer**. A automação da linha do tempo não está disponível para estes dois efeitos.

## Exportar

Escolha **Ficheiro → Exportar áudio** para uma entrega misturada ou **Exportar áudio selecionado** quando apenas uma seleção deve ser renderizada. O Soundscaper também pode exportar caules e etiquetas.

Os formatos comprimidos utilizam o tempo de execução FFmpeg. Os formatos exatos e a disponibilidade condicional estão listados no [referência de formato gerada](/reference/).

Reproduza o ficheiro exportado noutra aplicação antes de entregar ou eliminar o material de origem.

Para trabalho de imagem — compor uma sequência, efeitos de vídeo e uma entrega MP4 ou WebM — entregue o projeto ao [Framescaper](/framescaper/) e consulte [exportar vídeo](/framescaper/video-export/).
