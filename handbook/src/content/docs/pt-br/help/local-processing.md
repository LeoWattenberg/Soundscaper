---
title: "Processamento local, modelos e plugins"
description: "Encontre assistência local por tarefa e gerencie modelos e plugins nos editores de desktop."
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"pt-BR"} -->

A assistência local é executada no seu dispositivo nos editores de desktop Soundscaper e Framescaper. Selecione a mídia, depois escolha a tarefa no seu menu. O diálogo mostra a seleção, as configurações da tarefa e se os modelos estão instalados.

Os pacotes para desktop não incluem os mecanismos nativos opcionais de processamento nem os pesos dos modelos. Instale um modelo pelo Gerenciador de modelos para baixar o mecanismo e os pesos necessários e, em seguida, execute a tarefa na mídia selecionada. A primeira instalação exige conexão de rede; os processamentos seguintes são locais. Consulte o guia de cada modelo para ver as plataformas compatíveis, a opção de menu e os requisitos.

Consulte os [guias individuais dos modelos](/reference/local-models/).

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

Escolha **Executar localmente** para iniciar o processamento e responder ao prompt de consentimento local. Você pode cancelar durante o processamento. Escolha **Revisar resultado**, selecione os resultados que deseja e escolha **Aplicar selecionados**. As edições de projeto aceitas podem ser desfeitas. Fechar uma tarefa não aplica suas propostas.

**Ferramentas → Processamento Local Avançado** mantém os seletores de operação e modelo individuais. Os detalhes técnicos nos diálogos de tarefa mostram as etapas subjacentes e as configurações exatas quando necessário.

## Gerenciar modelos {#manage-models}

Abra **Ferramentas → Gerenciador de Modelos** ou use **Gerenciar Modelos** dentro de uma tarefa. O link da tarefa filtra a lista para identidades de modelo compatíveis; **Mostrar todos os modelos** limpa essa restrição. Pesquise por nome ou tarefa e filtre pelo status de instalação.

Instale os modelos explicitamente. A primeira instalação também baixa o runtime nativo compartilhado que estiver faltando e for necessário ao modelo. Os downloads mostram o progresso e podem ser cancelados. Ao voltar a uma tarefa, as configurações são mantidas e a disponibilidade dos modelos é atualizada; o processamento não começa. Expanda **Armazenamento e verificação** para reparo, limpeza, realocação do armazenamento, avisos de licença e instalação offline por uma pasta. Um modelo instalado por arquivos offline ainda precisa do runtime correspondente antes do primeiro uso.

Consulte os [guias de modelo individuais](/reference/local-models/) para o propósito, entrada de menu, tamanho do download, requisitos, limitações e verificações de inferência reais realizadas pelo pacote de desktop noturno-com-testes de cada modelo publicado.

## Gerenciar plugins e dispositivos {#manage-plugins-and-devices}

**Efeito → Gerenciador de Plugins** lista os plugins de áudio no Soundscaper e os plugins OpenFX no Framescaper. Pesquise ou filtre a lista e, em seguida, selecione um plugin para seus controles de versão, permissão e recuperação. **Digitalização & Configurações** contém configurações de descoberta.

Use plugins de áudio através de **Efeito → Plugins de Áudio**. Os comandos Adicionar/Editar efeito de vídeo do Framescaper permanecem em **Efeito → Efeitos de vídeo**.

Abra **Editar → Preferências → Configurações de Áudio** para dispositivos de áudio nativos e controles de ajuda. **Mídia** contém configurações de mídia nativas; **Efeitos** vincula ao Gerenciador de Plugins e contém o interruptor de descoberta de plugins. As permissões e a recuperação de quarentena dos plugins ainda exigem ações explícitas.
