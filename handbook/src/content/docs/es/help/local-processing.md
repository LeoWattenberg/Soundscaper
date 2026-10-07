---
title: "Procesamiento local, modelos y complementos"
description: "Encuentra asistencia local por tarea y gestiona modelos y complementos en los editores de escritorio."
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"es"} -->

La asistencia local se ejecuta en tu dispositivo en los editores de escritorio Soundscaper y Framescaper. Selecciona el medio, luego elige la tarea desde su menú. El cuadro de diálogo muestra la selección, la configuración de la tarea y si sus modelos están instalados.

Los paquetes de escritorio no incluyen los motores de procesamiento nativos opcionales ni los pesos de los modelos. Instala un modelo desde el Administrador de modelos para descargar el motor y los pesos que necesita; después, ejecuta la tarea sobre los medios seleccionados. La primera instalación requiere conexión de red; el procesamiento posterior se realiza localmente. Consulta la guía de cada modelo para conocer las plataformas compatibles, la entrada de menú y los requisitos.

Consulta las [guías de modelos individuales](/reference/local-models/).

## Encontrar una tarea {#find-a-task}

| Menú | Tareas |
| --- | --- |
| Efecto → Eliminación y reparación de ruido | Mejorar Diálogo, Reducir Reverb, Limpiar Relleno y Silencio |
| Efecto → Separación de fuentes | Separar Diálogo / Música / Efectos |
| Analizar → Discurso | Transcribir y Subtítulos, Identificar Oradores, Marcar Reacciones |
| Analizar → Música | Detectar Pulsos y Tempo |
| Analizar → Video | Marcar Cortes |
| Efecto → Efectos de video | Reframear |
| Editar | Crear Resúmenes |
| Generar | Generar Texto Editorial |
| Herramientas → Búsqueda | Búsqueda Indexada, Indexar Transcripción, Indexar Video |

Las tareas de video pertenecen a Framescaper. Los comandos disponibles dependen del entorno de ejecución de escritorio y las capacidades del producto. La opción de menú alfabético de efectos de Soundscaper también ordena los efectos de procesamiento local por nombre.

Elige **Ejecutar localmente** para iniciar el procesamiento y responder al aviso de consentimiento local. Puedes cancelar mientras se procesa. Elige **Revisar resultado**, selecciona los resultados que deseas y elige **Aplicar seleccionados**. Los cambios aceptados en el proyecto se pueden deshacer. Cerrar una tarea no aplica sus propuestas.

**Herramientas → Procesamiento Local Avanzado** conserva los selectores de operaciones y modelos individuales. Los detalles técnicos en los cuadros de diálogo de tareas muestran los pasos subyacentes y la configuración exacta cuando sea necesario.

## Administrar modelos {#manage-models}

Abre **Herramientas → Administrador de Modelos**, o usa **Administrar Modelos** dentro de una tarea. El enlace de tarea filtra la lista a identidades de modelos compatibles; **Mostrar todos los modelos** elimina esa restricción. Busca por nombre o tarea y filtra por estado de instalación.

Instala los modelos de forma explícita. La primera instalación también descarga el entorno de ejecución nativo que falte y que comparta ese modelo. Las descargas muestran el progreso y se pueden cancelar. Al volver a una tarea, se conservan sus ajustes y se actualiza la disponibilidad de los modelos, pero no se inicia el procesamiento. Despliega **Almacenamiento y verificación** para reparar, limpiar, trasladar el almacenamiento, consultar avisos de licencia e instalar sin conexión desde una carpeta. Un modelo instalado desde archivos sin conexión sigue necesitando su entorno de ejecución correspondiente antes del primer uso.

Consulta las [guías de modelos individuales](/reference/local-models/) para conocer el propósito, la entrada del menú, el tamaño de descarga, los requisitos, las limitaciones y las comprobaciones de inferencia reales realizadas por el paquete de escritorio nocturno-con-pruebas de cada modelo publicado.

## Administrar complementos y dispositivos {#manage-plugins-and-devices}

**Efecto → Administrador de Complementos** enumera los complementos de audio en Soundscaper y los complementos OpenFX en Framescaper. Busca o filtra la lista, luego selecciona un complemento para sus controles de versión, permiso y recuperación. **Escaneo y Configuración** contiene la configuración de descubrimiento. La administración sigue siendo accesible cuando el procesamiento está desactivado.

Usa los complementos de audio a través de **Efecto → Complementos de Audio**. Los comandos Agregar/Editar efecto de video de Framescaper permanecen en **Efecto → Efectos de video**.

Abre **Editar → Preferencias → Configuración de Audio** para dispositivos de audio nativos y controles de ayuda. **Medio** contiene la configuración de medios nativos; **Efectos** enlaza al Administrador de Complementos y contiene el interruptor de descubrimiento de complementos. Los permisos y la recuperación de cuarentena de los complementos aún requieren acciones explícitas.
