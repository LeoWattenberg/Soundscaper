---
title: "Procesare locală, modele și plugin-uri"
description: "Găsiți asistență locală în funcție de sarcină și gestionați modelele și plugin-urile în editorii de pe desktop."
---
<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"ro"} -->

Asistența locală rulează pe dispozitivul dvs. în editorii de desktop Soundscaper și Framescaper. Selectați media, apoi alegeți sarcina din meniul său. Dialogul afișează selecția, setările sarcinii și dacă modelele sale sunt instalate.

Pachetele desktop includ motoarele de procesare native pentru modelele locale publicate. Instalați greutățile modelului prin Model Manager, apoi rulați sarcina pe media selectată. Consultați ghidul fiecărui model [ghid](/reference/local-models/) pentru platformele sale acceptate, intrarea în meniu și cerințe.

## Găsiți o sarcină {#find-a-task}

| Meniu | Sarcini |
| --- | --- |
| Efect → Eliminarea și repararea zgomotului | Îmbunătățirea Dialogului, Reducerea Reverb-ului, Curățarea Umplerii & Silențului |
| Efect → Separarea surselor | Separarea Dialogului / Muzicii / Efectelor |
| Analiză → Discurs | Transcriere & Subtitrări, Identificarea Vorbitorilor, Marcarea Reacțiilor |
| Analiză → Muzică | Detectarea Beat-urilor & Ritmului |
| Analiză → Video | Marcarea Tăierilor |
| Efect → Efecte video | Reframare |
| Editare | Crearea Evidențierilor |
| Generare | Generarea Textului Editorial |
| Instrumente → Căutare | Căutare Indexată, Indexarea Transcrierii, Indexarea Video |

Sarcinile video aparțin Framescaper. Comenzile disponibile depind de mediul de execuție desktop și de capacitățile produsului. Opțiunea de meniu alfabetică a efectelor din Soundscaper sortează, de asemenea, efectele de procesare locală după nume.

Alegeți **Rulare locală** pentru a începe procesarea și pentru a răspunde la solicitarea de consimțământ local. Puteți anula în timpul procesării. Alegeți **Revizuirea rezultatului**, selectați rezultatele dorite și alegeți **Aplicați selectat**. Modificările acceptate ale proiectului pot fi anulate. Închiderea unei sarcini nu aplică propunerile sale.

**Instrumente → Procesare Locală Avansată** păstrează selectoarele individuale de operațiuni și modele. Detaliile tehnice din dialogurile de sarcini afișează pașii și setările exacte atunci când este necesar.

## Gestionați modelele {#manage-models}

Deschideți **Instrumente → Manager de modele**, sau utilizați **Gestionați Modelele** din interiorul unei sarcini. Legătura sarcinii filtrează lista pentru identități de modele compatibile; **Afișați toate modelele** elimină această restricție. Căutați după nume sau sarcină și filtrați după starea de instalare.

Instalați modelele explicit. Descărcați progresul și puteți anula. Revenirea la o sarcină păstrează setările sale și actualizează disponibilitatea modelului; nu începe procesarea. Extindeți **Stocare și verificare** pentru reparații, curățare, relocarea stocării, notificări de licență și instalare offline dintr-un folder.

Consultați [ghidurile individuale ale modelelor](/reference/local-models/) pentru scopul fiecărui model publicat, intrarea în meniu, dimensiunea descărcării, cerințe, limitări și verificările reale de inferență efectuate de pachetul desktop cu teste nocturne.

## Gestionați plugin-urile și dispozitivele {#manage-plugins-and-devices}

**Efect → Manager de Plugin-uri** listează plugin-urile audio în Soundscaper și plugin-urile OpenFX în Framescaper. Căutați sau filtrați lista, apoi selectați un plugin pentru controlul versiunii, permisiunii și recuperării din carantină. **Scanare & Setări** conține setările de descoperire.

Rulați plugin-urile audio prin **Efect → Plugin-uri Audio**. Comenzile de adăugare/editare a efectelor video din Framescaper rămân sub **Efect → Efecte video**.

Deschideți **Editare → Preferințe → Setări audio** pentru dispozitivele audio native și controalele de asistență. **Media** conține setările media native; **Efecte** leagă către Managerul de Plugin-uri și conține comutatorul de descoperire a plugin-urilor. Permisiunile și recuperarea din carantină a plugin-urilor necesită încă acțiuni explicite.
