---
title: "Exportați video"
description: "Validați secvența compusă și creați un fișier MP4 sau WebM pentru livrare."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"ro"} -->

## Înainte de exportare

- Jucați întreaga secvență și fiecare limită de editare.
- Confirmați că pistele vizibile și solo-ed produc imaginea intenționată.
- Verificați dacă audio-ul legat rămâne sincronizat.
- Confirmați intervalul de export și dacă subtitrările sau audio-ul ar trebui incluse.

## Crearea fișierului

Deschideți dialogul de exportare și selectați un format video. Framescaper suportă livrarea MP4 și WebM prin intermediul timpului de rulare video configurat. Alegeți dimensiunile, rata de cadre și alte opțiuni potrivite pentru destinație.

Codificarea video necesită mai multe resurse decât redarea normală a liniei de timp. Păstrați editorul deschis până când exportul raportează finalizarea.

## Exportarea separată a clipurilor audio {#export-audio-clips}

Alegeți **Fișier → Exportă video**, selectați un format audio precum **WAV** și setați **Ieșire** la **Clipuri individuale (separare după clipuri)**. Exportul descarcă o arhivă care conține câte un fișier pentru fiecare clip audio. Clipurile video sunt excluse, iar fiecare fișier audio conține doar clipul corespunzător, inclusiv decupările și editările sale.

Fișierele încep de la începutul audibil al clipului, fără completare până la poziția sa din proiect sau coadă de efect. Numele numerotate disting clipurile cu același nume.

Efectele pistei sunt incluse; efectele principale, dezactivarea sunetului și solo nu influențează acest export. Consultați fluxul audio comun la [Exportarea clipurilor ca fișiere separate](/soundscaper/edit-mix-and-export/#export-clips).

## Verificarea livrării

Deschideți fișierul exportat într-un player separat. Verificați durata sa, primele și ultimele cadre, orientarea imaginii, sincronizarea audio și subtitrările așteptate.

Videoclipul randat nu poate înlocui proiectul editabil. Exportați o copie `.fscape` de asemenea, atunci când trebuie să păstrați linia de timp și media proiectului.
