---
title: "Sobrescrever um arquivo importado no desktop"
description: "Salve o projeto editado sobre o arquivo de mídia original no Soundscaper ou Framescaper."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"pt-BR"} -->

Nas versões Electron do Soundscaper e Framescaper, **Arquivo → Sobrescrever nome do arquivo** exporta o projeto editado completo para o arquivo de mídia importado originalmente. O comando usa as configurações de exportação compatíveis com o arquivo original e salva imediatamente, sem abrir a janela de exportação nem um seletor de arquivos. O áudio mantém o formato de origem, a taxa de amostragem e o número de canais. Vídeos MP4 e WebM compatíveis mantêm o contêiner, as dimensões e a taxa de quadros de origem.

Importe um arquivo de mídia por **Arquivo → Importar**, faça as edições e escolha **Arquivo → Sobrescrever nome do arquivo**. Você pode repetir a operação depois de novas edições. Uma seleção de tempo não limita a sobrescrita: o projeto inteiro é sempre renderizado. O projeto mantém as mídias importadas e o histórico de edição.

O comando fica indisponível quando o projeto não tem um arquivo original compatível, quando vários arquivos originais foram importados ou durante importação, gravação ou processamento. As versões no navegador usam a janela de exportação comum.

Escolha **Arquivo → Exportar áudio** no Soundscaper ou **Arquivo → Exportar vídeo** no Framescaper se quiser escolher outro destino ou alterar as configurações de entrega. A sobrescrita substitui o conteúdo do arquivo original; mantenha uma cópia separada se precisar da gravação sem edição.
