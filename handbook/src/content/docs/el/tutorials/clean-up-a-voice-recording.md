---
title: "Καθαρίστε μια ηχογράφηση φωνής"
description: "Αφαιρέστε το βουητό από μια λήψη, κόψτε το βούητο, φέρτε το σε ένταση podcast και εξαγάγετε ένα αρχείο MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"el"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

Οι περισσότερες ηχογραφήσεις στο σπίτι χρειάζονται τις ίδιες τρεις διορθώσεις: έναν σταθερό θόρυβο φόντου για αφαίρεση, ένα χαμηλό βούητο για φιλτράρισμα και ένα επίπεδο που πρέπει να ανυψωθεί σε ένα πρότυπο. Αυτό το εκπαιδευτικό πρόγραμμα κάνει και τα τρία σε ένα παράδειγμα τριών δευτερολέπτων, του οποίου το πρώτο μισό δευτερόλεπτο είναι απλώς θόρυβος δωματίου, και στη συνέχεια εξάγει το αποτέλεσμα ως MP3.

:::tip[Τι θα χρειαστείτε]
- Κατεβάστε [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — μια σύντομη λήψη του οποίου το πρώτο μισό δευτερόλεπτο είναι θόρυβος δωματίου πριν ξεκινήσει η φωνή.

Κάθε βήμα παρακάτω λειτουργεί σε αυτά τα αρχεία ακριβώς όπως είναι, οπότε αυτό που βλέπετε θα πρέπει να ταιριάζει με αυτό που λέει το εκπαιδευτικό πρόγραμμα. Το Soundscaper λειτουργεί στον περιηγητή· δεν χρειάζεται να εγκατασταθεί τίποτα.
:::

## Τι θα μάθετε

- Γιατί η Μείωση Θορύβου χρειάζεται ένα προφίλ και πώς να της δώσετε ένα.
- Τι αφαιρεί ένα φίλτρο υψηλής διέλευσης και πού να το ρυθμίσετε για ομιλία.
- Η διαφορά μεταξύ του επιπέδου κορυφής και της έντασης, και πώς να πετύχετε έναν στόχο έντασης.
- Πώς να εξάγετε ένα MP3.

## Βήματα

1. Ανοίξτε το Soundscaper. Ένα νέο, κενό έργο είναι έτοιμο μόλις φορτωθεί ο επεξεργαστής.
2. Επιλέξτε **Αρχείο → Εισαγωγή ήχου** και επιλέξτε `guide-noisy-take.wav` — μια σύντομη λήψη του οποίου το πρώτο μισό δευτερόλεπτο είναι θόρυβος δωματίου πριν ξεκινήσει η φωνή. Το αρχείο προσγειώνεται ως κλιπ στο δικό του κομμάτι.
3. Πατήστε **Αναπαραγωγή** για να ακούσετε, στη συνέχεια **Διακοπή**.
   *Θα πρέπει να δείτε:* Μισό δευτερόλεπτο θορύβου, στη συνέχεια μια σταθερή νότα που αντιπροσωπεύει μια φωνή, με τον θόρυβο από κάτω της.
4. Σύρετε τον κανόνα πάνω από το κλιπ, από την αρχή στο σημάδι 15%, για να επιλέξετε την εισαγωγή μόνο θορύβου. Το προφίλ πρέπει να περιέχει μόνο θόρυβο — καμία φωνή καθόλου.
5. Επιλέξτε **Εφέ → Αφαίρεση και επιδιόρθωση θορύβου → Μείωση Θορύβου** και πατήστε **Λήψη προφίλ θορύβου**. Η γραμμή κατάστασης αναφέρει ότι το προφίλ είναι έτοιμο. Πατήστε **Κλείσιμο** για να φύγετε από το παράθυρο διαλόγου προς το παρόν.
6. Επιλέξτε **Επιλογή → Επιλέξτε όλα**. Το προφίλ διατηρείται· τώρα το εφέ πρέπει να μάθει τι να καθαρίσει.
7. Επιλέξτε **Εφέ → Αφαίρεση και επιδιόρθωση θορύβου → Μείωση Θορύβου**. Στο παράθυρο διαλόγου **Μείωση Θορύβου**, ορίστε τη **Μείωση Θορύβου** σε `12`, στη συνέχεια πατήστε **Εφαρμογή στην επιλογή**. Τα δώδεκα ντεσιμπέλ είναι μια καλή πρώτη ρύθμιση. Περισσότερα αφαιρούν περισσότερο θόρυβο αλλά κάνουν τις φωνές να ακούγονται κενές.
   *Θα πρέπει να δείτε:* Η εισαγωγή είναι σχεδόν επίπεδη και η νότα είναι ανέπαφη.
8. Επιλέξτε **Εφέ → Κλασικά εφέ → Κλασικά Φίλτρα**. Στο παράθυρο διαλόγου **Κλασικά Φίλτρα**, επιλέξτε **Υψηλής διέλευσης** για **Τύπο φίλτρου** και ορίστε τη **Συχνότητα κοπής** σε `100`, στη συνέχεια πατήστε **Εφαρμογή στην επιλογή**. Όλα κάτω από 100 Hz — κυκλοφορία, χειρισμός, κλιματισμός — είναι μειωμένα. Η ομιλία ζει καλά πάνω από αυτό.
9. Επιλέξτε **Εφέ → Ένταση και συμπίεση → Κανονικοποίηση έντασης**. Στο παράθυρο διαλόγου **Κανονικοποίηση έντασης**, ορίστε την **Στόχο έντασης** σε `-16`, στη συνέχεια πατήστε **Εφαρμογή στην επιλογή**. Τα -16 LUFS είναι ο κοινός στόχος για στερεοφωνικά podcasts. Η ένταση μετράει πόσο δυνατή ακούγεται ολόκληρη η λήψη, όχι πόσο ψηλά είναι τα κορυφώματά της.
   *Θα πρέπει να δείτε:* Η μορφή του κύματος είναι ψηλότερη και η λήψη αναπαράγεται σε ένα άνετο επίπεδο.
10. Πατήστε **Αναπαραγωγή** για να ακούσετε, στη συνέχεια **Διακοπή**.
   *Θα πρέπει να δείτε:* Μια καθαρή, επίπεδη λήψη με μια ήσυχη εισαγωγή.
11. Επιλέξτε **Αρχείο → Εξαγωγή ήχου**, ορίστε τη **Μορφή** σε **MP3** και πατήστε **Εξαγωγή**. Το αρχείο κατεβαίνει μόλις ολοκληρωθεί η απόδοση, και ο σύνδεσμός του παραμένει στο παράθυρο διαλόγου. Το αρχείο κωδικοποιείται στον περιηγητή· τίποτα δεν φεύγει από τον υπολογιστή σας.

## Επόμενα βήματα

- Κάντε το στην δική σας λήψη με τους οδηγούς: [Αφαίρεση θορύβου φόντου](/guides/cleaning-up/remove-background-noise/), [Αφαίρεση χαμηλού βούητου](/guides/cleaning-up/remove-low-rumble/) και [Κανονικοποίηση έντασης για ένα podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Ελέγξτε το αποτέλεσμα με τον τρόπο που θα το έκανε μια πλατφόρμα: [Μέτρηση πόσο δυνατή είναι η μίξη σας](/guides/analysis/measure-loudness/).

## Άλλα εκπαιδευτικά προγράμματα

[Το πρώτο σας έργο Soundscaper](/tutorials/your-first-project/) — Εισαγάγετε μια ηχογράφηση, ακούστε την, χωρίστε την, ξεθωριάσετε την, εξαγάγετε ένα αρχείο και αποθηκεύστε το έργο.
[Βάλτε μουσική κάτω από μια φωνή](/tutorials/put-music-under-a-voice/) — Επικαλύψτε δύο κομμάτια, κάντε το ένα να υποχωρεί αυτόματα κάτω από το άλλο, αναμείξτε τα και εξαγάγετε.

## Αναφορά

- [Κάθε παράμετρος των εφέ που χρησιμοποιούνται εδώ, με την προεπιλεγμένη και την κλίμακά της, βρίσκεται στην αναφορά εφέ ήχου.](/reference/generated/audio-effects/#parameters)
- [Οι μορφές εξαγωγής, οι δοχεία τους και τα όρια καναλιών τους βρίσκονται στην αναφορά μορφών εξαγωγής.](/reference/generated/formats/)
- [Κάθε εντολή μενού και το συντομεύοντάς της βρίσκεται στην αναφορά εντολών και συντομεύσεων.](/reference/generated/commands/)

## Σχετικά με αυτό το εκπαιδευτικό πρόγραμμα

Αυτό το εκπαιδευτικό πρόγραμμα αναπαράγεται, βήμα προς βήμα και σε αυτά τα ίδια αρχεία, σε κάθε έκδοση του Soundscaper από το σύνολο περιηγητών (`tests/browser/soundscaper-tutorials.spec.js`). Εάν ένα βήμα σταματήσει να λειτουργεί, η έκδοση αποτυγχάνει μέχρι να διορθωθεί το εκπαιδευτικό πρόγραμμα, οπότε αυτό που διαβάζετε είναι αυτό που κάνει ο επεξεργαστής.