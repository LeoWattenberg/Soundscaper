---
title: "Archivos del proyecto"
description: "Elige entre la biblioteca local, archivos de proyecto Scape, AUP4 y copias de seguridad renderizadas."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"es"} -->

## Biblioteca local del proyecto

El editor guarda los proyectos de trabajo en su biblioteca local. En un navegador, esto es
el almacenamiento privado de origen; en la edición de escritorio, son los datos de la aplicación. Esta es
la copia de trabajo conveniente, no la única copia que debe conservar.

## Archivos de proyecto Scape

Utilice **Archivo → Exportar archivo de proyecto** para un proyecto portátil sin pérdida. Cada
producto escribe su propio sufijo: Soundscaper guarda `.sscape` y Framescaper
guarda `.fscape`, y la entrada del menú nombra el que corresponda. El formato
detrás de ambos es el mismo, por lo que es la opción adecuada cuando necesita
conservar el estado de edición de medios mixtos.

Cualquier producto abre cualquiera de los sufijos. `.sscape`, `.fscape`, el reservado
`.liscape`, y los archivos `.scape` exportados antes de que los productos tuvieran sus propios
sufijos se abren en todas partes, y guardar uno desde un producto diferente simplemente
lo renombra, por ejemplo, un `Mix.sscape` guardado desde Framescaper se convierte en
`Mix.fscape`. Nada del proyecto cambia con el nombre.

Al importar o abrir una copia de Scape, puede encontrar un proyecto existente con el
misma ID. Utilice el flujo de trabajo de copia ofrecido cuando ambas versiones deben permanecer en la
biblioteca local.

## AUP4

AUP4 existe para un intercambio de audio compatible con Audacity. La exportación produce un
informes de compatibilidad que describe las conversiones, los efectos no disponibles y el estado
propio de Soundscaper omitido.

AUP4 es solo de audio. Se omite el video, y las preferencias del navegador, el historial de deshacer,
la ruta del mezclador y la biblioteca de proyectos del navegador no se transfieren. No
utilice AUP4 como la única copia de seguridad de un proyecto Soundscaper o Framescaper.

## Copia de seguridad renderizada

Para trabajos importantes, mantenga ambos:

1. Una copia del proyecto Scape (`.sscape` o `.fscape`) para futuras ediciones.
2. Un archivo de audio o video renderizado que se puede reproducir sin el editor.

Almacene esos archivos fuera del directorio del navegador o de los datos de la aplicación.