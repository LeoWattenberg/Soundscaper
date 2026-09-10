---
title: "Temas de editor"
description: "Elige un tema visual o pruébalo temporalmente mediante una URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"es"} -->

Las pieles cambian los colores, las fuentes, los bordes y los fondos decorativos del editor.
Están disponibles en Soundscaper y Framescaper. Cada producto recuerda su
propia selección. Los espacios de trabajo siguen controlando la disposición de los paneles y las herramientas.

## Elegir una piel {#choose-a-skin}

Abre **Editar → Preferencias → Apariencia** y selecciona una piel:

- **Predeterminada** mantiene el diseño original del editor.
- **Sakura** combina flores de cerezo, acentos rosados y tipografía redondeada.
- **Lila** utiliza púrpuras fríos y texturas violetas en capas.
- **Techno** combina gráficos de circuitos azules con tipografía monoespaciada.

Elige **Claro**, **Oscuro** o **Seguir el tema del sistema** por separado. Cada piel tiene
versiones clara y oscura. El **Estilo de clip** sigue siendo una opción independiente; la
paleta Colorful está coordinada con cada piel, manteniendo los colores de los clips diferenciados.

El alto contraste tiene prioridad sobre la decoración de la piel. Desactivar el alto contraste
restaura la piel seleccionada. Cambiar una piel nunca modifica el audio de los clips, el contenido
del proyecto ni la disposición del espacio de trabajo.

## Probar una piel desde un enlace {#try-a-skin-from-a-link}

Añade `?useskin=sakura` a una URL del editor para previsualizar Sakura temporalmente. Usa
`default`, `sakura`, `lilac` o `techno` como valor. Si la URL ya tiene un
parámetro de consulta, añade `&useskin=sakura` en su lugar. Un valor desconocido se ignora.

Una previsualización por URL no reemplaza tu piel guardada, incluso si cambias otra
preferencia. Recargar la URL de previsualización mantiene la previsualización; visitar sin el
parámetro utiliza tu selección guardada. El parámetro no elige entre claro u oscuro.

En **Preferencias → Apariencia**, elige **Mantener esta piel** para guardar la previsualización,
o **Finalizar previsualización** para volver a tu piel guardada. Seleccionar cualquier piel también guarda
esa elección y finaliza la previsualización. Estas acciones eliminan solo el parámetro de piel
de la URL actual, sin recargar el editor.
