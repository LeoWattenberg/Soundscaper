---
title: "Procesamento local, modelos e complementos"
description: "Atopa asistencia local por tarefa e xestiona modelos e complementos nos editores de escritorio."
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"gl"} -->

A asistencia local execútase no teu dispositivo nos editores de escritorio Soundscaper e Framescaper. Selecciona medios e escolle a tarefa no seu menú. O diálogo mostra a selección, os axustes da tarefa e se os seus modelos están instalados.

Os paquetes de escritorio inclúen os motores nativos de procesamento para os modelos locais publicados. Instala os pesos dos modelos mediante Model Manager e executa a tarefa nos medios seleccionados. Consulta a [guía](/reference/local-models/) de cada modelo para coñecer as plataformas compatibles, a entrada de menú e os requisitos.

## Atopar unha tarefa {#find-a-task}

| Menú | Tarefas |
| --- | --- |
| Effect → Noise removal and repair | Enhance Dialogue, Reduce Reverb, Clean Filler & Silence |
| Effect → Source Separation | Separate Dialogue / Music / Effects |
| Analyze → Speech | Transcribe & Captions, Identify Speakers, Mark Reactions |
| Analyze → Music | Detect Beats & Tempo |
| Analyze → Video | Mark Cuts |
| Effect → Video effects | Reframe |
| Edit | Make Highlights |
| Generate | Generate Editorial Text |
| Tools → Search | Indexed Search, Index Transcript, Index Video |

As tarefas de vídeo pertencen a Framescaper. Os comandos dispoñibles dependen do tempo de execución de escritorio e das capacidades do produto. A opción alfabética do menú de efectos de Soundscaper tamén ordena por nome os efectos de procesamento local.

Escolle **Run locally** para iniciar o procesamento e responde á solicitude de consentimento local. Podes cancelar mentres se procesa. Escolle **Review result**, selecciona os resultados que queres e escolle **Apply selected**. As edicións aceptadas do proxecto pódense desfacer. Pechar unha tarefa non aplica as súas propostas.

**Tools → Advanced Local Processing** conserva os seleccionadores individuais de operación e modelo. Os detalles técnicos dos diálogos de tarefas mostran os pasos subxacentes e os axustes exactos cando son necesarios.

## Xestionar modelos {#manage-models}

Abre **Tools → Model Manager** ou usa **Manage Models** dentro dunha tarefa. A ligazón da tarefa filtra a lista para mostrar identidades de modelos compatibles; **Show all models** elimina esa restrición. Busca por nome ou tarefa e filtra polo estado de instalación.

Instala os modelos explicitamente. As descargas mostran o progreso e pódense cancelar. Volver a unha tarefa conserva os seus axustes e actualiza a dispoñibilidade do modelo; non inicia o procesamento. Expande **Storage and verification** para reparar, limpar, trasladar o almacenamento, ver avisos de licenza e instalar sen conexión desde un cartafol.

Consulta as [guías individuais dos modelos](/reference/local-models/) para coñecer o propósito, a entrada de menú, o tamaño da descarga, os requisitos e as limitacións de cada modelo publicado, así como as comprobacións de inferencia real realizadas polo paquete de escritorio nocturno con probas.

## Xestionar complementos e dispositivos {#manage-plugins-and-devices}

**Effect → Plugin Manager** enumera os complementos de audio en Soundscaper e os complementos OpenFX en Framescaper. Busca ou filtra a lista e selecciona un complemento para ver os seus controis de versión, permisos e recuperación. **Scanning & Settings** contén os axustes de descubrimento. A xestión segue sendo accesible cando o procesamento está desactivado.

Usa os complementos de audio mediante **Effect → Audio Plugins**. Os comandos para engadir ou editar efectos de vídeo de Framescaper permanecen en **Effect → Video effects**.

Abre **Edit → Preferences → Audio settings** para os dispositivos de audio nativos e os controis auxiliares. **Media** contén os axustes de medios nativos; **Effects** enlaza con Plugin Manager e contén o interruptor de descubrimento de complementos. Os permisos dos complementos e a recuperación da corentena aínda requiren accións explícitas.
