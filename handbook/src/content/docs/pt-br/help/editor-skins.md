---
title: "Peles do editor"
description: "Escolha uma pele visual ou experimente uma temporariamente através de uma URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"pt-BR"} -->

As skins alteram as cores, fontes, bordas e planos de fundo decorativos do editor.
Elas estão disponíveis no Soundscaper e no Framescaper. Cada produto lembra sua
própria escolha. Os espaços de trabalho continuam controlando o arranjo de painéis e ferramentas.

## Escolha uma skin {#choose-a-skin}

Abra **Editar → Preferências → Aparência** e selecione uma skin:

- **Padrão** mantém o design original do editor.
- **Sakura** combina flores de cerejeira, acentos rosas e letras arredondadas.
- **Lilac** usa tons frios de roxo e texturas violetas sobrepostas.
- **Techno** combina gráficos de circuito azul com letras monoespaçadas.

Escolha **Claro**, **Escuro** ou **Seguir tema do sistema** separadamente. Cada skin tem
versões claras e escuras. **Estilo de clipe** permanece uma escolha separada; a
paleta Colorida é coordenada com cada skin, mantendo as cores dos clipes distintas.

O contraste alto tem prioridade sobre a decoração da skin. Desativar o contraste alto
retorna a skin selecionada. Alterar a skin nunca muda o áudio do clipe, o conteúdo do projeto
ou o layout do espaço de trabalho.

## Teste uma skin a partir de um link {#try-a-skin-from-a-link}

Adicione `?useskin=sakura` a uma URL do editor para visualizar temporariamente a Sakura. Use
`default`, `sakura`, `lilac` ou `techno` como valor. Se a URL já tiver um
parametro de consulta, adicione `&useskin=sakura` em vez disso. Um valor desconhecido é ignorado.

Uma visualização de URL não substitui sua skin salva, mesmo que você altere outra
prefeência. Recarregar a URL de visualização continua a visualização; visitar sem o
parametro usa sua escolha salva. O parametro não escolhe claro ou escuro.

Em **Preferências → Aparência**, escolha **Manter esta skin** para salvar a visualização,
ou **Encerrar visualização** para retornar à sua skin salva. A seleção de qualquer skin também salva
aquela escolha e encerra a visualização. Essas ações removem apenas o parametro da skin
da URL atual, sem recarregar o editor.
