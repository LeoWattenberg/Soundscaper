---
title: "O seu primeiro projeto Motion"
description: "Crie uma composição, anime uma camada e exporte um projeto guardado."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"pt-PT"} -->

## Criar e adicionar uma camada {#create-and-add-a-layer}

1. Escolha **Ficheiro → Nova composição** e introduza título, dimensões,
   frequência de fotogramas e duração em fotogramas.
2. Escolha **Camada → Novo texto** ou **Camada → Nova cor sólida**. Escolha a
   composição de destino quando o projeto contiver várias composições.
3. Abra **Camada → Texto e aparência** para editar uma camada de texto existente
   ou os preenchimentos e contornos de uma forma. Os tipos de letra importados aqui ficam conservados no projeto.

Utilize **Ficheiro → Importar multimédia** para origens de imagem, vídeo ou áudio.
Uma importação que ultrapasse os limites atuais do descodificador ou da memória
é recusada com uma explicação; o ficheiro de origem original não é alterado.

## Animar e pré-visualizar {#animate-and-preview}

Abra **Camada → Propriedades e fotogramas-chave** para escolher uma propriedade
da camada e adicionar chaves em posições exatas de fotogramas. Os controlos de
curva alteram a interpolação; a edição espacial altera os caminhos de posição.
**Ver → Linha de tempo** abre controlos de temporização, ordenação,
agrupamento e área de trabalho das camadas.

Abra **Ver → Área da composição** para selecionar e mover uma camada 2D
estática. O quadrado altera a escala e o círculo roda a camada em torno da
âncora definida. Cada arrasto concluído é uma etapa de desfazer; Escape cancela
um arrasto. As transformações animadas e guiadas por expressões permanecem em
Propriedades e fotogramas-chave.

Abra **Ver → Pré-visualização da composição** para navegar ou reproduzir a composição.
A pré-visualização utiliza material multimédia de origem conservado. Ajustes de
cena não compatíveis ou inválidos produzem um erro em vez de uma imagem substituta.
Feche a pré-visualização para libertar os recursos ativos de renderização.

## Guardar uma cópia portátil {#save-a-portable-copy}

Escolha **Ficheiro → Guardar** para publicar a revisão atual e depois
**Ficheiro → Guardar cópia** para transferir um ficheiro `.mscape`. O ficheiro inclui
o projeto e o material multimédia original necessário para o reabrir. Abra-o com
**Ficheiro → Abrir** noutro dispositivo ou numa nova biblioteca do navegador.

## Renderizar {#render}

Escolha **Ficheiro → Renderizar**. Selecione uma composição, um formato de saída
e um intervalo de fotogramas. O fotograma final é excluído: os fotogramas 0 a 29
utilizam o intervalo de `0` a `30`. Uma área de trabalho fracionária seleciona os
instantes inteiros de amostragem que contém; uma área sem amostras de saída tem de
ser alterada antes da renderização.

Utilize **Sequência PNG transparente (.tar)** para alfa. Extraia o ficheiro TAR
para obter imagens PNG normais e metadados de temporização. MP4 e WebM utilizam
a cor de fundo selecionada no diálogo. A renderização fixa a revisão enviada
para que edições posteriores não alterem uma saída em curso. Fechar o diálogo
de renderização mantém a tarefa em execução. **Ficheiro → Fila de renderização**
mostra o progresso, o cancelamento, a nova tentativa da revisão enviada e as
transferências concluídas. Fechar o editor cancela as tarefas inacabadas.

Volte ao [manual do Motionscaper](/motionscaper/).
