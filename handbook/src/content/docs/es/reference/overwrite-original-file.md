---
title: "Sobrescribir un archivo importado en escritorio"
description: "Guarda el proyecto editado sobre su archivo multimedia original en Soundscaper o Framescaper."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"es"} -->

En las versiones Electron de Soundscaper y Framescaper, **Archivo → Sobrescribir nombre de archivo** exporta el proyecto editado completo al archivo multimedia importado originalmente. Usa los ajustes de exportación admitidos por el archivo original y guarda de inmediato, sin abrir el diálogo de exportación ni un selector de archivos. El audio conserva su formato de origen, frecuencia de muestreo y número de canales. Los vídeos MP4 y WebM compatibles conservan su contenedor, dimensiones y frecuencia de fotogramas.

Importa un archivo multimedia mediante **Archivo → Importar**, haz los cambios y elige **Archivo → Sobrescribir nombre de archivo**. Puedes repetirlo después de editar más. Una selección de tiempo no limita la operación: siempre se renderiza el proyecto completo. El proyecto conserva los medios importados y el historial de edición.

El comando no está disponible si el proyecto no tiene un archivo original compatible, si se han importado varios originales o mientras se importa, graba o procesa. Las versiones de navegador usan el diálogo de exportación habitual.

Elige **Archivo → Exportar audio** en Soundscaper o **Archivo → Exportar vídeo** en Framescaper si quieres escoger otro destino o cambiar los ajustes de entrega. Al sobrescribir, se reemplaza el contenido del archivo original; guarda una copia aparte si necesitas conservar la grabación sin editar.
