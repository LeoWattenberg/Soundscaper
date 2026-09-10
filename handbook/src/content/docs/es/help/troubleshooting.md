---
title: "Solución de problemas"
description: "Resuelva problemas comunes de grabación, almacenamiento, importación y exportación."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"es"} -->

## Falta una entrada de grabación

Comprueba los permisos de micrófono del sistema operativo y del navegador, y luego vuelve a abrir el selector de dispositivos. Para la grabación multicanal, asegúrate de que cada pista armada tenga una asignación de entrada disponible.

## Un comando está deshabilitado

Muchos comandos dependen del estado actual. Selecciona el proyecto, la pista, el clip o el rango de tiempo requerido e inténtalo de nuevo. Una función también puede estar limitada intencionalmente a Soundscaper o Framescaper.

## Una importación utiliza demasiada memoria

La decodificación comprimida y algunas operaciones grandes pueden necesitar una memoria temporal considerable, aunque el audio del proyecto almacenado esté fragmentado. Cierra las pestañas o aplicaciones no relacionadas, reintenta con una fuente más pequeña o utiliza la edición de escritorio cuando sea apropiado.

## Un proyecto desapareció del navegador

Confirma que abriste el mismo perfil de navegador, origen y sitio del producto. Soundscaper y Framescaper comparten la biblioteca en el mismo `soundscaper.org`
origen, pero otro dominio, perfil de navegador o almacén de sitio borrado tiene una biblioteca diferente.

Si se borraron los datos del sitio y no existe una exportación de proyecto Scape, el editor no tiene una copia en la nube para restaurar.

## AUP4 omitió parte del proyecto

Lee el informe de compatibilidad. AUP4 transporta el estado de edición de audio compatible, pero omite el video y puede convertir u omitir efectos y el estado de mezcla exclusivo de Soundscaper.
Usa un archivo de proyecto Scape — `.sscape` o `.fscape`, ambos de los cuales se abren en cualquiera de los productos — para una transferencia completa del proyecto.

## Una exportación falla o no se reproduce

Reintenta después de confirmar que el rango seleccionado contiene material reproducible. Para audio o video comprimido, verifica que los activos de tiempo de ejecución puedan cargarse. Después de una exportación exitosa, prueba el archivo real en otro reproductor.

Para problemas sin resolver, usa **Ayuda → Soporte** para contactar al mantenedor e incluye el producto, la plataforma, la compilación de navegador o escritorio, los pasos y el error exacto.
