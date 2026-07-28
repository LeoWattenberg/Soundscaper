const LABEL_EXPORT_COPY_ENTRIES = Object.freeze([
	['exportLabelsTxt', 'As Audacity TXT', 'Als Audacity-TXT'],
	['exportLabelsSrt', 'As SubRip (SRT)', 'Als SubRip (SRT)'],
	['exportLabelsVtt', 'As WebVTT', 'Als WebVTT'],
	['exportLabelsPodcastJson', 'As Podcast 2.0 chapters (JSON)', 'Als Podcast-2.0-Kapitel (JSON)'],
]);

export const LABEL_EXPORT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(LABEL_EXPORT_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(LABEL_EXPORT_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
