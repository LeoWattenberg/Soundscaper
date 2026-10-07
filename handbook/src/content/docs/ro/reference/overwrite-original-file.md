---
title: "Suprascrierea unui fișier importat pe desktop"
description: "Salvați proiectul editat peste fișierul media original în Soundscaper sau Framescaper."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"ro"} -->

În versiunile Electron ale Soundscaper și Framescaper, **Fișier → Suprascrie numele fișierului** exportă întregul proiect editat în fișierul media importat inițial. Folosește setările de export acceptate de fișierul original și salvează imediat, fără să deschidă dialogul de export sau un selector de fișiere. Audio-ul păstrează formatul sursă, rata de eșantionare și numărul de canale. Videoclipurile MP4 și WebM acceptate păstrează containerul, dimensiunile și rata de cadre sursă.

Importați un fișier media prin **Fișier → Importă**, efectuați modificările, apoi alegeți **Fișier → Suprascrie numele fișierului**. Puteți repeta operația după alte modificări. O selecție de timp nu limitează suprascrierea: proiectul întreg este redat de fiecare dată. Proiectul păstrează elementele media importate și istoricul editărilor.

Comanda nu este disponibilă dacă proiectul nu are un fișier original acceptat, dacă au fost importate mai multe fișiere originale sau în timpul importului, înregistrării ori procesării. Versiunile din browser folosesc dialogul obișnuit de export.

Alegeți **Fișier → Exportă audio** în Soundscaper sau **Fișier → Exportă video** în Framescaper dacă doriți altă destinație sau să modificați setările de livrare. Suprascrierea înlocuiește conținutul fișierului original; păstrați o copie separată dacă aveți nevoie de înregistrarea needitată.
