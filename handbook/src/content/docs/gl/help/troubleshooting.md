---
title: "Solución de problemas"
description: "Resolve problemas comúns de gravación, almacenamento, importación e exportación."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"gl"} -->

## Falta unha entrada de gravación

Comproba os permisos do micrófono do sistema operativo e do navegador e, a continuación, volve abrir o selector de dispositivos. Para a gravación multicanal, asegúrate de que cada pista armada ten unha asignación de entrada dispoñible.

## Un comando está desactivado

Moitos comandos dependen do estado actual. Selecciona o proxecto, a pista, o clip ou o intervalo de tempo necesario e inténtao de novo. Unha función tamén pode estar limitada intencionadamente a Soundscaper ou Framescaper.

## Unha importación usa demasiada memoria

A decodificación comprimida e algúns operacións grandes poden necesitar memoria temporal substancial, aínda que o audio do proxecto almacenado estea en fragmentos. Pecha as pestanas ou aplicacións non relacionadas, reintenta cunha fonte máis pequena ou usa a edición de escritorio cando sexa apropiado.

## Un proxecto desapareceu do navegador

Confirma que abriste o mesmo perfil de navegador, orixe e sitio do produto. Soundscaper e Framescaper comparten a biblioteca na mesma orixe `soundscaper.org`, pero outro dominio, perfil de navegador ou almacén de sitio limpo ten unha biblioteca diferente.

Se se limparon os datos do sitio e non existe unha exportación de proxecto Scape, o editor non ten unha copia na nube para restaurar.

## AUP4 omitiu parte do proxecto

Lê o informe de compatibilidade. AUP4 transporta o estado de edición de audio compatible pero omite o vídeo e pode converter ou omitir efectos e o estado de mestura exclusivo de Soundscaper. Usa un ficheiro de proxecto Scape — `.sscape` ou `.fscape`, ambos os cales se abren en calquera dos produtos — para unha transferencia completa do proxecto.

## Unha exportación falla ou non se reproduce

Reintenta despois de confirmar que o intervalo seleccionado contén material reproducible. Para audio ou vídeo comprimido, verifica que os activos de tempo de execución se poidan cargar. Despois dunha exportación exitosa, proba o ficheiro real noutro reprodutor.

Para problemas non resolvidos, usa **Axuda → Soporte** para contactar co mantenedor e inclúe o produto, a plataforma, a compilación de navegador ou escritorio, os pasos e o erro exacto.
