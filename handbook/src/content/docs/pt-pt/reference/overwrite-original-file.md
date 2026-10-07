---
title: "Substituir um ficheiro importado na versão de computador"
description: "Guarde o projeto editado sobre o ficheiro multimédia original no Soundscaper ou Framescaper."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"pt-PT"} -->

Nas versões Electron do Soundscaper e Framescaper, **Ficheiro → Substituir nome do ficheiro** exporta o projeto totalmente editado para o ficheiro multimédia importado originalmente. O comando usa as definições de exportação suportadas pelo ficheiro original e guarda de imediato, sem abrir a caixa de diálogo de exportação nem um seletor de ficheiros. O áudio mantém o formato de origem, a frequência de amostragem e o número de canais. Os vídeos MP4 e WebM suportados mantêm o contentor, as dimensões e a frequência de fotogramas de origem.

Importe um ficheiro multimédia através de **Ficheiro → Importar**, faça as edições e escolha **Ficheiro → Substituir nome do ficheiro**. Pode repetir a operação depois de novas edições. Uma seleção temporal não limita a substituição: é sempre criado o resultado do projeto completo. O projeto mantém os conteúdos multimédia importados e o histórico de edição.

O comando não está disponível se o projeto não tiver um ficheiro original suportado, se tiverem sido importados vários ficheiros originais ou durante a importação, gravação ou processamento. As versões no navegador usam a caixa de diálogo de exportação normal.

Escolha **Ficheiro → Exportar áudio** no Soundscaper ou **Ficheiro → Exportar vídeo** no Framescaper se quiser selecionar outro destino ou alterar as definições de entrega. A substituição troca o conteúdo do ficheiro original; guarde uma cópia separada se precisar da gravação sem edição.
