---
title: "Web ou escritorio"
description: "Comprende como as edicións no navegador e no escritorio empaquetado gardan os proxectos e acceden aos ficheiros."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"model":"gpt-5.6","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"gl"} -->

Ambas as edicións procesan os proxectos localmente. O almacenamento e o acceso aos ficheiros son diferentes.

## Editor web

A edición para navegador garda os proxectos, as gravacións e os medios importados no almacenamento privado da orixe do navegador. Non carga ningún proxecto nunha conta de Soundscaper e non se precisa ningunha conta.

Usa o editor web cando queiras acceso inmediato sen instalar unha aplicación. Lembra que o almacenamento do navegador está suxeito ás cotas e ás regras de expulsión do navegador. Ao borrar os datos do sitio elimínase a biblioteca local de proxectos.

## Vista previa de escritorio

As vistas previas empaquetadas para escritorio gardan unha biblioteca local con salvado automático dentro da aplicación. Inclúen o tempo de execución do editor e as traducións publicadas para editar sen conexión.

Os paquetes de escritorio non están asinados. macOS aplica só o selo de código ad hoc sen identidade que o cargador necesita para executar Electron e os binarios nativos; ese selo non afirma nada sobre o editor nin sobre a confianza. Polo tanto, Windows SmartScreen ou macOS Gatekeeper poden mostrar un aviso de desenvolvedor descoñecido para os paquetes de vista previa e estables.

Ao abrir un ficheiro `.aup4` impórtase un proxecto independente na biblioteca de escritorio. As edicións posteriores non reescriben o ficheiro aberto. **Gardar** actualiza a copia da biblioteca; **Gardar como** crea un novo ficheiro de intercambio de Audacity.

## Teléfonos e tabletas

O editor web conserva a disposición de escritorio en todas as pantallas, pero por baixo de 900 px de ancho (un teléfono ou unha tableta en posición vertical) dobra a interface en caixóns para deixar espazo á liña temporal:

- O botón **Menú** da parte superior esquerda abre un caixón co menú completo, as lapelas do proxecto, a barra de accións e a barra de ferramentas. Reproducir, deter, gravar e buscar permanecen na barra. Ao escoller un comando péchase o caixón.
- As cabeceiras das pistas deslízanse sobre as pistas desde o tirador **Cabeceiras das pistas** na esquina superior esquerda da liña temporal, ou desde **Vista › Cabeceiras das pistas**. Tocar as pistas ou premer Escape volve ocultalas.
- A introdución situada enriba do editor está contraída por defecto nas pantallas estreitas; **Mostrar introdución** volve amosala.

**Editar › Preferencias › Aparencia › Disposición** cambia entre Automática, Compacta e Escritorio, para que unha xanela pequena nun escritorio conserve a interface de escritorio e unha tableta ampla poida optar polos caixóns.

## Os proxectos non se moven automaticamente

As bibliotecas do navegador e do escritorio son independentes. Move un proxecto de maneira deliberada:

- Usa un ficheiro de proxecto Scape — `.sscape` desde Soundscaper, `.fscape` desde Framescaper — para conservar o proxecto completo.
- Usa AUP4 cando precises especificamente intercambio de audio con Audacity.
- Exporta o audio ou vídeo renderizado como copia duradeira para reprodución.

Consulta [Ficheiros de proxecto](/projects-and-data/project-files/) antes de borrar os datos do sitio no navegador ou os datos da aplicación de escritorio.
