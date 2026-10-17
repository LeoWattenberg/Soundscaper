---
title: "Motionscaper"
description: "Crie composições animadas e mantenha projetos de animação editáveis localmente."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"pt-PT"} -->

Motionscaper é o editor de gráficos em movimento da família Scaper. Um projeto
contém composições, camadas, animação e material multimédia conservado. A extensão
do ficheiro de projeto é `.mscape`.

Esta é uma versão de desenvolvimento. Comece com uma cópia do material de
origem importante e guarde os ficheiros de projeto exportados junto da biblioteca de trabalho.

## Iniciar uma composição {#start-a-composition}

Escolha **Ficheiro → Nova composição**. O menu **Camada** abre ferramentas de
texto, formas, animação, composição, seguimento, expressões e cenas 3D.
**Ver → Pré-visualização da composição** abre a reprodução; novas áreas de edição
aparecem quando são escolhidas num menu.

Escolha **Ver → Área da composição** para selecionar, mover, alterar a escala
ou rodar camadas com transformações 2D estáticas. As transformações animadas
continuam editáveis nas ferramentas de propriedades e linha de tempo.

Em **Ver → Linha de tempo**, selecione camadas existentes para lhes mudar o nome,
ativá-las, desativá-las ou removê-las. A mudança de nome preserva as referências
de propriedades e a animação. A remoção de uma camada conserva o material multimédia
original; inclua as camadas dependentes ou desvincule-as primeiro. **Desfazer**
repõe as camadas removidas. Uma camada de vídeo selecionada também oferece uma
caixa de áudio quando a origem conservada contém áudio.

Siga [o seu primeiro projeto Motion](/motionscaper/first-project/) para criar,
animar, guardar e renderizar uma composição.

## Guardar e entregar {#save-and-deliver}

**Ficheiro → Guardar** publica uma revisão guardada. **Guardar cópia** exporta o
instantâneo atual como ficheiro `.mscape` sem publicar uma nova revisão guardada.
O material multimédia e os tipos de letra originais importados acompanham o ficheiro.
A **Biblioteca de projetos** abre projetos conservados neste dispositivo.

**Ficheiro → Renderizar** oferece fotogramas PNG transparentes num ficheiro TAR,
vídeo MP4 ou WebM opaco e ProRes 4444 quando o codificador para computador está
disponível. As sequências PNG não incluem áudio. O vídeo no navegador mantém o
áudio definido quando o codificador é compatível com o formato pedido. O ProRes
nativo indica a precisão efetiva da cor e do alfa no diálogo de renderização.
**Ficheiro → Fila de renderização** mantém as tarefas disponíveis ao fechar
diálogos e mudar de projeto. Conserva até oito tarefas e 128 MiB de transferências
do navegador; cada transferência admite até 64 MiB. Escolha um destino de ficheiro
em fluxo para saídas maiores e remova tarefas concluídas para libertar as
transferências conservadas. Se a limpeza da saída nativa falhar, utilize **Tentar
limpar a saída novamente** nesta fila. A tarefa mantém o destino até a limpeza
terminar; depois, pode removê-la ou tentar novamente a revisão enviada com um novo destino.

## Ligar ao Framescaper {#link-to-framescaper}

As composições ligadas exigem a linha de desenvolvimento separada Framescaper 1.1.
No respetivo diálogo **Ficheiro → Composições ligadas**, crie um URL de emparelhamento.
Cole-o no diálogo **Ficheiro → Enviar composição ao Framescaper** do Motionscaper,
ligue os editores e mantenha-os abertos, juntamente com as janelas da ponte. As
operações posteriores de **Guardar** enviam novas revisões automaticamente;
**Guardar cópia** não envia.

O Framescaper conserva cada revisão aceite e todo o material multimédia necessário
para utilização sem ligação. Desfazer fixa uma revisão anterior até as atualizações
serem retomadas. Alterações ao tamanho da saída, à temporização ou à grelha de áudio
exigem uma revisão explícita de conformação. O recetor para computador também pode
vigiar um ficheiro `.mscape` guardado que seja selecionado.

## Verificar atualizações para computador {#check-desktop-updates}

Escolha **Ajuda → Verificar atualizações** na aplicação para computador. Esta
verificação manual procura versões compatíveis do Motionscaper no repositório GitHub
do projeto. As versões de pré-visualização podem receber versões de pré-visualização
mais recentes; as versões estáveis recebem versões estáveis. Escolha **Ver versão**
para abrir a página verificada da versão. A verificação não transfere nem instala
atualizações. As compilações para navegador omitem este comando do menu.

## Troca com After Effects {#after-effects-exchange}

**Ficheiro → Ponte do After Effects** fornece scripts legíveis e permite rever
dados de troca compatíveis antes da importação. Os ficheiros `.aep` e `.aepx` são
abertos por uma cópia instalada do After Effects e pelos scripts da ponte.
A ponte de desenvolvimento ainda não foi validada com o After Effects instalado.
Reveja o relatório; os ajustes de cena não compatíveis e o material multimédia
original permanecem conservados no projeto.

O diálogo oferece opções separadas de importação e exportação para expressões
escalares de opacidade compatíveis que utilizam aritmética, tempo da composição,
valor anterior à expressão e funções Math padrão. Ambas as opções começam
desativadas. Reveja o novo relatório após alterar uma opção; outras formas de
expressão exigem amostragem ou renderização explícita. O código original das
expressões permanece na troca conservada ou no ficheiro `original.mscape`.

O renderizador suporta cor e alfa SDR em camadas 2.5D, câmaras, luzes,
amostragem do obturador e profundidade de campo. Não afirma compatibilidade
com HDR, malhas 3D completas, máscaras avançadas por IA ou plug-ins arbitrários do After Effects.
