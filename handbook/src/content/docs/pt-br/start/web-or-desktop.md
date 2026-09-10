---
title: "Web ou desktop"
description: "Entenda como as edições de navegador e desktop embaladas armazenam projetos e acessam arquivos."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"pt-BR"} -->

Ambas edições processam projetos localmente. Seu armazenamento e acesso a arquivos diferem.

## Editor da Web

A edição do navegador armazena projetos, gravações e mídia importada no armazenamento privado de origem do navegador. Ele não faz upload de um projeto para uma conta Soundscaper e nenhuma conta é necessária.

Use o editor da web quando você quiser acesso imediato sem instalar um aplicativo. Lembre-se de que o armazenamento do navegador está sujeito a regras de cota e exclusão do navegador. Limpar os dados do site remove a biblioteca de projetos local.

## Pré-visualização de desktop

As pré-visualizações empacotadas para desktop mantêm uma biblioteca local salva automaticamente dentro do aplicativo de desktop. Eles agrupam o tempo de execução do editor e as traduções lançadas para edição offline.

Os pacotes de desktop são não assinados. O macOS aplica apenas o selo de código ad-hoc sem identidade que seu carregador precisa para executar o Electron e os binários nativos; esse selo não faz nenhuma alegação de editor ou confiança. Portanto, o Windows SmartScreen ou o Gatekeeper do macOS podem exibir um aviso de desenvolvedor desconhecido para os pacotes de pré-visualização e estáveis.

Abrir um arquivo `.aup4` importa um projeto independente para a biblioteca de desktop. Edições posteriores não reescrevem o arquivo que você abriu. **Salvar** atualiza a cópia da biblioteca; **Salvar como** cria um novo arquivo de intercâmbio Audacity.

## Telefones e tablets

O editor da web mantém seu layout de desktop em todas as telas, mas abaixo de 900px de largura (um telefone, ou um tablet mantido verticalmente), ele dobra o chrome em gavetas para que a linha do tempo mantenha o espaço:

- O botão **Menu** no canto superior esquerdo abre uma gaveta com o menu de aplicativo completo, as guias do projeto, a barra de ação e a barra de ferramentas de ferramentas. Reproduzir, parar, gravar e pesquisar permanecem na barra. Escolher um comando fecha a gaveta.
- Os cabeçalhos da faixa deslizam sobre as pistas a partir do manipulador de cabeçalhos da faixa no canto superior esquerdo da linha do tempo, ou de **Exibição › Cabeçalhos da faixa**. Toque nas pistas ou pressione Esc para guardá-los novamente.
- A introdução acima do editor é colapsada por padrão em telas estreitas; **Mostrar introdução** a traz de volta.

**Editar › Preferências › Aparência › Layout** alterna entre Automático, Compacto e Desktop, para que uma pequena janela em um desktop possa manter o chrome de desktop e um tablet largo pode optar pelas gavetas.

## Projetos não se movem automaticamente

As bibliotecas do navegador e do desktop são separadas. Mova um projeto intencionalmente:

- Use um arquivo de projeto Scape — `.sscape` do Soundscaper, `.fscape` do Framescaper — para o projeto completo.
- Use AUP4 quando você precisar especificamente de intercâmbio de áudio com o Audacity.
- Exporte áudio renderizado ou vídeo como uma cópia de reprodução duradoura.

Veja [Arquivos de projeto](/projects-and-data/project-files/) antes de excluir dados do site do navegador ou dados do aplicativo de desktop.
