---
title: "Motionscaper"
description: "Cree composicións animadas e conserve proxectos de movemento editables localmente."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"gl"} -->

Motionscaper é o editor de gráficos en movemento da familia Scaper. Un proxecto
contén composicións, capas, animación e medios conservados. A extensión do seu
ficheiro de proxecto é `.mscape`.

Esta é unha versión de desenvolvemento. Comece cunha copia do material de orixe
importante e garde os arquivos de proxectos exportados xunto á biblioteca de traballo.

## Comezar unha composición {#start-a-composition}

Escolla **Ficheiro → Nova composición**. O menú **Capa** abre ferramentas de texto,
formas, animación, composición de capas, seguimento, expresións e escena 3D.
**Ver → Vista previa da composición** abre a reprodución; as novas superficies
de edición aparecen cando as escolle desde un menú.

Escolla **Ver → Lenzo da composición** para seleccionar, mover, escalar ou xirar
capas con transformacións 2D estáticas. As transformacións animadas seguen sendo
editables coas ferramentas de propiedades e liña de tempo.

En **Ver → Liña de tempo**, seleccione capas existentes para cambiar o nome,
activar, desactivar ou eliminar. Cambiar o nome conserva as referencias de
propiedades e a animación. Eliminar unha capa conserva os seus medios orixinais;
inclúa as capas dependentes ou desvincule primeiro as súas ligazóns.
**Desfacer** restaura as capas eliminadas. Unha capa de material seleccionada
tamén ofrece unha caixa de son cando a súa orixe conservada contén son.

Siga [o seu primeiro proxecto de movemento](/motionscaper/first-project/) para
crear, animar, gardar e renderizar unha composición.

## Gardar e producir saída {#save-and-deliver}

**Ficheiro → Gardar** publica unha revisión gardada. **Gardar copia** exporta a
instantánea actual como arquivo `.mscape` sen publicar unha nova revisión gardada.
Os medios orixinais importados e os tipos de letra viaxan co arquivo.
A **Biblioteca de proxectos** abre proxectos conservados neste dispositivo.

**Ficheiro → Renderizar** ofrece fotogramas PNG transparentes nun arquivo TAR,
vídeo opaco MP4 ou WebM e ProRes 4444 cando está dispoñible o codificador de
escritorio. As secuencias PNG non conteñen son. O vídeo do navegador conserva o
son creado cando o seu codificador admite o formato solicitado. ProRes nativo
indica a precisión efectiva da cor e da alfa no diálogo de renderización.
**Ficheiro → Cola de renderización** conserva os traballos ao pechar diálogos
e cambiar de proxecto. Conserva ata oito traballos e 128 MiB de descargas do
navegador; cada descarga admite ata 64 MiB. Escolla un destino de ficheiro en
fluxo para saídas maiores e elimine os traballos rematados para liberar as
descargas conservadas. Se falla a limpeza da saída nativa, use **Repetir limpeza
da saída** nesta cola. O traballo mantén o seu destino ata que a limpeza teña
éxito; despois pode eliminalo ou repetir a revisión enviada cun destino novo.

## Ligar a Framescaper {#link-to-framescaper}

As composicións ligadas precisan a liña de desenvolvemento separada Framescaper 1.1.
No seu diálogo **Ficheiro → Composicións ligadas**, cree un URL de emparellamento.
Pégueo no diálogo **Ficheiro → Enviar composición a Framescaper** de Motionscaper,
conecte e manteña abertos os editores e as xanelas da ponte. As operacións
posteriores de **Gardar** envían novas revisións automaticamente; **Gardar copia**
non o fai.

Framescaper conserva cada revisión aceptada e o seu conxunto multimedia completo
para uso sen conexión. Desfacer fixa unha revisión anterior ata que retome as
actualizacións. Os cambios no tamaño da saída, na temporización ou na grella de
son precisan unha revisión explícita de conformación. O receptor de escritorio
pode, no seu lugar, vixiar un ficheiro `.mscape` gardado que seleccione.

## Comprobar actualizacións de escritorio {#check-desktop-updates}

Escolla **Axuda → Comprobar actualizacións** na aplicación de escritorio.
Esta comprobación manual busca versións compatibles de Motionscaper no
repositorio GitHub do proxecto. As versións preliminares poden recibir novas
versións preliminares; as estables reciben versións estables. Escolla
**Ver versión** para abrir a páxina de versión verificada. A comprobación non
descarga nin instala actualizacións. As compilacións do navegador omiten esta
orde do menú.

## Intercambio con After Effects {#after-effects-exchange}

**Ficheiro → Ponte de After Effects** fornece scripts lexibles e revisa datos de
intercambio compatibles antes de importar. Os ficheiros `.aep` e `.aepx` ábrense
mediante unha copia instalada de After Effects e os scripts da ponte. A ponte
de desenvolvemento aínda non se verificou cun After Effects instalado. Revise
o seu informe; a intención de escena non compatible e os medios orixinais
seguen conservados no proxecto.

O diálogo ofrece opcións separadas de importación e exportación para expresións
escalares de opacidade compatibles con aritmética, tempo da composición, valor
previo á expresión e funcións Math estándar. Ambas as opcións comezan desactivadas.
Revise o novo informe tras cambiar unha opción; outras formas de expresión
precisan mostraxe ou renderización explícitas. O código orixinal da expresión
permanece no intercambio conservado ou no arquivo `original.mscape`.

O renderizador admite cor SDR e alfa con capas 2.5D, cámaras, luces, mostraxe do
obturador e profundidade de campo. Non afirma admitir HDR, mallas 3D completas,
máscaras avanzadas de IA nin compatibilidade con complementos arbitrarios
de After Effects.
