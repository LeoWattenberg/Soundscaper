---
title: "Stocare, copii de rezervă și confidențialitate"
description: "Înțelegeți stocarea locală-în primul rând și protejați proiectele de pierderea browser-ului sau a dispozitivului."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"ro"} -->

## Ce înseamnă abordarea local-first

Proiectele, înregistrările și mediile importate sunt procesate și stocate pe dispozitivul tău. Editorul nu necesită un cont sau sincronizează proiectele cu un serviciu Soundscaper.

Pe web, audio și media folosesc sistemul de fișiere origin-private al browserului, cu căderi de rezervă IndexedDB. Soundscaper solicită stocare persistentă, dar browserul decide dacă să o acorde sau nu.

## Ce poate șterge un proiect

- Ștergerea datelor site-ului elimină biblioteca locală de proiecte a browserului.
- Contextele private sau restricționate ale browserului pot reveni la memoria temporară.
- Politicile de cotă și evacuare ale browserului rămân autoritare.
- Ștergerea manuală a datelor aplicației de birou elimină biblioteca sa locală.
- O defecțiune a dispozitivului sau a stocării poate elimina toate copiile locale de pe acel dispozitiv.

Dezinstalarea unei versiuni ambalate a aplicației de birou este concepută pentru a păstra biblioteca sa, dar nu este o strategie de backup.

## Rutina de backup

La etape utile și înainte de a șterge sau migra stocarea:

1. Așteptați finalizarea salvării locale.
2. Exportați un fișier de proiect Scape (`.sscape` sau `.fscape`).
3. Exportați și redați o livrare randată.
4. Copiați ambele în stocare în afara datelor locale ale editorului.

Utilizați AUP4 în plus, atunci când schimbul Audacity este important, nu în locul copiei proiectului Scape.

## Confidențialitatea site-ului de documentație

Acest ghid este servit ca fișiere statice și utilizează căutarea locală a browserului. Site-ul V1 nu adaugă un serviciu de analiză sau un backend AI/căutare.

Politica completă de confidențialitate [Soundscaper și Framescaper](https://soundscaper.org/privacy/en/) acoperă, de asemenea, livrarea aplicației, permisiunile dispozitivului, descărcările opționale, verificările de actualizare ale desktopului și conexiunile Framescaper Web VCR.
