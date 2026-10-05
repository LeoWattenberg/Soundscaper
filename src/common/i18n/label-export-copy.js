const LABEL_EXPORT_COPY_ENTRIES = Object.freeze([
	['exportLabelsTxt', 'As Audacity TXT', 'Als Audacity-TXT'],
	['exportLabelsSrt', 'As SubRip (SRT)', 'Als SubRip (SRT)'],
	['exportLabelsVtt', 'As WebVTT', 'Als WebVTT'],
	['exportLabelsPodcastJson', 'As Podcast 2.0 chapters (JSON)', 'Als Podcast-2.0-Kapitel (JSON)'],
	['embedLabelChapters', 'Embed labels as chapters', 'Markierungen als Kapitel einbetten'],
	['embedLabelChaptersHint', 'Include label titles and times in the exported MP3 or M4A file. Only labels in the exported range are included. Chapter display depends on the player.', 'Titel und Zeiten der Markierungen in die exportierte MP3- oder M4A-Datei aufnehmen. Nur Markierungen im exportierten Bereich werden aufgenommen. Die Kapitelanzeige hängt vom Player ab.'],
	['embedLabelChaptersNoLabels', 'Add a label to embed chapters in the exported file.', 'Füge eine Markierung hinzu, um Kapitel in die exportierte Datei einzubetten.'],
]);

export const LABEL_EXPORT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(LABEL_EXPORT_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(LABEL_EXPORT_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
