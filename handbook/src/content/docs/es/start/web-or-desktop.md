---
title: "Web o escritorio"
description: "Comprenda cómo las ediciones de navegador y empaquetadas de escritorio almacenan proyectos y acceden a archivos."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"es"} -->

Ambas ediciones procesan proyectos localmente. Su almacenamiento y acceso a archivos son diferentes.

## Editor web

La edición en el navegador almacena proyectos, grabaciones e importaciones de medios en el almacenamiento privado del origen del navegador. No sube un proyecto a una cuenta de Soundscaper y no se requiere ninguna cuenta.

Utilice el editor web cuando desee un acceso inmediato sin instalar una aplicación. Recuerde que el almacenamiento del navegador está sujeto a las reglas de cuota y eliminación del navegador. Borrar los datos del sitio elimina la biblioteca de proyectos local.

## Vista previa de escritorio

Las vistas previas empaquetadas de escritorio mantienen una biblioteca local guardada automáticamente dentro de la aplicación de escritorio. Incluyen el entorno de ejecución del editor y las traducciones lanzadas para la edición sin conexión.

Los paquetes de escritorio no están firmados. macOS aplica solo el sello de código ad-hoc sin identidad que su cargador necesita para ejecutar Electron y los binarios nativos; ese sello no hace ninguna afirmación de editor o confianza. Por lo tanto, Windows SmartScreen o macOS Gatekeeper pueden mostrar una advertencia de desarrollador desconocido para las vistas previas y los paquetes estables.

Abrir un archivo `.aup4` importa un proyecto independiente a la biblioteca de escritorio. Las ediciones posteriores no reescriben el archivo que abrió. **Guardar** actualiza la copia de la biblioteca; **Guardar como** crea un nuevo archivo de intercambio de Audacity.

## Teléfonos y tabletas

El editor web mantiene su diseño de escritorio en todas las pantallas, pero por debajo de 900 píxeles de ancho (un teléfono o una tableta en posición vertical), dobla el cromado en cajones para que la línea de tiempo mantenga el espacio:

- El botón **Menú** en la esquina superior izquierda abre un cajón con el menú de aplicación completo, las pestañas del proyecto, la barra de acciones y la barra de herramientas de herramientas. Reproducir, detener, grabar y buscar permanecen en la barra. Elegir un comando cierra el cajón.
- Los encabezados de pista se deslizan sobre los carriles desde el controlador de encabezados de pista en la esquina superior izquierda de la línea de tiempo, o desde **Ver › Encabezados de pista**. Tocar los carriles o presionar Esc los guarda nuevamente.
- La introducción sobre el editor se colapsa por defecto en pantallas estrechas; **Mostrar introducción** lo trae de vuelta.

**Editar › Preferencias › Apariencia › Diseño** cambia entre Automático, Compacto y Escritorio, por lo que una pequeña ventana en un escritorio puede mantener el cromado de escritorio y una tableta ancha puede optar por los cajones.

## Los proyectos no se mueven automáticamente

Las bibliotecas de navegadores y escritorios son separadas. Mueva un proyecto intencionalmente:

- Utilice un archivo de proyecto Scape — `.sscape` de Soundscaper, `.fscape` de Framescaper — para el proyecto completo.
- Utilice AUP4 cuando necesite específicamente un intercambio de audio con Audacity.
- Exporte audio o video renderizado como una copia de reproducción duradera.

Consulte [Archivos de proyecto](/projects-and-data/project-files/) antes de eliminar los datos del sitio del navegador o los datos de la aplicación de escritorio.