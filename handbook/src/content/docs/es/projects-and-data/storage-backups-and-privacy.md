---
title: "Almacenamiento, copias de seguridad y privacidad"
description: "Comprender el almacenamiento de primer nivel local y proteger los proyectos de la pérdida del navegador o del dispositivo."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"es"} -->

## Lo que significa local-first

Los proyectos, las grabaciones y los medios importados se procesan y almacenan en tu
dispositivo. El editor no requiere una cuenta ni sincroniza proyectos con un
servicio de Soundscaper.

En la web, el audio y los medios utilizan el sistema de archivos de origen privado del navegador cuando
está disponible, con IndexedDB como alternativa. Soundscaper solicita almacenamiento persistente,
pero el navegador decide si otorgarlo o no.

## Lo que puede eliminar un proyecto

- Borrar los datos del sitio elimina la biblioteca de proyectos local del navegador.
- Los contextos de navegador privados o restringidos pueden recurrir a la memoria temporal.
- Las políticas de cuota y desalojo del navegador siguen siendo autoritativas.
- Eliminar manualmente los datos de la aplicación de escritorio elimina su biblioteca local.
- Un fallo en el dispositivo o en el almacenamiento puede eliminar todas las copias locales en ese dispositivo.

Desinstalar una versión empaquetada de escritorio está diseñado para preservar su biblioteca, pero
o no es una estrategia de copia de seguridad.

## Rutina de copia de seguridad

En hitos útiles y antes de borrar o migrar el almacenamiento:

1. Espera a que se complete el guardado local.
2. Exporta un archivo de proyecto Scape (`.sscape` o `.fscape`).
3. Exporta y reproduce una entrega renderizada.
4. Copia ambos a un almacenamiento fuera de los datos locales del editor.

Utiliza AUP4 además cuando la interoperabilidad de Audacity sea importante, no en lugar de la
copia del proyecto Scape.

## Privacidad del sitio de documentación

Este manual se sirve como archivos estáticos y utiliza la búsqueda local del navegador. El sitio V1
no agrega un servicio de análisis o un AI/search backend.

La política completa de [privacidad de Soundscaper y Framescaper](https://soundscaper.org/privacy/en/)
también cubre la entrega de aplicaciones, permisos de dispositivos, descargas opcionales,
comprobaciones de actualizaciones de escritorio y conexiones de Framescaper Web VCR.