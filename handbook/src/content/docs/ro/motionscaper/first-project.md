---
title: "Primul proiect de animație"
description: "Creați o compoziție, animați un strat și exportați un proiect salvat."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"ro"} -->

## Creați și adăugați un strat {#create-and-add-a-layer}

1. Alegeți **Fișier → Compoziție nouă** și introduceți un titlu, dimensiuni, frecvența cadrelor
   și durata în cadre.
2. Alegeți **Strat → Text nou** sau **Strat → Culoare uniformă nouă**. Alegeți compoziția
   țintă când proiectul conține mai multe compoziții.
3. Deschideți **Strat → Text și aspect** pentru a edita un strat de text existent sau
   umplerile și contururile unei forme. Fonturile importate aici sunt păstrate cu proiectul.

Folosiți **Fișier → Importă media** pentru surse de imagine, video sau audio. Un import care
depășește limitele actuale ale decoderului sau memoriei este refuzat cu o explicație;
fișierul sursă original rămâne nemodificat.

## Animați și previzualizați {#animate-and-preview}

Deschideți **Strat → Proprietăți și cadre-cheie** pentru a alege o proprietate a stratului și a adăuga
chei la poziții exacte de cadru. Comenzile curbelor modifică interpolarea; editarea
spațială modifică traseele poziției. **Vizualizare → Cronologie** deschide comenzile pentru temporizare,
ordonare, grupare și zona de lucru a straturilor.

Deschideți **Vizualizare → Pânza compoziției** pentru a selecta și muta un strat 2D static.
Pătratul îl redimensionează, iar cercul îl rotește în jurul ancorei definite. Fiecare
tragere finalizată este un singur pas de revenire; Escape anulează o tragere. Transformările animate și
controlate de expresii rămân în Proprietăți și cadre-cheie.

Deschideți **Vizualizare → Previzualizarea compoziției** pentru a căuta un moment sau a reda compoziția. Previzualizarea
folosește media sursă păstrată. Setările de scenă neacceptate sau nevalide produc o
eroare în locul unei imagini înlocuitoare. Închideți previzualizarea pentru a elibera resursele sale
active de randare.

## Salvați o copie portabilă {#save-a-portable-copy}

Alegeți **Fișier → Salvează** pentru a publica revizia curentă, apoi **Fișier → Salvează o copie**
pentru a descărca o arhivă `.mscape`. Arhiva include proiectul și media
originală necesară redeschiderii. Deschideți-o cu **Fișier → Deschide** pe alt dispozitiv sau
dintr-o bibliotecă nouă de browser.

## Randare {#render}

Alegeți **Fișier → Randează**. Selectați o compoziție, un format de ieșire și
un interval de cadre. Cadrul final este exclus: cadrele de la 0 la 29 folosesc intervalul
`0`–`30`. O zonă de lucru fracționară selectează momentele întregi de eșantionare din interior;
o zonă fără eșantioane de ieșire trebuie modificată înainte de randare.

Folosiți **Secvență PNG transparentă (.tar)** pentru alfa. Extrageți arhiva TAR pentru
a obține imagini PNG normale și metadate de temporizare. MP4 și WebM folosesc culoarea
de fundal selectată în dialog. Randarea fixează revizia trimisă, astfel încât editările
ulterioare nu modifică o ieșire deja în curs. Închiderea dialogului de randare
păstrează sarcina în execuție. **Fișier → Coadă de randare** arată progresul, anularea,
reîncercarea reviziei trimise și descărcările finalizate. Închiderea editorului
anulează sarcinile neterminate.

Reveniți la [manualul Motionscaper](/motionscaper/).
