---
title: "Grabar audio"
description: "Dar permiso de entrada al editor, elegir rutas, y proteger una toma completada."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"es"} -->

## Preparar la entrada

1. Abra los controles del dispositivo de grabación y elija una entrada disponible.
2. Permita el permiso del micrófono o de captura cuando el navegador lo solicite.
3. Active la supervisión de entrada si necesita inspeccionar el nivel entrante antes de
   grabar.
4. Compruebe el medidor de grabación y ajuste el nivel del dispositivo o de entrada para evitar
   la distorsión.

El permiso del navegador está limitado al sitio y al dispositivo. Si no aparece ninguna entrada,
revise los permisos del sistema operativo y del navegador.

## Grabar una o varias pistas

Para una grabación normal, utilice el menú **Grabar** o la acción de grabación del transporte.

Para la ruta multicanal, elija **Ver → Activar grabación multicanal**, arme las
pistas que desea grabar y asigne una entrada a cada pista armada. La grabación
no comenzará si no se asigna ninguna entrada disponible.

Soundscaper también expone flujos de trabajo de grabación activados por tiempo, punch/count-in,
loop/take y activados por sonido a través de sus menús. Comience con una toma normal antes de agregar
estas condiciones.

## Después de la toma

Detenga la grabación y reproduzca el nuevo clip antes de continuar. Espere a que el estado del proyecto
indique que el guardado se ha completado. Para material irremplazable, exporte una
copia de audio renderizada y un proyecto `.sscape` en lugar de confiar solo en la
biblioteca local.