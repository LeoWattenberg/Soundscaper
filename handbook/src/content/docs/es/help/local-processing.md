---
title: "Procesamiento local, modelos y complementos"
description: "Encuentra asistencia local por tarea y gestiona modelos y complementos en los editores de escritorio."
---
<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"es"} -->

La asistencia local se ejecuta en tu dispositivo en los editores de escritorio Soundscaper y Framescaper. Selecciona el medio, luego elige la tarea desde su menú. El cuadro de diálogo muestra la selección, la configuración de la tarea y si sus modelos están instalados.

Los paquetes de escritorio incluyen los motores de procesamiento nativos para los modelos locales publicados. Instala los pesos del modelo a través del Administrador de Modelos, luego ejecuta la tarea en tu medio seleccionado. Consulta la guía de cada modelo [guía](/reference/local-models/) para conocer sus plataformas admitidas, la entrada del menú y los requisitos.

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

Instala los modelos explícitamente. Las descargas muestran el progreso y se pueden cancelar. Volver a una tarea preserva sus configuraciones y actualiza la disponibilidad del modelo; no inicia el procesamiento. Expande **Almacenamiento y verificación** para reparación, limpieza, reubicación de almacenamiento, avisos de licencia e instalación sin conexión desde una carpeta.

Consulta las [guías de modelos individuales](/reference/local-models/) para conocer el propósito, la entrada del menú, el tamaño de descarga, los requisitos, las limitaciones y las comprobaciones de inferencia reales realizadas por el paquete de escritorio nocturno-con-pruebas de cada modelo publicado.

## Administrar complementos y dispositivos {#manage-plugins-and-devices}

**Efecto → Administrador de Complementos** enumera los complementos de audio en Soundscaper y los complementos OpenFX en Framescaper. Busca o filtra la lista, luego selecciona un complemento para sus controles de versión, permiso y recuperación. **Escaneo y Configuración** contiene la configuración de descubrimiento. La administración sigue siendo accesible cuando el procesamiento está desactivado.

Usa los complementos de audio a través de **Efecto → Complementos de Audio**. Los comandos Agregar/Editar efecto de video de Framescaper permanecen en **Efecto → Efectos de video**.

Abre **Editar → Preferencias → Configuración de Audio** para dispositivos de audio nativos y controles de ayuda. **Medio** contiene la configuración de medios nativos; **Efectos** enlaza al Administrador de Complementos y contiene el interruptor de descubrimiento de complementos. Los permisos y la recuperación de cuarentena de los complementos aún requieren acciones explícitas.
