---
title: "Motionscaper"
description: "Cree composiciones animadas y conserve localmente proyectos de animación editables."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"es"} -->

Motionscaper es el editor de gráficos animados de la familia Scaper. Un proyecto
contiene composiciones, capas, animación y medios conservados. La extensión de
su archivo de proyecto es `.mscape`.

Esta es una versión de desarrollo. Empiece con una copia del material fuente
importante y conserve los archivos de proyecto exportados junto a su biblioteca de trabajo.

## Iniciar una composición {#start-a-composition}

Elija **Archivo → Nueva composición**. El menú **Capa** abre las herramientas
de texto, formas, animación, composición, seguimiento, expresiones y escena 3D.
**Ver → Vista previa de composición** abre la reproducción; las nuevas superficies
de edición aparecen cuando las elige desde un menú.

Elija **Ver → Lienzo de composición** para seleccionar, mover, cambiar la escala
o girar capas con transformaciones 2D estáticas. Las transformaciones animadas
siguen siendo editables mediante las herramientas de propiedades y línea de tiempo.

En **Ver → Línea de tiempo**, seleccione capas existentes para renombrarlas,
activarlas, desactivarlas o quitarlas. Renombrar conserva las referencias de
propiedades y la animación. Quitar una capa conserva sus medios originales;
incluya sus capas dependientes o desvincúlelas primero. **Deshacer** restaura
las capas quitadas. Una capa de vídeo seleccionada también ofrece una casilla
de audio cuando su fuente conservada contiene audio.

Siga [su primer proyecto Motion](/motionscaper/first-project/) para crear,
animar, guardar y renderizar una composición.

## Guardar y entregar {#save-and-deliver}

**Archivo → Guardar** publica una revisión guardada. **Guardar copia** exporta
la instantánea actual como archivo `.mscape` sin publicar una nueva revisión
guardada. Los medios y las fuentes originales importados acompañan al archivo.
La **Biblioteca de proyectos** abre los proyectos conservados en este dispositivo.

**Archivo → Renderizar** ofrece fotogramas PNG transparentes en un archivo TAR,
vídeo MP4 o WebM opaco y ProRes 4444 cuando está disponible el codificador de
escritorio. Las secuencias PNG no incluyen audio. El vídeo del navegador conserva
el audio definido cuando su codificador admite el formato solicitado. ProRes
nativo indica su precisión efectiva de color y alfa en el diálogo de renderizado.
**Archivo → Cola de renderizado** mantiene las tareas disponibles al cerrar el
diálogo y cambiar de proyecto. Conserva hasta ocho tareas y 128 MiB de descargas
del navegador; cada descarga admite hasta 64 MiB. Elija un destino de archivo en
flujo para salidas mayores y quite las tareas terminadas para liberar las descargas
conservadas. Si falla la limpieza de una salida nativa, use **Reintentar limpieza
de salida** en esta cola. La tarea conserva su destino hasta completar la limpieza;
después puede quitarla o reintentar la revisión enviada con un destino nuevo.

## Vincular con Framescaper {#link-to-framescaper}

Las composiciones vinculadas requieren la rama de desarrollo independiente
Framescaper 1.1. En su diálogo **Archivo → Composiciones vinculadas**, cree una
URL de emparejamiento. Péguela en el diálogo **Archivo → Enviar composición a
Framescaper** de Motionscaper, conecte y mantenga abiertos los editores y las
ventanas del puente. Las operaciones posteriores de **Guardar** envían nuevas
revisiones automáticamente; **Guardar copia** no lo hace.

Framescaper conserva cada revisión aceptada y todos los medios de los que depende
para usarla sin conexión. Deshacer fija una revisión anterior hasta que reanude
las actualizaciones. Los cambios en el tamaño de salida, la temporización o la
cuadrícula de audio requieren una revisión explícita de conformado. El receptor
de escritorio también puede vigilar un archivo `.mscape` guardado que seleccione.

## Buscar actualizaciones de escritorio {#check-desktop-updates}

Elija **Ayuda → Buscar actualizaciones** en la aplicación de escritorio. Esta
comprobación manual busca versiones compatibles de Motionscaper en el repositorio
GitHub del proyecto. Las versiones preliminares pueden recibir versiones
preliminares más recientes; las estables reciben versiones estables. Elija
**Ver versión** para abrir la página de versión verificada. La comprobación
no descarga ni instala una actualización. Las compilaciones para navegador
omiten este comando del menú.

## Intercambio con After Effects {#after-effects-exchange}

**Archivo → Puente de After Effects** proporciona scripts legibles y permite
revisar los datos de intercambio admitidos antes de importar. Los archivos
`.aep` y `.aepx` se abren mediante una copia instalada de After Effects y los
scripts del puente. El puente de desarrollo aún no se ha validado con After
Effects instalado. Revise su informe; los ajustes de escena no admitidos y los
medios originales permanecen conservados en el proyecto.

El diálogo ofrece opciones de importación y exportación independientes para
las expresiones escalares de opacidad admitidas que usan aritmética, tiempo de
composición, valor previo a la expresión y funciones Math estándar. Ambas
opciones comienzan desactivadas. Revise el nuevo informe tras cambiar una opción;
las demás formas de expresión requieren muestreo o renderizado explícitos.
El código original de las expresiones permanece en el intercambio conservado
o en el archivo `original.mscape`.

El renderizador admite color y alfa SDR con capas 2.5D, cámaras, luces, muestreo
de obturación y profundidad de campo. No afirma compatibilidad con HDR, mallas
3D completas, enmascarado avanzado mediante IA ni plug-ins arbitrarios de After Effects.
