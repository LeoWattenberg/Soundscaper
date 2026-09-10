---
title: "Web ou desktop"
description: "Compreenda como as edições de navegador e de desktop embaladas armazenam projetos e acedem a ficheiros."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"pt-PT"} -->

Ambas as edições processam projetos localmente. O seu armazenamento e acesso a ficheiros diferem.

## Editor Web

A edição do navegador armazena projetos, gravações e meios importados em
armazenamento privado de origem do navegador. Não carrega um projeto para uma conta Soundscaper
e não é necessária nenhuma conta.

Utilize o editor web quando desejar acesso imediato sem instalar uma aplicação. Lembre-se de que o armazenamento do navegador está sujeito a regras de quota e expulsão do navegador. A limpeza de dados do site remove a biblioteca de projetos local.

## Pré-visualização de ambiente de trabalho

As pré-visualizações de ambiente de trabalho empacotadas mantêm uma biblioteca local autosavada dentro da aplicação de ambiente de trabalho. Incluem o tempo de execução do editor e traduções lançadas para
edição offline.

Os pacotes de ambiente de trabalho são não assinados. O macOS aplica apenas o selo de código ad-hoc sem identidade
que o seu carregador necessita para executar o Electron e os binários nativos; esse selo não faz
nenhuma alegação de editor ou confiança. O Windows SmartScreen ou o macOS Gatekeeper podem
portanto exibir um aviso de desenvolvedor desconhecido para as pré-visualizações e pacotes estáveis.

Ao abrir um ficheiro `.aup4`, importa-se um projeto independente para a biblioteca de ambiente de trabalho. As edições posteriores não reescrevem o ficheiro que foi aberto. **Guardar** atualiza a
cópia da biblioteca; **Guardar como** cria um novo ficheiro de intercâmbio Audacity.

## Telemóveis e tablets

O editor web mantém o seu layout de ambiente de trabalho em todos os ecrãs, mas abaixo de 900px de largura
(um telemóvel, ou um tablet na vertical) dobra o cromo em gavetas para que
a linha do tempo mantenha o espaço:

- O botão **Menu** no canto superior esquerdo abre uma gaveta com o menu de aplicação completo,
as pestanas do projeto, a barra de ação e a barra de ferramentas de ferramentas. Reproduzir, parar,
registar e pesquisar permanecem na barra. Escolher um comando fecha a gaveta.
- Os cabeçalhos das faixas deslizam sobre as faixas a partir do manipulador de cabeçalhos das faixas no
canto superior esquerdo da linha do tempo, ou a partir de **Ver › Cabeçalhos das Faixas**. Tocando
as faixas ou pressionando a tecla Escape, volta a colocá-los.
- A introdução acima do editor está colapsada por defeito em ecrãs estreitos; **Mostrar introdução** traz-a de volta.

**Editar › Preferências › Aparência › Layout** alterna entre Automático,
Compacto e Ambiente de Trabalho, de modo que uma pequena janela num ambiente de trabalho pode manter o cromo de ambiente de trabalho e um tablet largo pode optar pelas gavetas.

## Os projetos não se movem automaticamente

As bibliotecas do navegador e do ambiente de trabalho são separadas. Mova um projeto intencionalmente:

- Utilize um ficheiro de projeto Scape — `.sscape` do Soundscaper, `.fscape` do Framescaper — para o projeto completo.
- Utilize AUP4 quando precisar especificamente de intercâmbio de áudio com o Audacity.
- Exporte áudio ou vídeo renderizado como uma cópia de reprodução duradoura.

Consulte [Ficheiros de projeto](/projects-and-data/project-files/) antes de apagar dados do site do navegador ou dados da aplicação de ambiente de trabalho.
