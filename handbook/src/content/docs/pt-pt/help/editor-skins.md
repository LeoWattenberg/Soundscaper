---
title: "Peles do editor"
description: "Escolha uma pele visual ou experimente uma temporariamente através de uma URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"pt-PT"} -->

As peles alteram as cores, fontes, bordas e fundos decorativos do editor.
Estão disponíveis no Soundscaper e no Framescaper. Cada produto lembra a sua própria escolha. Os espaços de trabalho continuam a controlar a disposição dos painéis e ferramentas.

## Escolher uma pele {#choose-a-skin}

Abra **Editar → Preferências → Aparência** e selecione uma pele:

- **Padrão** mantém o design original do editor.
- **Sakura** combina flores de cerejeira, acentos cor-de-rosa e letras arredondadas.
- **Lilac** utiliza tons frios de roxo e texturas violeta sobrepostas.
- **Techno** combina gráficos de circuito azul com letras monoespaçadas.

Escolha **Claro**, **Escuro** ou **Seguir tema do sistema** separadamente. Cada pele tem versões claras e escuras. **Estilo do clipe** permanece como uma escolha separada; a paleta Colorful é coordenada com cada pele, mantendo as cores dos clipes distintas.

O contraste elevado tem prioridade sobre a decoração da pele. Desativar o contraste elevado restaura a pele selecionada. Alterar a pele nunca altera o áudio do clipe, o conteúdo do projeto ou o layout do espaço de trabalho.

## Experimentar uma pele a partir de um link {#try-a-skin-from-a-link}

Adicione `?useskin=sakura` a um URL do editor para visualizar temporariamente a Sakura. Utilize
`default`, `sakura`, `lilac` ou `techno` como valor. Se o URL já tiver um parâmetro de consulta, adicione `&useskin=sakura` em vez disso. Um valor desconhecido é ignorado.

Uma visualização de URL não substitui a sua pele salva, mesmo que altere outra preferência. Recarregar o URL de visualização continua a visualização; visitar sem o parâmetro utiliza a sua escolha salva. O parâmetro não escolhe entre claro ou escuro.

Em **Preferências → Aparência**, escolha **Manter esta pele** para salvar a visualização, ou **Terminar visualização** para regressar à sua pele salva. A seleção de qualquer pele também salva essa escolha e termina a visualização. Estas ações removem apenas o parâmetro de pele do URL atual, sem recarregar o editor.
