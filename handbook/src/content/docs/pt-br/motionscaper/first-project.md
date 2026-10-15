---
title: "Seu primeiro projeto Motion"
description: "Crie uma composição, anime uma camada e exporte um projeto salvo."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"pt-BR"} -->

## Criar e adicionar uma camada {#create-and-add-a-layer}

1. Escolha **Arquivo → Nova composição** e digite título, dimensões,
   taxa de quadros e duração em quadros.
2. Escolha **Camada → Novo texto** ou **Camada → Nova cor sólida**. Escolha a
   composição de destino quando o projeto contiver várias composições.
3. Abra **Camada → Texto e aparência** para editar uma camada de texto existente
   ou os preenchimentos e contornos de uma forma. As fontes importadas aqui ficam retidas no projeto.

Use **Arquivo → Importar mídia** para origens de imagem, vídeo ou áudio. Uma
importação que ultrapasse os limites atuais do decodificador ou da memória
é recusada com uma explicação; o arquivo de origem original não é alterado.

## Animar e visualizar {#animate-and-preview}

Abra **Camada → Propriedades e quadros-chave** para escolher uma propriedade
da camada e adicionar chaves em posições exatas de quadros. Os controles de
curva alteram a interpolação; a edição espacial altera os caminhos de posição.
**Exibir → Linha do tempo** abre controles de temporização, ordenação,
agrupamento e área de trabalho das camadas.

Abra **Exibir → Tela da composição** para selecionar e mover uma camada 2D
estática. O quadrado altera a escala e o círculo gira a camada em torno da
âncora definida. Cada arraste concluído é uma etapa de desfazer; Escape cancela
um arraste. Transformações animadas e guiadas por expressões permanecem em
Propriedades e quadros-chave.

Abra **Exibir → Prévia da composição** para navegar ou reproduzir a composição.
A prévia usa mídia de origem retida. Ajustes de cena não compatíveis ou inválidos
produzem um erro em vez de uma imagem substituta. Feche a prévia para liberar
seus recursos ativos de renderização.

## Salvar uma cópia portátil {#save-a-portable-copy}

Escolha **Arquivo → Salvar** para publicar a revisão atual e depois
**Arquivo → Salvar cópia** para baixar um arquivo `.mscape`. O arquivo inclui
o projeto e a mídia original necessária para reabri-lo. Abra-o com
**Arquivo → Abrir** em outro dispositivo ou em uma nova biblioteca do navegador.

## Renderizar {#render}

Escolha **Arquivo → Renderizar**. Selecione uma composição, um formato de saída
e um intervalo de quadros. O quadro final é excluído: os quadros 0 a 29 usam
o intervalo de `0` a `30`. Uma área de trabalho fracionária seleciona os instantes
inteiros de amostragem que contém; uma área sem amostras de saída precisa ser
alterada antes da renderização.

Use **Sequência PNG transparente (.tar)** para alfa. Extraia o arquivo TAR para
obter imagens PNG normais e metadados de temporização. MP4 e WebM usam a cor de
fundo selecionada no diálogo. A renderização fixa a revisão enviada para que
edições posteriores não alterem uma saída já em andamento. Fechar o diálogo
de renderização mantém a tarefa em execução. **Arquivo → Fila de renderização**
mostra progresso, cancelamento, nova tentativa da revisão enviada e downloads
concluídos. Fechar o editor cancela as tarefas inacabadas.

Volte ao [manual do Motionscaper](/motionscaper/).
