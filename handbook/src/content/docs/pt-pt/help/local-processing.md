---
title: "Processamento local, modelos e plugins"
description: "Encontre assistência local por tarefa e gerencie modelos e plugins nos editores de desktop."
---
<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"pt-PT"} -->

A assistência local funciona no seu dispositivo nos editores de desktop Soundscaper e Framescaper. Selecione a mídia, depois escolha a tarefa no seu menu. O diálogo mostra a seleção, as configurações da tarefa e se os seus modelos estão instalados.

Os pacotes de desktop incluem os motores de processamento nativos para os modelos locais publicados. Instale os pesos do modelo através do Gerenciador de Modelos e, em seguida, execute a tarefa na mídia selecionada. Consulte o guia de cada modelo [guia](/reference/local-models/) para as suas plataformas suportadas, entrada de menu e requisitos.

## Encontrar uma tarefa {#find-a-task}

| Menu | Tarefas |
| --- | --- |
| Efeito → Remoção e reparo de ruído | Melhorar Diálogo, Reduzir Reverb, Limpar Filler & Silêncio |
| Efeito → Separação de fontes | Separar Diálogo / Música / Efeitos |
| Analisar → Fala | Transcrever & Legendas, Identificar Oradores, Marcar Reações |
| Analisar → Música | Detectar Batidas & Tempo |
| Analisar → Vídeo | Marcar Cortes |
| Efeito → Efeitos de vídeo | Reframe |
| Editar | Criar Destaques |
| Gerar | Gerar Texto Editorial |
| Ferramentas → Pesquisa | Pesquisa Indexada, Indexar Transcrição, Indexar Vídeo |

As tarefas de vídeo pertencem ao Framescaper. Os comandos disponíveis dependem do tempo de execução do desktop e das capacidades do produto. A opção de menu de efeitos alfabéticos do Soundscaper também classifica os efeitos de processamento local por nome.

Escolha **Executar localmente** para iniciar o processamento e responder ao prompt de consentimento local. Pode cancelar durante o processamento. Escolha **Revisar resultado**, selecione os resultados que deseja e escolha **Aplicar selecionados**. As edições de projeto aceitas podem ser desfeitas. Fechar uma tarefa não aplica as suas propostas.

**Ferramentas → Processamento Local Avançado** mantém os seletores de operação e modelo individuais. Os detalhes técnicos nos diálogos de tarefas mostram as etapas subjacentes e as configurações exatas quando necessário.

## Gerenciar modelos {#manage-models}

Abra **Ferramentas → Gerenciador de Modelos** ou use **Gerenciar Modelos** dentro de uma tarefa. A ligação de tarefa filtra a lista para identidades de modelo compatíveis; **Mostrar todos os modelos** limpa essa restrição. Pesquise por nome ou tarefa e filtre pelo estado de instalação.

Instale os modelos explicitamente. Os downloads mostram o progresso e podem ser cancelados. Retornar a uma tarefa preserva as suas configurações e atualiza a disponibilidade do modelo; não inicia o processamento. Expanda **Armazenamento e verificação** para reparo, limpeza, realocação de armazenamento, avisos de licença e instalação offline de uma pasta.

Consulte os [guias de modelos individuais](/reference/local-models/) para o propósito, entrada de menu, tamanho de download, requisitos, limitações e verificações de inferência reais realizadas pelo pacote de desktop noturno-com-testes de cada modelo publicado.

## Gerenciar plugins e dispositivos {#manage-plugins-and-devices}

**Efeito → Gerenciador de Plugins** lista os plugins de áudio no Soundscaper e os plugins OpenFX no Framescaper. Pesquise ou filtre a lista e, em seguida, selecione um plugin para as suas versões, permissões e controles de recuperação. **Digitalização & Configurações** contém configurações de descoberta.

Use plugins de áudio através de **Efeito → Plugins de Áudio**. Os comandos Adicionar/Editar efeito de vídeo do Framescaper permanecem em **Efeito → Efeitos de vídeo**.

Abra **Editar → Preferências → Configurações de Áudio** para dispositivos de áudio nativos e controles auxiliares. **Mídia** contém configurações de mídia nativas; **Efeitos** liga ao Gerenciador de Plugins e contém o interruptor de descoberta de plugins. As permissões e a recuperação de quarentena dos plugins ainda requerem ações explícitas.
