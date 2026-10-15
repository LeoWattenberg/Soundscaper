---
title: "Motionscaper"
description: "Crie composições animadas e mantenha projetos de animação editáveis localmente."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"pt-BR"} -->

Motionscaper é o editor de gráficos animados da família Scaper. Um projeto
contém composições, camadas, animação e mídia retida. A extensão do arquivo
de projeto é `.mscape`.

Esta é uma versão de desenvolvimento. Comece com uma cópia do material de
origem importante e mantenha os arquivos de projeto exportados junto à biblioteca de trabalho.

## Iniciar uma composição {#start-a-composition}

Escolha **Arquivo → Nova composição**. O menu **Camada** abre ferramentas de
texto, formas, animação, composição, rastreamento, expressões e cenas 3D.
**Exibir → Prévia da composição** abre a reprodução; novas áreas de edição
aparecem quando são escolhidas em um menu.

Escolha **Exibir → Tela da composição** para selecionar, mover, alterar a escala
ou girar camadas com transformações 2D estáticas. As transformações animadas
continuam editáveis pelas ferramentas de propriedades e linha do tempo.

Em **Exibir → Linha do tempo**, selecione camadas existentes para renomeá-las,
ativá-las, desativá-las ou removê-las. Renomear preserva referências de propriedades
e animação. Remover uma camada mantém sua mídia original; inclua suas camadas
dependentes ou desvincule-as primeiro. **Desfazer** restaura as camadas removidas.
Uma camada de vídeo selecionada também oferece uma caixa de áudio quando sua
origem retida contém áudio.

Siga [seu primeiro projeto Motion](/motionscaper/first-project/) para criar,
animar, salvar e renderizar uma composição.

## Salvar e entregar {#save-and-deliver}

**Arquivo → Salvar** publica uma revisão salva. **Salvar cópia** exporta o
instantâneo atual como arquivo `.mscape` sem publicar uma nova revisão salva.
A mídia e as fontes originais importadas acompanham o arquivo. A **Biblioteca
de projetos** abre projetos retidos neste dispositivo.

**Arquivo → Renderizar** oferece quadros PNG transparentes em um arquivo TAR,
vídeo MP4 ou WebM opaco e ProRes 4444 quando o codificador desktop está
disponível. Sequências PNG não incluem áudio. O vídeo no navegador mantém o
áudio definido quando seu codificador é compatível com o formato solicitado.
ProRes nativo informa a precisão efetiva de cor e alfa no diálogo de renderização.
**Arquivo → Fila de renderização** mantém as tarefas disponíveis ao fechar
diálogos e trocar de projeto. Ela retém até oito tarefas e 128 MiB de downloads
do navegador; cada download admite até 64 MiB. Escolha um destino de arquivo em
fluxo para saídas maiores e remova tarefas concluídas para liberar os downloads
retidos. Se a limpeza da saída nativa falhar, use **Tentar limpar a saída
novamente** nesta fila. A tarefa mantém o destino até a limpeza ser concluída;
depois, é possível removê-la ou tentar a revisão enviada novamente com um novo destino.

## Vincular ao Framescaper {#link-to-framescaper}

Composições vinculadas exigem a linha de desenvolvimento separada Framescaper 1.1.
Em seu diálogo **Arquivo → Composições vinculadas**, crie uma URL de pareamento.
Cole-a no diálogo **Arquivo → Enviar composição ao Framescaper** do Motionscaper,
conecte e mantenha os editores e as janelas da ponte abertos. Operações posteriores
de **Salvar** enviam novas revisões automaticamente; **Salvar cópia** não envia.

O Framescaper retém cada revisão aceita e toda a mídia necessária para uso
offline. Desfazer fixa uma revisão anterior até as atualizações serem retomadas.
Alterações no tamanho da saída, temporização ou grade de áudio exigem uma revisão
explícita de conformação. O receptor desktop também pode monitorar um arquivo
`.mscape` salvo que seja selecionado.

## Verificar atualizações desktop {#check-desktop-updates}

Escolha **Ajuda → Verificar atualizações** no aplicativo desktop. Essa verificação
manual procura versões compatíveis do Motionscaper no repositório GitHub do
projeto. Versões de prévia podem receber versões de prévia mais recentes;
versões estáveis recebem versões estáveis. Escolha **Ver versão** para abrir a
página verificada da versão. A verificação não baixa nem instala uma atualização.
As compilações para navegador omitem esse comando do menu.

## Troca com After Effects {#after-effects-exchange}

**Arquivo → Ponte do After Effects** fornece scripts legíveis e permite revisar
dados de troca compatíveis antes de importar. Arquivos `.aep` e `.aepx` são
abertos por uma cópia instalada do After Effects e pelos scripts da ponte.
A ponte de desenvolvimento ainda não foi validada com o After Effects instalado.
Revise o relatório; os ajustes de cena não compatíveis e a mídia original
permanecem retidos no projeto.

O diálogo oferece opções separadas de importação e exportação para expressões
escalares de opacidade compatíveis que usam aritmética, tempo da composição,
valor anterior à expressão e funções Math padrão. Ambas as opções começam
desativadas. Revise o novo relatório após alterar uma opção; outras formas de
expressão exigem amostragem ou renderização explícita. O código original das
expressões permanece na troca retida ou no arquivo `original.mscape`.

O renderizador é compatível com cor e alfa SDR em camadas 2.5D, câmeras, luzes,
amostragem de obturação e profundidade de campo. Ele não afirma compatibilidade
com HDR, malhas 3D completas, máscaras avançadas por IA ou plug-ins arbitrários do After Effects.
