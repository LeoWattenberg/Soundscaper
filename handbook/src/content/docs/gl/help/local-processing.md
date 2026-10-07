---
title: "Procesamento local, modelos e complementos"
description: "Atopa asistencia local por tarefa e xestiona modelos e complementos nos editores de escritorio."
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"gl"} -->

A asistencia local execútase no teu dispositivo nos editores de escritorio Soundscaper e Framescaper. Selecciona medios e escolle a tarefa no seu menú. O diálogo mostra a selección, os axustes da tarefa e se os seus modelos están instalados.

Os paquetes de escritorio non inclúen os motores nativos de procesamento opcionais nin os pesos dos modelos. Instala un modelo mediante o Xestor de modelos para descargar o motor e os pesos que precisa e, despois, executa a tarefa nos medios seleccionados. A primeira instalación require conexión á rede; os procesamentos posteriores execútanse localmente. Consulta a guía de cada modelo para ver as plataformas compatibles, a entrada do menú e os requisitos.

Consulta as [guías de modelos individuais](/reference/local-models/).

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

Instala os modelos de xeito explícito. A primeira instalación tamén descarga o entorno de execución nativo compartido que lle falte ao modelo. As descargas mostran o progreso e pódense cancelar. Ao volver a unha tarefa, mantéñense os seus axustes e actualízase a dispoñibilidade dos modelos, mais non comeza o procesamento. Abre **Almacenamento e verificación** para reparar, limpar, mover o almacenamento, consultar avisos de licenza e instalar sen conexión desde un cartafol. Un modelo instalado desde ficheiros sen conexión tamén precisa o seu entorno correspondente antes do primeiro uso.

Consulta as [guías individuais dos modelos](/reference/local-models/) para coñecer o propósito, a entrada de menú, o tamaño da descarga, os requisitos e as limitacións de cada modelo publicado, así como as comprobacións de inferencia real realizadas polo paquete de escritorio nocturno con probas.

## Xestionar complementos e dispositivos {#manage-plugins-and-devices}

**Effect → Plugin Manager** enumera os complementos de audio en Soundscaper e os complementos OpenFX en Framescaper. Busca ou filtra a lista e selecciona un complemento para ver os seus controis de versión, permisos e recuperación. **Scanning & Settings** contén os axustes de descubrimento. A xestión segue sendo accesible cando o procesamento está desactivado.

Usa os complementos de audio mediante **Effect → Audio Plugins**. Os comandos para engadir ou editar efectos de vídeo de Framescaper permanecen en **Effect → Video effects**.

Abre **Edit → Preferences → Audio settings** para os dispositivos de audio nativos e os controis auxiliares. **Media** contén os axustes de medios nativos; **Effects** enlaza con Plugin Manager e contén o interruptor de descubrimento de complementos. Os permisos dos complementos e a recuperación da corentena aínda requiren accións explícitas.
