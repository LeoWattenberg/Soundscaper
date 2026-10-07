---
title: "Substituír un ficheiro importado na versión de escritorio"
description: "Garda o proxecto editado sobre o ficheiro multimedia orixinal en Soundscaper ou Framescaper."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"gl"} -->

Nas versións Electron de Soundscaper e Framescaper, **Ficheiro → Substituír o nome do ficheiro** exporta o proxecto editado completo ao ficheiro multimedia importado orixinalmente. Usa os axustes de exportación admitidos polo ficheiro orixinal e garda de inmediato, sen abrir o diálogo de exportación nin un selector de ficheiros. O audio conserva o formato de orixe, a frecuencia de mostraxe e o número de canles. Os vídeos MP4 e WebM compatibles conservan o contedor, as dimensións e a frecuencia de fotogramas de orixe.

Importa un ficheiro multimedia mediante **Ficheiro → Importar**, fai as edicións e escolle **Ficheiro → Substituír o nome do ficheiro**. Podes repetir a operación despois de facer máis cambios. A selección temporal non limita a substitución: sempre se renderiza o proxecto completo. O proxecto conserva os medios importados e o historial de edición.

O comando non está dispoñible se o proxecto non ten un ficheiro orixinal compatible, se se importaron varios ficheiros orixinais ou durante a importación, gravación ou procesamento. As versións do navegador usan o diálogo de exportación habitual.

Escolle **Ficheiro → Exportar audio** en Soundscaper ou **Ficheiro → Exportar vídeo** en Framescaper se queres seleccionar outro destino ou cambiar os axustes de entrega. Ao substituír, cámbiase o contido do ficheiro orixinal; garda unha copia aparte se necesitas a gravación sen editar.
