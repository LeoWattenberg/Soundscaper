---
title: "Pele do editor"
description: "Escolle unha pele visual ou proba unha temporalmente a través dunha URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"gl"} -->

As pelles cambian as cores, as fontes, as bordas e os fondos decorativos do editor.
Están dispoñibles en Soundscaper e Framescaper. Cada produto lembra a súa
escollla. Os espazos de traballo continúan controlando a disposición dos paneis e as ferramentas.

## Escolle unha pel {#choose-a-skin}

Abre **Editar → Preferencias → Apariencia** e selecciona unha pel:

- **Predeterminada** conserva o deseño orixinal do editor.
- **Sakura** combina flores de cereixo, acentos rosa e tipografía redondeada.
- **Lilac** usa morados fríos e texturas violeta en capas.
- **Techno** combina gráficos de circuitos azuis con tipografía monoespaciada.

Escolle **Claro**, **Escuro** ou **Seguir o tema do sistema** por separado. Cada pel ten
versións clara e escura. O **Estilo de clip** permanece como unha escollla separada; a
paleta Colorful está coordinada con cada pel mantendo as cores dos clips distintas.

O alto contraste ten prioridade sobre a decoración da pel. Desactivar o alto contraste
restaura a pel seleccionada. Cambiar unha pel nunca cambia o audio dos clips, o contido do proxecto
ou a disposición do espazo de traballo.

## Proba unha pel desde un enlace {#try-a-skin-from-a-link}

Engade `?useskin=sakura` a un URL do editor para previsualizar temporalmente Sakura. Usa
`default`, `sakura`, `lilac`, ou `techno` como valor. Se o URL xa ten un
parámetro de consulta, engade `&useskin=sakura` en vez diso. Un valor descoñecido ignórase.

Unha previsualización por URL non substitúe a túa pel gardada, aínda que cambies outra
preferencia. Recargar o URL de previsualización mantén a previsualización; visitar sen o
parámetro usa a túa escollla gardada. O parámetro non escolle claro ou escuro.

En **Preferencias → Apariencia**, escolle **Manter esta pel** para gardar a previsualización,
ou **Rematar a previsualización** para volver á túa pel gardada. Seleccionar calquera pel tamén garda
esa escollla e remata a previsualización. Estas accións eliminan só o parámetro de pel
do URL actual, sen recargar o editor.
