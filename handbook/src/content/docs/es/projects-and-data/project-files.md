---
title: "Archivos del proyecto"
description: "Elige entre la biblioteca local, archivos Scape, intercambio con Audacity, importación SESX y copias de seguridad renderizadas."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"es"} -->

## Biblioteca local del proyecto

El editor guarda los proyectos de trabajo en su biblioteca local. En un navegador, esto es
el almacenamiento privado de origen; en la edición de escritorio, son los datos de la aplicación. Esta es
la copia de trabajo conveniente, no la única copia que debe conservar.

## Archivos de proyecto Scape

Utilice **Archivo → Exportar archivo de proyecto** para guardar el proyecto de edición. Cada
producto escribe su propio sufijo: Soundscaper guarda `.sscape` y Framescaper
guarda `.fscape`, y la entrada del menú nombra el que corresponda. El formato
detrás de ambos es el mismo, por lo que es la opción adecuada cuando necesita
conservar el estado de edición de medios mixtos.

En el escritorio, el audio y el vídeo importados siguen siendo referencias a sus archivos originales de forma predeterminada. Conserva esos archivos en sus ubicaciones originales al volver a abrir el proyecto. La biblioteca local también conserva cachés de edición. Las grabaciones y los medios generados o procesados se incluyen porque no tienen un original externo sin cambios.

Elige **Archivo → Gestión del proyecto → Consolidar medios** para incluir los medios referenciados en el archivo del proyecto. La consolidación guarda el proyecto inmediatamente; elige un destino en el diálogo de guardado. Una vez guardada, la copia consolidada se puede mover o compartir sin los archivos de medios originales. Si no se puede consolidar algún medio o falla el guardado, el editor informa del problema.

Las exportaciones del navegador incluyen sus medios automáticamente. Antes de abrir en un navegador un proyecto de escritorio con referencias externas, consolídalo en el escritorio.

Cualquier producto abre cualquiera de los sufijos. `.sscape`, `.fscape`, el reservado
`.liscape`, y los archivos `.scape` exportados antes de que los productos tuvieran sus propios
sufijos se abren en todas partes, y guardar uno desde un producto diferente simplemente
lo renombra, por ejemplo, un `Mix.sscape` guardado desde Framescaper se convierte en
`Mix.fscape`. Nada del proyecto cambia con el nombre.

Al importar o abrir una copia de Scape, puede encontrar un proyecto existente con el
misma ID. Utilice el flujo de trabajo de copia ofrecido cuando ambas versiones deben permanecer en la
biblioteca local.

## Audacity AUP3 y AUP4

La exportación de proyectos de Audacity está disponible en **Archivo → Exportar otros**. Elige **Exportar AUP3** para el perfil de proyecto de Audacity 3.7.9 o **Exportar AUP4** para el perfil de intercambio actual de Audacity. Cada exportación produce un informe de compatibilidad que describe las conversiones, los efectos no disponibles y el estado propio de Soundscaper que se omite.

Ambos formatos son solo de audio. Se omite el vídeo, y no se transfieren las preferencias del navegador, el historial de deshacer, el enrutamiento del mezclador ni la biblioteca de proyectos del navegador. No uses ninguno como la única copia de seguridad de un proyecto de Soundscaper o Framescaper.

## Adobe Audition SESX

En la edición de escritorio, usa **Archivo → Abrir** para importar una sesión de Adobe Audition `.sesx`. Conserva los archivos de audio referenciados en su estructura de carpetas relativa bajo la carpeta de la sesión, o elige una carpeta de medios cuando se te solicite. La importación crea un proyecto local con las pistas de audio, clips, ubicación, recortes, fundidos simples y ajustes estáticos del mezclador compatibles.

La importación SESX es unidireccional. No se transfieren los efectos de Audition, la automatización, el enrutamiento, el vídeo, los marcadores, los bucles, el estiramiento, los fundidos cruzados enlazados ni las curvas exactas de fundido. Abre **Archivo → Informe de entrega** después de importar para revisar los medios que faltan y otros contenidos omitidos. Conserva el archivo SESX original y los medios para seguir trabajando en Audition.

## Copia de seguridad renderizada

Para trabajos importantes, mantenga ambos:

1. Una copia del proyecto Scape (`.sscape` o `.fscape`) para futuras ediciones.
2. Un archivo de audio o video renderizado que se puede reproducir sin el editor.

Almacene esos archivos fuera del directorio del navegador o de los datos de la aplicación.