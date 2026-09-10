---
title: "Editar, mezclar y exportar"
description: "Organiza los clips, equilibra las pistas, aplica efectos y crea un archivo de entrega."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","targetLocale":"es"} -->

## Organizar clips

Selecciona clips o un rango de tiempo antes de elegir un comando de edición. Split crea un límite de edición en la posición del cabezal de reproducción. Las variantes con preservación de huecos y ripple determinan si el material posterior permanece en su lugar o se mueve para cerrar la región eliminada.

Usa carpetas de pistas, grupos de clips y el Project Bin para mantener organizados los proyectos más grandes.

### Ajustar fundidos de clips {#clip-fades}

Selecciona un clip de audio para revelar pequeños manejadores triangulares a lo largo de la parte superior de su forma de onda, justo debajo del encabezado del clip.
Arrastra el triángulo izquierdo hacia adentro para un fundido de entrada, o el triángulo derecho hacia adentro para un fundido de salida. La forma de onda cambia mientras arrastras, y el área sobre la curva del fundido se vuelve más oscura. Los triángulos siguen los límites del fundido; arrastrar uno de vuelta a su esquina elimina ese fundido. Solo se modifica el clip que arrastras, incluso cuando varios clips están seleccionados.

Los manejadores desaparecen cuando deseleccionas el clip, pero la forma de onda con fundido y el sombreado permanecen. Estos fundidos preservan el audio original y siguen siendo ajustables después de guardar y reabrir el proyecto. Suelta para confirmar un fundido, o presiona **Escape** mientras arrastras para cancelar. **Deshacer** revierte un arrastre completo. La reproducción y la exportación usan los ajustes de fundido confirmados.

Con un clip seleccionado enfocado, presiona **Tab** para llegar a sus manejadores de fundido. Las flechas ajustan la duración en 10 milisegundos, o 100 milisegundos con **Shift**. **Inicio** elimina el fundido; **Fin** lo extiende a lo largo del clip. Para entrada numérica, elige **Editar → Clips de audio → Propiedades del clip** y usa **Fundidos**.

## Crear la mezcla

Usa los controles de ganancia de pista, panorámica, silencio y solo para equilibrar el proyecto. El panel Mezclador expone el mismo estado del proyecto en un diseño orientado a la mezcla. Los efectos en tiempo real siguen siendo ajustables; las operaciones destructivas o renderizadas crean cambios en el proyecto que se pueden deshacer mientras la historia esté disponible.

Usa el medidor de reproducción y el análisis de sonoridad para inspeccionar el resultado. Evita tratar una meta de medidor como un sustituto de escuchar la exportación completa.

### Reducir sibilancia {#reduce-sibilance}

Elige **Efecto → Eliminación y reparación de ruido → De-esser**. Establece **Frecuencia** cerca de la parte áspera de la voz, luego baja **Umbral** hasta que las sibilantes se suavicen. **Reducción máxima** limita el corte; comienza alrededor de 6–9 dB. Un **Ataque** más corto captura el inicio de una consonante, mientras que **Liberación** controla la rapidez con la que las frecuencias altas se recuperan. Solo se reduce la banda superior.

### Comprimir bandas de frecuencia separadas {#multiband-compression}

Elige **Efecto → Volumen y compresión → Compresor multibanda**. Los dos filtros de cruce dividen la señal en bandas bajas, medias y altas. Cada banda tiene su propio umbral, relación y ganancia de salida. Una relación de 1 deja la dinámica de esa banda sin cambios. El ataque y la liberación se aplican a las tres bandas. Los filtros de cruce tienen pendientes suaves y superpuestas de 6 dB/octava; con todas las relaciones en 1 y las ganancias de banda en 0 dB, la señal original pasa sin cambios.

Ambos efectos vinculan sus canales para preservar el equilibrio estéreo y también están disponibles en los racks de efectos de pista y de master. Los ajustes del rack se guardan con el proyecto y se pueden ajustar durante la reproducción. **Aplicar a selección** renderiza el efecto en el audio seleccionado y admite Deshacer. La automatización de línea de tiempo no está disponible para estos dos efectos.

## Exportar

Elige **Archivo → Exportar audio** para una entrega mezclada o **Exportar audio seleccionado** cuando solo se deba renderizar una selección. Soundscaper también puede exportar stems y etiquetas.

Los formatos comprimidos usan el tiempo de ejecución FFmpeg. Los formatos exactos y la disponibilidad condicional se enumeran en la [referencia de formatos generada](/reference/).

Reproduce el archivo exportado en otra aplicación antes de entregarlo o eliminar el material de origen.

Para trabajo de imagen —componer una secuencia, efectos de video y una entrega MP4 o WebM— entrega el proyecto a [Framescaper](/framescaper/) y consulta [exportar video](/framescaper/video-export/).
